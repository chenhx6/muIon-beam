import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  beginSession,
  checkSession,
  cleanupClosedSession,
  closeSession,
  applyIntegration,
  claimsOverlap,
  listSessions,
  normalizeClaimPath,
  reapSession,
  resumeSession,
  submitSession,
} from '../.codex/skills/team/scripts/session-concurrency.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-session-concurrency-'));
  const git = (...args) => { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr); };
  git('init', '-b', 'main'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(root, '.gitignore'), '_work/\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n'); fs.writeFileSync(path.join(root, 'b.txt'), 'b\n');
  git('add', '.'); git('commit', '-m', 'base');
  return { root, git };
}

function cleanup(root, sessions) {
  for (const session of sessions) {
    try { closeSession({ root, sessionId: session.session_id, token: session.owner_token, cleanup: true }); } catch {}
    if (session.worktree_path && path.resolve(session.worktree_path) !== path.resolve(root)) {
      spawnSync('git', ['worktree', 'remove', '--force', session.worktree_path], { cwd: root, encoding: 'utf8' });
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

test('normalizes Windows path aliases and detects wildcard overlap', () => {
  assert.equal(normalizeClaimPath('C:/repo', 'src/../Package.json'), 'package.json');
  assert.equal(claimsOverlap(['src/**'], ['src/a/file.js']), true);
  assert.equal(claimsOverlap(['Package.json'], ['package.json']), true);
  assert.equal(normalizeClaimPath('C:/repo', '02_models/'), '02_models');
});

test('help is read-only and does not create a session', () => {
  const { root } = fixture();
  try {
    const cli = path.resolve('.codex/skills/team/scripts/session-concurrency.mjs');
    const result = spawnSync(process.execPath, [cli, 'begin', '--help', '--project-root', root], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0); assert.match(result.stdout, /Usage: node session-concurrency/);
    assert.equal(fs.existsSync(path.join(root, '_work/current/concurrency/sessions')), false);
  } finally { cleanup(root, []); }
});

test('creates an isolated worktree and private baseline per session', () => {
  const { root } = fixture(); const sessions = [];
  try {
    const session = beginSession({ root, sessionId: 'alpha', taskId: 'T-ALPHA', ownedPaths: ['a.txt'] }); sessions.push(session);
    assert.equal(session.mode, 'worktree'); assert.equal(session.branch, 'codex/session/alpha');
    assert.notEqual(path.resolve(session.worktree_path), path.resolve(root));
    assert.equal(fs.existsSync(path.join(root, session.baseline_path)), true);
    fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'worker\n');
    assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'a\n');
  } finally { cleanup(root, sessions); }
});

test('rejects two active sessions claiming the same file but allows disjoint files', () => {
  const { root } = fixture(); const sessions = [];
  try {
    sessions.push(beginSession({ root, sessionId: 'one', ownedPaths: ['a.txt'] }));
    assert.throws(() => beginSession({ root, sessionId: 'two', ownedPaths: ['A.TXT'] }), /path claim collision/);
    assert.equal(fs.existsSync(path.join(root, '_work/current/worktrees/two')), false);
    sessions.push(beginSession({ root, sessionId: 'three', ownedPaths: ['b.txt'] }));
    assert.equal(listSessions({ root }).filter((item) => item.status === 'active').length, 2);
  } finally { cleanup(root, sessions); }
});

test('legacy shared writer claims the whole checkout and rejects a second writer', () => {
  const { root } = fixture(); const sessions = [];
  try {
    sessions.push(beginSession({ root, sessionId: 'legacy', mode: 'shared-write', allowDirtyShared: true }));
    assert.throws(() => beginSession({ root, sessionId: 'other', mode: 'shared-write' }), /path claim collision|clean leader checkout/);
  } finally { cleanup(root, sessions); }
});

test('checkSession blocks writes outside the declared ownership', () => {
  const { root } = fixture(); const sessions = [];
  try {
    const session = beginSession({ root, sessionId: 'bounded', ownedPaths: ['a.txt'] }); sessions.push(session);
    fs.writeFileSync(path.join(session.worktree_path, 'b.txt'), 'escape\n');
    const checked = checkSession({ root, sessionId: session.session_id });
    assert.equal(checked.status, 'blocked'); assert.deepEqual(checked.outside_claim_paths, ['b.txt']);
  } finally { cleanup(root, sessions); }
});

test('submit requires a clean worker worktree after scoped checkpoint', () => {
  const { root } = fixture(); const sessions = [];
  try {
    const session = beginSession({ root, sessionId: 'submit', ownedPaths: ['a.txt'] }); sessions.push(session);
    fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'worker\n');
    assert.throws(() => submitSession({ root, sessionId: session.session_id }), /clean worktree/);
  } finally { cleanup(root, sessions); }
});

