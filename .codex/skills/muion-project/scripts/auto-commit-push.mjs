import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, runGit, gitStatusEntries, nowIso } from './project-utils.mjs';
import { syncExternalLibraries } from './external-lib-sync.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
if (!args.baseline) throw new Error('automatic commit/push requires --baseline from begin-task.mjs');
syncExternalLibraries({ projectRoot: root, event: 'auto-publish' });
const policy = JSON.parse(fs.readFileSync(path.join(root, '00_project/config/publish-policy.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.resolve(args.baseline), 'utf8'));
const status = gitStatusEntries(root);
const paths = status.map((entry) => entry.path).filter(Boolean);
const deletedExternal = new Set(status.filter((entry) => entry.status.includes('D') && entry.path.startsWith('06_external_lib/')).map((entry) => entry.path));
const baselinePaths = new Set(baseline.paths || []);
const isBaselinePath = (file) => [...baselinePaths].some((entry) => file === entry || (entry.endsWith('/') && file.startsWith(entry)));
const existing = paths.filter(isBaselinePath);
const managedExternalTrace = (file) => file.startsWith('00_project/traceability/external-libraries/');
const verifiedSyncStates = paths.filter((file) => !isBaselinePath(file) && file.startsWith('00_project/traceability/sync-states/')).filter((file) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).status === 'three-way-verified'; } catch { return false; }
});
const rejected = paths.filter((file) => !isBaselinePath(file) && !managedExternalTrace(file) && !verifiedSyncStates.includes(file) && (policy.never_stage_prefixes.some((prefix) => file.startsWith(prefix)) || policy.never_stage_extensions.some((ext) => file.toLowerCase().endsWith(ext))));
if (rejected.length) throw new Error('protected paths require explicit project workflow: ' + rejected.join(', '));
const candidates = paths.filter((file) => !isBaselinePath(file) && !deletedExternal.has(file) && !managedExternalTrace(file) && !rejected.includes(file) && (!file.startsWith('00_project/traceability/sync-states/') || verifiedSyncStates.includes(file)) && !file.startsWith('00_project/traceability/sync-outbox/'));
if (!candidates.length) { console.log(JSON.stringify({ status: 'no-task-owned-files', pushed: false, protected_preexisting: existing, rejected }, null, 2)); process.exit(0); }
const tests = spawnSync(process.execPath, ['tests/architecture-smoke.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
if (tests.status !== 0) throw new Error('architecture test failed: ' + (tests.stderr || tests.stdout));
runGit(root, ['add', '--', ...candidates]);
const message = args.message || ('自动更新项目工作流 ' + new Date().toISOString().slice(0, 10));
const commit = runGit(root, ['-c', 'user.name=' + policy.author.name, '-c', 'user.email=' + policy.author.email, 'commit', '-m', message], { allowFailure: true });
if (commit.status !== 0) throw new Error(commit.stderr || commit.stdout || 'automatic commit failed');
const commitHash = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
runGit(root, ['push', policy.remote, 'HEAD:' + policy.branch], { timeout: 120000 });
const remote = runGit(root, ['ls-remote', policy.remote, 'refs/heads/' + policy.branch]).stdout.trim().split(/\s+/)[0] || null;
if (remote !== commitHash) throw new Error('remote branch does not match ' + commitHash + ': ' + remote);
console.log(JSON.stringify({ status: 'committed-and-pushed', commit: commitHash, candidates, protected_preexisting: existing, rejected, remote, pushed_at: nowIso() }, null, 2));
