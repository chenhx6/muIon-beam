import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, runGit, nowIso, jsonWrite } from './project-utils.mjs';
import { syncExternalLibraries } from './external-lib-sync.mjs';
import { classifyPaths, loadDeliveryPolicy, digestFiles } from './delivery-plan.mjs';
import { acquireProjectLock, releaseProjectLock, checkSession, listSessions } from '../../team/scripts/session-concurrency.mjs';

function readRequired(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function verifyArchitecture(root) {
  const result = spawnSync(process.execPath, ['tests/architecture-smoke.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('architecture test failed: ' + (result.stderr || result.stdout || result.error));
}
function commitFiles(root, candidates, message, author) {
  // --only leaves unrelated staged content untouched. No ordinary build tag.
  runGit(root, ['add', '--', ...candidates]);
  runGit(root, ['-c', 'user.name=' + author.name, '-c', 'user.email=' + author.email, 'commit', '--only', '-m', message, '--', ...candidates]);
  return runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.project_root || projectRootFromHere());
  if (!args.baseline && !args.session_id) throw new Error('automatic commit/push requires --baseline or --session-id');
  let baseline = args.baseline ? readRequired(path.resolve(root, args.baseline), 'baseline') : null;
  const sessionId = args.session_id || baseline?.session_id || null;
  const session = sessionId ? listSessions({ root }).find(item => item.session_id === sessionId) : null;
  if (sessionId && !session) throw new Error(`session not found: ${sessionId}`);
  if (session && session.status !== 'active') throw new Error(`session is not active: ${sessionId}`);
  if (session?.mode === 'shared-read') throw new Error('read-only session cannot commit');
  if (session && !baseline) baseline = readRequired(path.join(root, '_work/current/concurrency/sessions', `${sessionId}.baseline.json`), 'session baseline');
  if (baseline?.session_id && baseline.session_id !== sessionId) throw new Error('baseline/session mismatch');
  if (!baseline || !Array.isArray(baseline.paths)) throw new Error('invalid baseline paths');
  const scopeDocument = args.owned_paths ? readRequired(path.resolve(root, args.owned_paths), 'owned paths') : null;
  const owned = scopeDocument ? (Array.isArray(scopeDocument) ? scopeDocument : scopeDocument.paths) : null;
  if (scopeDocument && !Array.isArray(owned)) throw new Error('owned paths must be an array or an ownership record with paths');
  const publication = readRequired(path.join(root, '00_project/config/publish-policy.json'), 'publish policy');
  const delivery = loadDeliveryPolicy(root);
  const worktree = session?.mode === 'worktree' ? session.worktree_path : root;
  const lock = acquireProjectLock(root, session?.mode === 'worktree' ? `checkpoint:${sessionId}` : 'leader-delivery');
  try {
    if (session) {
      const checked = checkSession({ root, sessionId });
      if (checked.status !== 'ready') throw new Error(`session ownership check failed: ${checked.outside_claim_paths.join(', ')}`);
    }
    if (session?.mode !== 'worktree') syncExternalLibraries({ projectRoot: root, event: 'auto-publish' });
    const plan = classifyPaths(worktree, delivery, baseline, owned);
    const candidatePaths = plan.candidates.filter(file => {
      if (!file.startsWith('00_project/traceability/sync-states/')) return true;
      try { return JSON.parse(fs.readFileSync(path.join(worktree, file), 'utf8')).status === 'three-way-verified'; } catch { return false; }
    });
    // A worker must not checkpoint binary/generated payloads, even with a broad
    // path claim. The leader can still deliver eligible files while retaining
    // unrelated blocked payloads in its main workspace.
    if (session?.mode === 'worktree') {
      const blocked = plan.excluded.filter(item => item.reason !== 'preexisting-user-change');
      if (blocked.length) throw new Error('checkpoint rejected by delivery policy: ' + blocked.map(item => `${item.path} (${item.reason})`).join(', '));
    }
    if (!candidatePaths.length) return { status: 'no-task-owned-files', session_id: sessionId, pushed: false, excluded: plan.excluded };
    const hashes = digestFiles(worktree, candidatePaths);
    verifyArchitecture(worktree);
    const rechecked = classifyPaths(worktree, delivery, baseline, owned).candidates.filter(file => candidatePaths.includes(file));
    if (JSON.stringify(rechecked) !== JSON.stringify(candidatePaths) || JSON.stringify(digestFiles(worktree, candidatePaths)) !== JSON.stringify(hashes)) {
      throw new Error('candidate files changed during validation; regenerate delivery plan');
    }
    const message = args.message || (session?.mode === 'worktree' ? `session checkpoint ${sessionId}` : '自动更新项目工作流 ' + new Date().toISOString().slice(0, 10));
    const commit = commitFiles(worktree, candidatePaths, message, publication.author);
    if (session?.mode === 'worktree') return { status: 'session-checkpoint-created', session_id: sessionId, branch: session.branch, worktree, commit, candidates: candidatePaths, pushed: false };
    const pushed = runGit(root, ['push', publication.remote, `HEAD:${publication.branch}`], { timeout: 120000, allowFailure: true });
    if (pushed.status !== 0) {
      const outbox = path.join(root, '_work/current/publish-outbox', `${commit}.json`);
      jsonWrite(outbox, { commit, remote: publication.remote, branch: publication.branch, status: 'pending-push', error: (pushed.stderr || pushed.stdout || '').trim(), created_at: nowIso() });
      process.exitCode = 2;
      return { status: 'committed-push-pending', commit, pushed: false, outbox };
    }
    const remote = runGit(root, ['ls-remote', publication.remote, `refs/heads/${publication.branch}`]).stdout.trim().split(/\s+/)[0];
    if (remote !== commit) throw new Error('remote branch differs from delivered commit');
    return { status: 'committed-and-pushed', commit, remote, candidates: candidatePaths, excluded: plan.excluded, pushed_at: nowIso() };
  } finally { releaseProjectLock(lock); }
}
console.log(JSON.stringify(main(), null, 2));
