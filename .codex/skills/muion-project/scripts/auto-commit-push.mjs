import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, runGit, gitStatusEntries, nowIso, ensureDirectory, jsonWrite } from './project-utils.mjs';
import { syncExternalLibraries } from './external-lib-sync.mjs';
import { acquireProjectLock, releaseProjectLock, checkSession, listSessions } from '../../team/scripts/session-concurrency.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
if (!args.baseline && !args.session_id) throw new Error('automatic commit/push requires --baseline or --session-id');

const baselinePath = args.baseline ? path.resolve(root, args.baseline) : null;
if (baselinePath && !fs.existsSync(baselinePath)) throw new Error(`baseline not found: ${baselinePath}`);
const baseline = baselinePath && fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
const ownedPathFile = args.owned_paths ? path.resolve(root, args.owned_paths) : null;
const ownedPaths = ownedPathFile && fs.existsSync(ownedPathFile) ? new Set(JSON.parse(fs.readFileSync(ownedPathFile, 'utf8')).flatMap((value) => [String(value), String(value).toLowerCase()])) : null;
const sessionId = args.session_id || baseline.session_id || null;
const session = sessionId ? listSessions({ root }).find((item) => item.session_id === sessionId) : null;
if (sessionId && !session) throw new Error(`session not found: ${sessionId}`);
if (sessionId && session?.mode === 'shared-read') throw new Error('read-only session cannot commit');
if (sessionId && session?.mode === 'shared-write' && !args.baseline) throw new Error('shared-write commit requires its private or compatibility baseline');
if (sessionId && session?.mode === 'worktree') {
  const checked = checkSession({ root, sessionId });
  if (checked.status !== 'ready') throw new Error(`session ownership check failed: ${checked.outside_claim_paths.join(', ')}`);
  const worktree = session.worktree_path;
  const dirty = gitStatusEntries(worktree).map((entry) => entry.path).filter(Boolean);
  if (!dirty.length) { console.log(JSON.stringify({ status: 'no-task-owned-files', session_id: sessionId, branch: session.branch, pushed: false }, null, 2)); process.exit(0); }
  const lock = acquireProjectLock(root, 'leader-delivery');
  try {
    runGit(worktree, ['add', '--', ...dirty]);
    const commit = runGit(worktree, ['commit', '--only', '-m', args.message || `session checkpoint ${sessionId}`, '--', ...dirty], { allowFailure: true });
    if (commit.status !== 0) throw new Error(commit.stderr || commit.stdout || 'session checkpoint failed');
    const commitHash = runGit(worktree, ['rev-parse', 'HEAD']).stdout.trim();
    console.log(JSON.stringify({ status: 'session-checkpoint-created', session_id: sessionId, branch: session.branch, worktree, commit: commitHash, pushed: false, note: 'worker commits stay on the isolated branch; leader integration is a separate locked step' }, null, 2));
  } finally { releaseProjectLock(lock); }
  process.exit(0);
}

