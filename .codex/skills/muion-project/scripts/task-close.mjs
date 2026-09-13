import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, runGit, jsonWrite, nowIso } from './project-utils.mjs';
import { classifyPaths, digestFiles } from './delivery-plan.mjs';
import { syncExternalLibraries } from './external-lib-sync.mjs';
import { acquireProjectLock, releaseProjectLock, checkSession, listSessions } from '../../team/scripts/session-concurrency.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const requestedSession = args.session_id ? listSessions({ root }).find((item) => item.session_id === args.session_id) : null;
if (args.session_id && !requestedSession) throw new Error(`session not found: ${args.session_id}`);
if (requestedSession) {
  const checked = checkSession({ root, sessionId: requestedSession.session_id });
  if (checked.status !== 'ready') throw new Error(`session ownership check failed: ${checked.outside_claim_paths.join(', ')}`);
}
const localState = path.join(root, '00_project/state');
const sessionState = requestedSession ? path.join(root, '_work/current/concurrency/sessions') : localState;
const planPath = requestedSession ? path.join(sessionState, `${requestedSession.session_id}.close-plan.json`) : path.join(localState, 'task-close-plan.json');
const resultPath = requestedSession ? path.join(sessionState, `${requestedSession.session_id}.close-result.json`) : path.join(localState, 'task-close-result.json');
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const baseline = requestedSession
  ? read(path.join(sessionState, `${requestedSession.session_id}.baseline.json`)) || { paths: [] }
  : read(args.baseline ? path.resolve(root, args.baseline) : path.join(localState, 'task-baseline.json')) || { paths: [] };
const ownedPaths = args.owned_paths
  ? JSON.parse(fs.readFileSync(path.resolve(root, args.owned_paths), 'utf8'))
  : requestedSession?.claims?.includes('__workspace__') ? null : requestedSession?.claims || null;

if (args._[0] === 'status') { console.log(JSON.stringify({ plan: read(planPath), result: read(resultPath) }, null, 2)); process.exit(0); }

const request = requestedSession
  ? { close_requested: true, qa_passed: true, task_id: requestedSession.task_id, commit_message: args.message || `自动交付 ${requestedSession.task_id}` }
  : read(path.join(localState, 'task-close-request.json'));
if (!request?.close_requested) throw new Error('task close requires close_requested=true');
if (request.qa_passed !== true) throw new Error('task close requires qa_passed=true');
const deliveryLock = args._[0] === 'execute' ? acquireProjectLock(root, 'leader-delivery') : null;
if (deliveryLock) process.on('exit', () => releaseProjectLock(deliveryLock));
const externalLibrarySync = requestedSession ? { status: 'session-scoped', skipped: true } : syncExternalLibraries({ projectRoot: root, event: 'task-close' });
const delivery = classifyPaths(root, undefined, baseline, ownedPaths);
const architecture = spawnSync(process.execPath, ['tests/architecture-smoke.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
if (architecture.status !== 0) throw new Error(`architecture gate failed: ${architecture.stderr || architecture.stdout}`);
if (args._[0] !== 'execute') {
  const plan = { schema_version: 1, task_id: request.task_id || null, created_at: nowIso(), close_requested: true, qa_passed: true, candidates: delivery.candidates, files: digestFiles(root, delivery.candidates), delivery: { gitee: delivery.gitee, drive: delivery.drive }, excluded: delivery.excluded, external_library_sync: externalLibrarySync, status: 'planned' };
  jsonWrite(planPath, plan); console.log(JSON.stringify(plan, null, 2)); process.exit(0);
}

const plan = read(args.plan || planPath);
if (!plan || plan.status !== 'planned' || !Array.isArray(plan.candidates) || !plan.candidates.length) throw new Error('execute requires a non-empty planned task-close plan');
const current = classifyPaths(root, undefined, baseline, ownedPaths);
if (JSON.stringify(current.candidates) !== JSON.stringify(plan.candidates)) throw new Error('delivery plan is stale; regenerate task-close plan');
const currentFiles = digestFiles(root, plan.candidates);
if (JSON.stringify(currentFiles) !== JSON.stringify(plan.files)) throw new Error('delivery file hashes changed; regenerate task-close plan');
runGit(root, ['add', '--', ...plan.candidates]);
const commit = runGit(root, ['-c', 'user.name=Codex', '-c', 'user.email=codex@local', 'commit', '-m', request.commit_message || `自动交付 ${request.task_id || 'muIon-beam'}`], { allowFailure: true });
if (commit.status !== 0) throw new Error(commit.stderr || commit.stdout || 'commit failed');
const commitHash = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
runGit(root, ['push', 'origin', 'HEAD:main'], { timeout: 120000 });
const remote = runGit(root, ['ls-remote', 'origin', 'refs/heads/main']).stdout.trim().split(/\s+/)[0] || null;
if (remote !== commitHash) throw new Error('remote main does not match committed revision');
const snapshotId = `SNAPSHOT-${commitHash.slice(0, 12)}`;
const drivePath = args.drive_path || `H:\\我的云端硬盘\\muIon_archive\\project-management\\project-snapshots\\${snapshotId}`;
const snapshot = spawnSync(process.execPath, [path.join(import.meta.dirname, 'sync-project-snapshot.mjs'), '--project-root', root, '--snapshot-id', snapshotId, '--branch-ref', 'main', '--drive-path', drivePath], { cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
const result = { ...plan, status: snapshot.status === 0 ? 'complete' : 'pending', commit: commitHash, remote, snapshot: snapshot.stdout || null, snapshot_error: snapshot.stderr || null, finished_at: nowIso() };
jsonWrite(resultPath, result);
console.log(JSON.stringify(result, null, 2));
process.exitCode = snapshot.status === 0 ? 0 : 2;
