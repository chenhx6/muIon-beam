import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, runGit, gitStatusEntries, nowIso, ensureDirectory, jsonWrite } from './project-utils.mjs';
import { syncExternalLibraries } from './external-lib-sync.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const ownedPaths = args.owned_paths ? new Set(JSON.parse(fs.readFileSync(path.resolve(root, args.owned_paths), 'utf8'))) : null;
if (!args.baseline) throw new Error('automatic commit/push requires --baseline from begin-task.mjs');
syncExternalLibraries({ projectRoot: root, event: 'auto-publish' });
const policy = JSON.parse(fs.readFileSync(path.join(root, '00_project/config/publish-policy.json'), 'utf8'));
const slug = (value) => String(value || 'project-update').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project-update';
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
const candidates = paths.filter((file) => (!ownedPaths || ownedPaths.has(file)) && !isBaselinePath(file) && !deletedExternal.has(file) && !managedExternalTrace(file) && !rejected.includes(file) && (!file.startsWith('00_project/traceability/sync-states/') || verifiedSyncStates.includes(file)) && !file.startsWith('00_project/traceability/sync-outbox/'));
if (!candidates.length) { console.log(JSON.stringify({ status: 'no-task-owned-files', pushed: false, protected_preexisting: existing, rejected }, null, 2)); process.exit(0); }
const tests = spawnSync(process.execPath, ['tests/architecture-smoke.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
if (tests.status !== 0) throw new Error('architecture test failed: ' + (tests.stderr || tests.stdout));
runGit(root, ['add', '--', ...candidates]);
const message = args.message || ('自动更新项目工作流 ' + new Date().toISOString().slice(0, 10));
const commit = runGit(root, ['-c', 'user.name=' + policy.author.name, '-c', 'user.email=' + policy.author.email, 'commit', '-m', message], { allowFailure: true });
if (commit.status !== 0) throw new Error(commit.stderr || commit.stdout || 'automatic commit failed');
const commitHash = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const tag = `b-${slug(args.topic || message)}-${stamp}-${commitHash.slice(0, 7)}`;
const note = [`# ${tag}`, '', `基于标签：当前 main`, `基础内容核验：不适用于普通构建 tag`, `本次任务：${args.task || message}`, `本次调整：${message}`, '优化内容：自动提交、架构检查和远端分支校验已完成', '结果：普通构建提交已通过项目架构检查', '主要限制：该 tag 不代表正式研究结果，不包含结果级 Drive 归档和三端审计', `详细报告：${args.report || '见对应 commit、测试输出和任务记录'}`, `Google Drive 归档路径：${args.drive_path || '不适用于普通构建 tag'}`, ''].join('\n');
const notePath = path.join(root, '_work/current/publish-notes', `${tag}.md`);
ensureDirectory(path.dirname(notePath));
fs.writeFileSync(notePath, note, 'utf8');
runGit(root, ['tag', '-a', tag, '-F', notePath]);
runGit(root, ['push', policy.remote, 'HEAD:' + policy.branch], { timeout: 120000 });
const tagPush = runGit(root, ['push', policy.remote, `refs/tags/${tag}`], { timeout: 120000, allowFailure: true });
let outbox = null;
if (tagPush.status !== 0) { outbox = path.join(root, '_work/current/tag-outbox', `${tag}.json`); jsonWrite(outbox, { tag, commit: commitHash, remote: policy.remote, branch: policy.branch, note: notePath, status: 'pending-tag-push', error: (tagPush.stderr || tagPush.stdout || '').trim(), created_at: nowIso() }); }
const remote = runGit(root, ['ls-remote', policy.remote, 'refs/heads/' + policy.branch]).stdout.trim().split(/\s+/)[0] || null;
if (remote !== commitHash) throw new Error('remote branch does not match ' + commitHash + ': ' + remote);
const remoteTag = runGit(root, ['ls-remote', policy.remote, `refs/tags/${tag}^{}`], { allowFailure: true }).stdout.trim();
console.log(JSON.stringify({ status: tagPush.status === 0 ? 'committed-pushed-and-tagged' : 'committed-and-pushed-tag-pending', commit: commitHash, tag, tag_remote: remoteTag || null, tag_outbox: outbox, candidates, protected_preexisting: existing, rejected, remote, pushed_at: nowIso() }, null, 2));
