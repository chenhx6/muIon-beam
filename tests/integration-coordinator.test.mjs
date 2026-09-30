import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyIntegration, beginSession, continueAfterIntegration, listSessions, planIntegration, resumeSession, submitSession } from '../.codex/skills/team/scripts/session-concurrency.mjs';
import { finalizePlanNodeDelivery, integratePrepared } from '../11_tools/project-supervisor/integration-coordinator.mjs';

const project = path.resolve(import.meta.dirname, '..');
const autoCommitScript = path.join(project, '.codex/skills/muion-project/scripts/auto-commit-push.mjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-integration-')); t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr || r.stdout); };
  git('init', '-b', 'main'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.invalid'); fs.writeFileSync(path.join(root, '.gitignore'), '_work/\n'); fs.writeFileSync(path.join(root, 'a.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'base'); return { root, git };
}
test('clean worker is submitted and integrated under the leader gate', t => {
  const f = fixture(t); const session = beginSession({ root: f.root, sessionId: 'worker', ownedPaths: ['a.txt'] });
  fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'worker\n');
  f.git('-C', session.worktree_path, 'add', 'a.txt'); f.git('-C', session.worktree_path, 'commit', '-m', 'worker change');
  const result = integratePrepared({ root: f.root, sessionId: session.session_id });
  assert.equal(result.status, 'integrated'); assert.equal(fs.readFileSync(path.join(f.root, 'a.txt'), 'utf8').replaceAll('\r\n','\n'), 'worker\n');
});
test('leader conflict preserves the worker branch and records a blocked receipt', t => {
  const f = fixture(t); const session = beginSession({ root: f.root, sessionId: 'worker', ownedPaths: ['a.txt'] });
  fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'worker\n'); f.git('-C', session.worktree_path, 'add', 'a.txt'); f.git('-C', session.worktree_path, 'commit', '-m', 'worker change');
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'leader\n'); f.git('add', 'a.txt'); f.git('commit', '-m', 'leader change');
  const result = integratePrepared({ root: f.root, sessionId: session.session_id });
  assert.equal(result.status, 'blocked-conflict'); assert.ok(result.conflicts.includes('a.txt')); assert.equal(fs.readFileSync(path.join(session.worktree_path, 'a.txt'), 'utf8').replaceAll('\r\n','\n'), 'worker\n');
});
test('dirty leader is blocked before integration and worker remains untouched', t => {
  const f = fixture(t); const session = beginSession({ root: f.root, sessionId: 'worker', ownedPaths: ['a.txt'] });
  fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'worker\n'); f.git('-C', session.worktree_path, 'add', 'a.txt'); f.git('-C', session.worktree_path, 'commit', '-m', 'worker change');
  fs.writeFileSync(path.join(f.root, 'leader-note.txt'), 'keep\n'); const result = integratePrepared({ root: f.root, sessionId: session.session_id });
  assert.equal(result.status, 'blocked-dirty-leader'); assert.equal(fs.readFileSync(path.join(session.worktree_path, 'a.txt'), 'utf8').replaceAll('\r\n','\n'), 'worker\n');
});

test('resuming invalidates integration eligibility until a fresh clean submission', t => {
  const f = fixture(t); const session = beginSession({ root: f.root, sessionId: 'resume', ownedPaths: ['a.txt'] });
  const args = { root: f.root, sessionId: session.session_id };
  const receiptPath = path.join(f.root, '_work/current/concurrency/sessions/resume.integration.json');
  const checkpoint = value => {
    fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), value);
    f.git('-C', session.worktree_path, 'add', 'a.txt');
    f.git('-C', session.worktree_path, 'commit', '-m', value.trim());
  };
  checkpoint('submitted\n'); submitSession(args);
  const oldReceipt = fs.readFileSync(receiptPath, 'utf8');
  resumeSession({ ...args, reason: 'continue unfinished plan' });
  assert.throws(() => applyIntegration(args), /submitted/);
  assert.throws(() => planIntegration(args), /submitted/);
  assert.equal(integratePrepared(args).status, 'blocked-submit');
  assert.equal(fs.readFileSync(receiptPath, 'utf8'), oldReceipt);
  checkpoint('continued\n'); submitSession(args);
  const newReceipt = fs.readFileSync(receiptPath, 'utf8');
  checkpoint('changed after submission\n');
  assert.throws(() => applyIntegration(args), /stale/);
  assert.equal(integratePrepared(args).status, 'blocked-submit');
  assert.equal(fs.readFileSync(receiptPath, 'utf8'), newReceipt);
  assert.equal(fs.readFileSync(path.join(f.root, 'a.txt'), 'utf8').trim(), 'base');
  const submitted = submitSession(args);
  fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'uncommitted\n');
  assert.throws(() => applyIntegration(args), /clean worktree/);
  fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'changed after submission\n');
  const result = integratePrepared(args);
  assert.equal(result.status, 'integrated');
  assert.equal(result.source_head, submitted.source_head);
  assert.equal(fs.readFileSync(path.join(f.root, 'a.txt'), 'utf8').trim(), 'changed after submission');
});

