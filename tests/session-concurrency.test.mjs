import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  beginSession,
  checkSession,
  cleanupClosedSession,
  cleanupSupersededSession,
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

test('closed delivery cleans when a newer same-host session owns another worktree', () => {
  const { root, git } = fixture(); const sessions = [];
  try {
    const old = beginSession({ root, sessionId: 'old-host-session', hostSessionId: 'host-reused', ownedPaths: ['a.txt'] }); sessions.push(old);
    fs.writeFileSync(path.join(old.worktree_path, 'a.txt'), 'delivered\n');
    git('-C', old.worktree_path, 'add', 'a.txt'); git('-C', old.worktree_path, 'commit', '-m', 'delivered');
    submitSession({ root, sessionId: old.session_id }); applyIntegration({ root, sessionId: old.session_id });
    const newer = beginSession({ root, sessionId: 'new-host-session', hostSessionId: 'host-reused', ownedPaths: ['b.txt'] }); sessions.push(newer);
    const farmerState = path.join(root, '_work/current/farmer/state.json'); fs.mkdirSync(path.dirname(farmerState), { recursive: true });
    fs.writeFileSync(farmerState, JSON.stringify({ 'host-reused': { status: 'running' } }));
    const closed = closeSession({ root, sessionId: old.session_id, token: old.owner_token, cleanup: true });
    assert.equal(closed.cleanup_completed, true); assert.equal(closed.cleanup_pending, false); assert.equal(fs.existsSync(old.worktree_path), false);
    assert.equal(listSessions({ root }).find(item => item.session_id === newer.session_id)?.status, 'active');
  } finally { cleanup(root, sessions.filter(item => fs.existsSync(item.worktree_path))); }
});