test('resumes a submitted worker in the same worktree after explicit approval', () => {
  const { root, git } = fixture(); const sessions = [];
  try {
    const session = beginSession({ root, sessionId: 'resume', ownedPaths: ['a.txt'] }); sessions.push(session);
    fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'worker\n');
    const checkpoint = (args) => { const result = spawnSync('git', args, { cwd: session.worktree_path, encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr); };
    checkpoint(['add', 'a.txt']); checkpoint(['commit', '-m', 'worker checkpoint']);
    submitSession({ root, sessionId: session.session_id });
    const resumed = resumeSession({ root, sessionId: session.session_id, reason: 'approved plan continuation' });
    assert.equal(resumed.status, 'active'); assert.equal(resumed.resumed_at !== undefined, true); assert.equal(resumed.resume_reason, 'approved plan continuation');
    assert.equal(resumed.worktree_path, session.worktree_path); assert.equal(resumed.branch, session.branch);
    assert.equal(fs.existsSync(path.join(root, '_work/current/concurrency/sessions/resume.integration.json')), true);
  } finally { cleanup(root, sessions); }
});

test('reaps only an expired clean session and releases its claim', async () => {
  const { root } = fixture();
  try {
    const session = beginSession({ root, sessionId: 'expired', ownedPaths: ['a.txt'], leaseMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const reaped = reapSession({ root, sessionId: session.session_id });
    assert.equal(reaped.status, 'abandoned'); assert.equal(reaped.reaped, true);
    const replacement = beginSession({ root, sessionId: 'replacement', ownedPaths: ['a.txt'] });
    assert.equal(replacement.status, 'active'); cleanup(root, [replacement]);
  } finally { cleanup(root, []); }
});

test('closed delivery waits for the host to finish, then removes only the merged clean branch', () => {
  const { root, git } = fixture(); const session = beginSession({ root, sessionId: 'cleanup', hostSessionId: 'host-cleanup', ownedPaths: ['a.txt'] });
  const worktree = session.worktree_path;
  fs.writeFileSync(path.join(worktree, 'a.txt'), 'delivered\n');
  git('-C', worktree, 'add', 'a.txt'); git('-C', worktree, 'commit', '-m', 'delivered');
  submitSession({ root, sessionId: session.session_id });
  const leaderStatus = spawnSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout;
  assert.equal(leaderStatus, '', 'leader unexpectedly dirty before integration: ' + leaderStatus);
  const integrated = applyIntegration({ root, sessionId: session.session_id });
  assert.equal(integrated.status, 'integrated');
  const farmerState = path.join(root, '_work/current/farmer/state.json'); fs.mkdirSync(path.dirname(farmerState), { recursive: true });
  fs.writeFileSync(farmerState, JSON.stringify({ 'host-cleanup': { status: 'running' } }));
  const closed = closeSession({ root, sessionId: session.session_id, token: session.owner_token, cleanup: true });
  assert.equal(closed.status, 'closed'); assert.equal(closed.cleanup_pending, true); assert.equal(fs.existsSync(worktree), true);
  fs.writeFileSync(farmerState, JSON.stringify({ 'host-cleanup': { status: 'complete' } }));
  const cleaned = cleanupClosedSession({ root, sessionId: session.session_id });
  assert.equal(cleaned.cleanup_completed, true); assert.equal(cleaned.cleanup_pending, false); assert.equal(fs.existsSync(worktree), false);
  assert.notEqual(spawnSync('git', ['-C', root, 'show-ref', '--verify', '--quiet', 'refs/heads/' + session.branch], { encoding: 'utf8' }).status, 0);
});

test('cleanup rejects unique ignored worktree files', () => {
  const { root, git } = fixture(); const session = beginSession({ root, sessionId: 'ignored-cleanup', ownedPaths: ['a.txt'] });
  fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'delivered\n');
  git('-C', session.worktree_path, 'add', 'a.txt'); git('-C', session.worktree_path, 'commit', '-m', 'delivered');
  submitSession({ root, sessionId: session.session_id }); applyIntegration({ root, sessionId: session.session_id });
  const ignored = path.join(session.worktree_path, '_work/private.txt'); fs.mkdirSync(path.dirname(ignored), { recursive: true }); fs.writeFileSync(ignored, 'retain me');
  assert.throws(() => closeSession({ root, sessionId: session.session_id, token: session.owner_token, cleanup: true }), /ignored content/);
  assert.equal(fs.existsSync(session.worktree_path), true);
  assert.equal(spawnSync('git', ['-C', root, 'show-ref', '--verify', '--quiet', 'refs/heads/' + session.branch], { encoding: 'utf8' }).status, 0);
});