test('integrated worker can continue the next plan node in the same worktree', t => {
  const f = fixture(t); const session = beginSession({ root: f.root, sessionId: 'same-worker', ownedPaths: ['a.txt'] });
  const args = { root: f.root, sessionId: session.session_id };
  const checkpoint = value => {
    fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), value + '\n');
    f.git('-C', session.worktree_path, 'add', 'a.txt');
    f.git('-C', session.worktree_path, 'commit', '-m', value);
  };
  checkpoint('node-one'); submitSession(args);
  const first = integratePrepared(args); assert.equal(first.status, 'integrated');
  const mainHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).stdout.trim();
  const continued = continueAfterIntegration({ ...args, reason: 'node one delivered; continue node two' });
  assert.equal(continued.status, 'active'); assert.equal(continued.branch, session.branch); assert.equal(continued.worktree_path, session.worktree_path);
  assert.equal(continued.base_ref, mainHead);
  checkpoint('node-two'); const secondReceipt = submitSession(args);
  assert.deepEqual(secondReceipt.changed_paths, ['a.txt']);
  const second = integratePrepared(args); assert.equal(second.status, 'integrated');
  assert.equal(second.source_head, secondReceipt.source_head);
  assert.equal(fs.readFileSync(path.join(f.root, 'a.txt'), 'utf8').trim(), 'node-two');
});