test('supersession cleanup verifies fixed source, Drive hashes and host completion before preserving then removing', () => {
  const { root, git } = fixture(); const session = beginSession({ root, sessionId: 'superseded', hostSessionId: 'host-superseded', ownedPaths: ['a.txt'] });
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  try {
    const candidate = 'replacement\n';
    fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), candidate);
    git('-C', session.worktree_path, 'add', 'a.txt'); git('-C', session.worktree_path, 'commit', '-m', 'worker replacement');
    const sourceCommit = spawnSync('git', ['-C', session.worktree_path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const retainedPath = path.join(session.worktree_path, '_work/private.txt'); fs.mkdirSync(path.dirname(retainedPath), { recursive: true }); fs.writeFileSync(retainedPath, 'keep this runtime file');
    const nestedRepo = path.join(session.worktree_path, '_work/cache/nested-repository'); fs.mkdirSync(nestedRepo, { recursive: true });
    execFileSync('git', ['init', '--initial-branch=main', nestedRepo], { stdio: 'ignore' });
    fs.writeFileSync(path.join(nestedRepo, 'payload.txt'), 'keep this nested repository');
    execFileSync('git', ['-C', nestedRepo, 'add', 'payload.txt'], { stdio: 'ignore' });
    execFileSync('git', ['-C', nestedRepo, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'nested cache'], { stdio: 'ignore' });
    const nestedHead = spawnSync('git', ['-C', nestedRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const commonDir = spawnSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim();
    const exclude = path.resolve(root, commonDir, 'info/exclude'); fs.mkdirSync(path.dirname(exclude), { recursive: true }); fs.appendFileSync(exclude, '\nignored/\n');
    const unknownPath = path.join(session.worktree_path, 'ignored/mystery.txt'); fs.mkdirSync(path.dirname(unknownPath), { recursive: true }); fs.writeFileSync(unknownPath, 'must block cleanup');
    fs.writeFileSync(path.join(root, 'a.txt'), candidate); git('add', 'a.txt'); git('commit', '-m', 'equivalent main replacement');
    const traceability = path.join(root, '00_project/traceability'); fs.mkdirSync(traceability, { recursive: true });
    const dispositionPath = path.join(traceability, 'disposition.json');
    fs.writeFileSync(dispositionPath, JSON.stringify({ status: 'verified', path_mappings: [{ source_path: 'a.txt', disposition: 'equivalent-main-content' }] }) + '\n');
    const driveReadback = { status: 'verified', files: [
      { path: 'a.txt', bytes: Buffer.byteLength(candidate), sha256: digest(fs.readFileSync(path.join(root, 'a.txt'))) },
      { path: '00_project/traceability/disposition.json', bytes: fs.statSync(dispositionPath).size, sha256: digest(fs.readFileSync(dispositionPath)) },
    ] };
    const drivePath = path.join(traceability, 'drive-readback.json'); fs.writeFileSync(drivePath, JSON.stringify(driveReadback) + '\n');
    const quarantinePath = path.join(traceability, 'quarantine-readback.json'); fs.writeFileSync(quarantinePath, JSON.stringify({ status: 'verified', files: [{ path: '90_migration/quarantine/other-session.txt', verified: true, bytes: 1, source_sha256: 'a'.repeat(64), cloud_sha256: 'a'.repeat(64) }] }) + '\n');
    const bare = path.join(root, '_work/current/test-remote.git'); fs.mkdirSync(path.dirname(bare), { recursive: true });
    execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' });
    const publicationPath = path.join(root, '00_project/config/publish-policy.json'); fs.mkdirSync(path.dirname(publicationPath), { recursive: true });
    fs.writeFileSync(publicationPath, JSON.stringify({ remote: 'origin', branch: 'main' }) + '\n');
    git('add', '00_project/traceability', '00_project/config/publish-policy.json'); git('commit', '-m', 'record cleanup readback fixture');
    git('remote', 'add', 'origin', bare); git('push', '-u', 'origin', 'main');
    const clonePath = path.join(root, '_work/current/publish-outbox/gitee-clean-clone'); fs.mkdirSync(path.dirname(clonePath), { recursive: true });
    execFileSync('git', ['clone', '--branch', 'main', bare, clonePath], { stdio: 'ignore' });
    const mainCommit = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const mergeBase = spawnSync('git', ['-C', root, 'merge-base', 'main', sourceCommit], { encoding: 'utf8' }).stdout.trim();
    const blob = spawnSync('git', ['-C', root, 'show', `${sourceCommit}:a.txt`], { encoding: null }).stdout;
    const mapping = { source_path: 'a.txt', source_sha256: digest(blob), delivery_path: 'a.txt', delivery_sha256: digest(fs.readFileSync(path.join(root, 'a.txt'))), drive_sha256: digest(fs.readFileSync(path.join(root, 'a.txt'))), disposition: 'equivalent-main-content', disposition_ref: '00_project/traceability/disposition.json' };
    const receipt = {
      schema_version: 1, record_type: 'superseded-worktree-cleanup', status: 'verified', session_id: session.session_id,
      branch: session.branch, worktree_path: session.worktree_path, source_commit: sourceCommit, main_commit: mainCommit, merge_base: mergeBase,
      path_mappings: [mapping], drive_readback: { status: 'verified', file: '00_project/traceability/drive-readback.json', sha256: digest(fs.readFileSync(drivePath)) },
      disposition_evidence: { file: '00_project/traceability/disposition.json', sha256: digest(fs.readFileSync(dispositionPath)) },
      gitee_readback: { status: 'verified', clone_path: '_work/current/publish-outbox/gitee-clean-clone', remote: 'origin', branch: 'main', commit: mainCommit, remote_head: mainCommit },
      quarantine_readback_file: '00_project/traceability/quarantine-readback.json', preserve_roots: [{ prefix: '_work/', mode: 'all', archive_prefix: 'legacy-runtime' }], rebuildable_roots: [],
      process_check: { status: 'clear', checked_at: new Date().toISOString(), process_ids: [] },
    };
    const receiptPath = path.join(root, '_work/current/publish-outbox/supersession-receipts/superseded.json');
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    const writeReceipt = () => fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    writeReceipt();
    const farmerState = path.join(root, '_work/current/farmer/state.json'); fs.mkdirSync(path.dirname(farmerState), { recursive: true });
    fs.writeFileSync(farmerState, JSON.stringify({ 'host-superseded': { status: 'running' } }));
    assert.throws(() => cleanupSupersededSession({ root, sessionId: session.session_id, receiptPath }), /host completion is unknown/);
    fs.writeFileSync(farmerState, JSON.stringify({}));
    closeSession({ root, sessionId: session.session_id, token: session.owner_token, cleanup: false });
    receipt.host_completion = { host_session_id: 'host-superseded', status: 'not-found', source: 'Codex app and read-only local index audit', verified_at: new Date().toISOString(), absence_checks: { active_lookup: 'not-found', archived_lookup: 'not-found', state_index: 'not-found', turn_history: 'not-found' } };
    receipt.quarantine_file_count = 2; writeReceipt();
    assert.throws(() => cleanupSupersededSession({ root, sessionId: session.session_id, receiptPath }), /quarantine Drive readback does not cover the fixed receipt count/);
    receipt.quarantine_file_count = 1;
    writeReceipt();
    execFileSync('git', ['-C', clonePath, 'remote', 'set-url', 'origin', bare + '-wrong']);
    assert.throws(() => cleanupSupersededSession({ root, sessionId: session.session_id, receiptPath }), /Gitee recovery clone has the wrong origin/);
    execFileSync('git', ['-C', clonePath, 'remote', 'set-url', 'origin', bare]);
    assert.throws(() => cleanupSupersededSession({ root, sessionId: session.session_id, receiptPath }), /ignored worktree path has no safe disposition/);
    assert.equal(fs.existsSync(session.worktree_path), true);
    fs.unlinkSync(unknownPath);
    driveReadback.files[0].sha256 = '0'.repeat(64); fs.writeFileSync(drivePath, JSON.stringify(driveReadback) + '\n');
    git('add', '00_project/traceability/drive-readback.json'); git('commit', '-m', 'tamper readback fixture');
    git('push', 'origin', 'main'); execFileSync('git', ['-C', clonePath, 'pull', '--ff-only', 'origin', 'main'], { stdio: 'ignore' });
    receipt.main_commit = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    receipt.gitee_readback.commit = receipt.main_commit; receipt.gitee_readback.remote_head = receipt.main_commit;
    receipt.drive_readback.sha256 = digest(fs.readFileSync(drivePath)); writeReceipt();
    assert.throws(() => cleanupSupersededSession({ root, sessionId: session.session_id, receiptPath }), /Drive replacement hash is unverified/);
    driveReadback.files[0].sha256 = mapping.delivery_sha256; fs.writeFileSync(drivePath, JSON.stringify(driveReadback) + '\n');
    git('add', '00_project/traceability/drive-readback.json'); git('commit', '-m', 'restore verified readback fixture');
    git('push', 'origin', 'main'); execFileSync('git', ['-C', clonePath, 'pull', '--ff-only', 'origin', 'main'], { stdio: 'ignore' });
    receipt.main_commit = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    receipt.gitee_readback.commit = receipt.main_commit; receipt.gitee_readback.remote_head = receipt.main_commit;
    receipt.drive_readback.sha256 = digest(fs.readFileSync(drivePath)); writeReceipt();
    const result = cleanupSupersededSession({ root, sessionId: session.session_id, receiptPath });
    assert.equal(result.cleanup_completed, true);
    assert.equal(fs.existsSync(session.worktree_path), false);
    assert.equal(fs.readFileSync(path.join(root, '_work/current/supersession-preserved/superseded/legacy-runtime/private.txt'), 'utf8'), 'keep this runtime file');
    const preservedRepo = path.join(root, '_work/current/supersession-preserved/superseded/legacy-runtime/cache/nested-repository');
    assert.equal(fs.readFileSync(path.join(preservedRepo, 'payload.txt'), 'utf8'), 'keep this nested repository');
    assert.equal(spawnSync('git', ['-C', preservedRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), nestedHead);
    assert.notEqual(spawnSync('git', ['-C', root, 'show-ref', '--verify', '--quiet', 'refs/heads/' + session.branch], { encoding: 'utf8' }).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '_work/current/publish-outbox/supersession-cleanup/superseded.json'), 'utf8')).status, 'branch-removed');
  } finally { cleanup(root, [session]); }
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