const lock = acquireProjectLock(root, 'leader-delivery');
try {
  syncExternalLibraries({ projectRoot: root, event: 'auto-publish' });
  const policy = JSON.parse(fs.readFileSync(path.join(root, '00_project/config/publish-policy.json'), 'utf8'));
  const slug = (value) => String(value || 'project-update').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project-update';
  const status = gitStatusEntries(root);
  const paths = status.map((entry) => entry.path).filter(Boolean);
  const baselinePaths = new Set(baseline.paths || []);
  const isBaselinePath = (file) => [...baselinePaths].some((entry) => file === entry || (entry.endsWith('/') && file.startsWith(entry)));
  const existing = paths.filter(isBaselinePath);
  const deletedExternal = new Set(status.filter((entry) => entry.status.includes('D') && entry.path.startsWith('06_external_lib/')).map((entry) => entry.path));
  const managedExternalTrace = (file) => file.startsWith('00_project/traceability/external-libraries/');
  const verifiedSyncStates = paths.filter((file) => !isBaselinePath(file) && file.startsWith('00_project/traceability/sync-states/')).filter((file) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).status === 'three-way-verified'; } catch { return false; }
  });
  const rejected = paths.filter((file) => !isBaselinePath(file) && !managedExternalTrace(file) && !verifiedSyncStates.includes(file) && (policy.never_stage_prefixes.some((prefix) => file.startsWith(prefix)) || policy.never_stage_extensions.some((ext) => file.toLowerCase().endsWith(ext))));
  if (rejected.length) throw new Error('protected paths require explicit project workflow: ' + rejected.join(', '));
  const candidates = paths.filter((file) => (!ownedPaths || ownedPaths.has(file) || ownedPaths.has(file.toLowerCase())) && !isBaselinePath(file) && !deletedExternal.has(file) && !managedExternalTrace(file) && !rejected.includes(file) && (!file.startsWith('00_project/traceability/sync-states/') || verifiedSyncStates.includes(file)) && !file.startsWith('00_project/traceability/sync-outbox/'));
  if (!candidates.length) { console.log(JSON.stringify({ status: 'no-task-owned-files', pushed: false, protected_preexisting: existing, rejected }, null, 2)); process.exit(0); }
  const tests = spawnSync(process.execPath, ['tests/architecture-smoke.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (tests.status !== 0) throw new Error('architecture test failed: ' + (tests.stderr || tests.stdout));
  runGit(root, ['add', '--', ...candidates]);
  const message = args.message || ('自动更新项目工作流 ' + new Date().toISOString().slice(0, 10));
  const commit = runGit(root, ['-c', 'user.name=' + policy.author.name, '-c', 'user.email=' + policy.author.email, 'commit', '--only', '-m', message, '--', ...candidates], { allowFailure: true });
  if (commit.status !== 0) throw new Error(commit.stderr || commit.stdout || 'automatic commit failed');
  const commitHash = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const tag = `b-${slug(args.topic || message)}-${stamp}-${commitHash.slice(0, 7)}`;
  const notePath = path.join(root, '_work/current/publish-notes', `${tag}.md`);
  const note = [`# ${tag}`, '', `基于标签：当前 main`, `基础内容核验：不适用于普通构建 tag`, `本次任务：${args.task || message}`, `本次调整：${message}`, '优化内容：自动提交、架构检查和远端分支校验已完成', '结果：普通构建提交已通过项目架构检查', '主要限制：该 tag 不代表正式研究结果，不包含结果级 Drive 归档和三端审计', `详细报告：${args.report || '见对应 commit、测试输出和任务记录'}`, `Google Drive 归档路径：${args.drive_path || '不适用于普通构建 tag'}`, ''].join('\n');
  ensureDirectory(path.dirname(notePath)); fs.writeFileSync(notePath, note, 'utf8');
  runGit(root, ['tag', '-a', tag, '-F', notePath]);
  runGit(root, ['push', policy.remote, 'HEAD:' + policy.branch], { timeout: 120000 });
  const tagPush = runGit(root, ['push', policy.remote, `refs/tags/${tag}`], { timeout: 120000, allowFailure: true });
  let outbox = null;
  if (tagPush.status !== 0) { outbox = path.join(root, '_work/current/tag-outbox', `${tag}.json`); jsonWrite(outbox, { tag, commit: commitHash, remote: policy.remote, branch: policy.branch, note: notePath, status: 'pending-tag-push', error: (tagPush.stderr || tagPush.stdout || '').trim(), created_at: nowIso() }); }
  const remote = runGit(root, ['ls-remote', policy.remote, 'refs/heads/' + policy.branch]).stdout.trim().split(/\s+/)[0] || null;
  if (remote !== commitHash) throw new Error('remote branch does not match ' + commitHash + ': ' + remote);
  const remoteTag = runGit(root, ['ls-remote', policy.remote, `refs/tags/${tag}^{}`], { allowFailure: true }).stdout.trim();
  console.log(JSON.stringify({ status: tagPush.status === 0 ? 'committed-pushed-and-tagged' : 'committed-and-pushed-tag-pending', commit: commitHash, tag, tag_remote: remoteTag || null, tag_outbox: outbox, candidates, protected_preexisting: existing, rejected, remote, pushed_at: nowIso() }, null, 2));
} finally { releaseProjectLock(lock); }