test('two isolated plan nodes integrate, test, push and mirror without creating a test remote tag', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-node-delivery-'));
  const root = path.join(base, 'repo'); const remote = path.join(base, 'remote.git'); const drive = path.join(base, 'drive');
  fs.mkdirSync(root, { recursive: true });
  t.after(() => { assert.equal(path.dirname(path.resolve(base)), path.resolve(os.tmpdir())); fs.rmSync(base, { recursive: true, force: true }); });
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim();
  };
  const bare = spawnSync('git', ['-C', base, 'init', '--bare', '-b', 'main', remote], { encoding: 'utf8', windowsHide: true });
  assert.equal(bare.status, 0, bare.stderr || bare.stdout);
  git('init', '-b', 'main'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.invalid');
  const put = (file, value) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
  put('.gitignore', '_work/\n'); put('README.md', 'base\n');
  put('00_project/config/publish-policy.json', JSON.stringify({ schema_version: 1, remote: 'origin', branch: 'main', author: { name: 'test', email: 'test@example.invalid' } }));
  put('00_project/config/delivery-policy.json', fs.readFileSync(path.join(project, '00_project/config/delivery-policy.json')));
  put('00_project/config/drive-mirror-policy.json', JSON.stringify({ schema_version: 1, source_root: root, drive_root: drive, layout: 'local-relative-tree', include_prefixes: [''], include_files: [], exclude_directory_names: ['.git', '_work', 'node_modules'], exclude_paths: [], exclude_extensions: ['.tmp'], cleanup_rule: 'copy-only' }));
  put('00_project/traceability/recovery-index.json', JSON.stringify({ current: true }));
  put('tests/node-delivery.test.mjs', "import test from 'node:test'; import assert from 'node:assert/strict'; test('node fixture', () => assert.equal(2 + 2, 4));\n");
  put('tests/architecture-smoke.mjs', 'process.exit(0);\n');
  const planPath = '10_plans/active/delivery/plan_v3.json';
  const plan = { schema_version: 1, plan_id: 'plan_delivery_fixture', task_id: 'TASK-DELIVERY-FIXTURE', status: 'executing', current_phase: 'P3', next_action: 'N1', session_ids: ['same-worker'], phases: [{ id: 'P3', status: 'in-progress' }], nodes: [{ id: 'N1', status: 'pending', validation: { test_files: ['tests/node-delivery.test.mjs'], architecture_check: false } }, { id: 'N2', status: 'pending', validation: { test_files: ['tests/node-delivery.test.mjs'], architecture_check: false } }], checkpoint: { completed_requirements: [], next_action: 'N1' } };
  put(planPath, JSON.stringify(plan, null, 2) + '\n');
  git('add', '.'); git('commit', '-m', 'base'); git('remote', 'add', 'origin', remote); git('push', '-u', 'origin', 'main');
  const session = beginSession({ root, sessionId: 'same-worker', taskId: plan.task_id, ownedPaths: ['00_project/traceability/node-one.md', '00_project/traceability/node-two.md', '10_plans/active/delivery/plan_v3.json'] });
  const autoPublish = (...args) => spawnSync(process.execPath, [autoCommitScript, '--project-root', session.worktree_path, '--session-id', session.session_id, ...args], { cwd: session.worktree_path, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const checkpoint = (nodeId, nodeFile) => {
    const pathToPlan = path.join(session.worktree_path, planPath); const current = JSON.parse(fs.readFileSync(pathToPlan, 'utf8'));
    current.nodes.find(node => node.id === nodeId).status = 'ready-for-delivery'; fs.writeFileSync(pathToPlan, JSON.stringify(current, null, 2) + '\n');
    fs.writeFileSync(path.join(session.worktree_path, nodeFile), nodeId + '\n');
    const result = autoPublish('--node', nodeId, '--plan-file', planPath, '--drive-root', drive);
    assert.ok([0, 2].includes(result.status), result.stderr); return JSON.parse(result.stdout);
  };
  const rejectMainHook = path.join(remote, 'hooks', 'pre-receive');
  fs.writeFileSync(rejectMainHook, '#!/bin/sh\nwhile read old new ref; do if [ "$ref" = "refs/heads/main" ]; then exit 1; fi; done\nexit 0\n'); fs.chmodSync(rejectMainHook, 0o755);
  const failedPush = checkpoint('N1', '00_project/traceability/node-one.md');
  assert.equal(failedPush.status, 'pending-main-push');
  const failedRecord = JSON.parse(fs.readFileSync(failedPush.outbox, 'utf8'));
  fs.unlinkSync(rejectMainHook);
  const firstRetry = autoPublish('--node', 'N1', '--plan-file', planPath, '--drive-root', drive); assert.equal(firstRetry.status, 2, firstRetry.stderr);
  const first = JSON.parse(firstRetry.stdout);
  assert.equal(first.status, 'awaiting-cloud-readback'); assert.equal(first.source_commit, failedRecord.source_commit);

  const firstAgainResult = autoPublish('--node', 'N1', '--plan-file', planPath, '--drive-root', drive); assert.equal(firstAgainResult.status, 2, firstAgainResult.stderr); const firstAgain = JSON.parse(firstAgainResult.stdout);
  assert.equal(firstAgain.delivery_commit, first.delivery_commit);
  assert.equal(git('rev-parse', 'HEAD'), first.delivery_commit);
  const noRemoteTags = spawnSync('git', ['--git-dir', remote, 'for-each-ref', '--format=%(refname)', 'refs/tags'], { encoding: 'utf8', windowsHide: true });
  assert.equal(noRemoteTags.stdout.trim(), '');
  const readback = record => ({ status: 'verified', source_commit: record.source_commit, delivery_commit: record.delivery_commit, manifest_sha256: record.drive_manifest_sha256, plan_sha256: record.drive_plan_sha256, remote_head: record.remote_head, drive_root: record.drive_root });
  const tagCalls = []; let failTagOnce = true;
  const testTagPublisher = value => { if (failTagOnce) { failTagOnce = false; throw new Error('simulated tag push failure'); } tagCalls.push(value); return { status: 'test-only', tag: value.tag, commit: value.commit, remote_tag: null }; };
  const firstRecordPath = first.outbox; const firstRecord = JSON.parse(fs.readFileSync(firstRecordPath, 'utf8'));
  const finalizeFirst = () => finalizePlanNodeDelivery({ root: session.worktree_path, sessionId: session.session_id, nodeId: 'N1', planFile: planPath, cloudReadback: readback(firstRecord), driveRoot: drive }, { tagPublisher: testTagPublisher });
  assert.throws(finalizeFirst, /simulated tag push failure/);
  assert.equal(git('rev-parse', 'HEAD'), first.delivery_commit);
  const firstDone = finalizeFirst();
  assert.equal(firstDone.status, 'delivered'); assert.equal(firstDone.lifecycle.status, 'continued');
  assert.equal(tagCalls[0].commit, first.delivery_commit); assert.equal(tagCalls[0].node, 'N1');
  const nextSession = listSessions({ root }).find(item => item.session_id === session.session_id); assert.equal(nextSession.status, 'active');
  const second = checkpoint('N2', '00_project/traceability/node-two.md');
  assert.equal(second.status, 'awaiting-cloud-readback'); assert.notEqual(second.delivery_commit, first.delivery_commit);
  const secondRecord = JSON.parse(fs.readFileSync(second.outbox, 'utf8'));
  const secondDone = finalizePlanNodeDelivery({ root: session.worktree_path, sessionId: session.session_id, nodeId: 'N2', planFile: planPath, cloudReadback: readback(secondRecord), driveRoot: drive, finalNode: true }, { tagPublisher: testTagPublisher });
  assert.equal(secondDone.status, 'delivered'); assert.equal(secondDone.lifecycle.status, 'closed');
  assert.equal(tagCalls.length, 2); assert.equal(tagCalls[1].node, 'N2');
  assert.equal(noRemoteTags.stdout.trim(), '');
  const mainPlan = JSON.parse(fs.readFileSync(path.join(root, planPath), 'utf8'));
  assert.deepEqual(mainPlan.nodes.map(node => node.status), ['delivered', 'delivered']);
  assert.equal(git('show', 'HEAD:00_project/traceability/node-two.md'), 'N2');
});
