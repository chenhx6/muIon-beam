import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { ArtifactCatalog } from '../11_tools/project-supervisor/artifact-catalog.mjs';
import { aggregateProgress, readCodexSessions, withDisplayNames } from '../11_tools/project-supervisor/progress-aggregator.mjs';

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-progress-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('muion-progress-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  return root;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function addSession(root, session) {
  writeJson(path.join(root, '_work/current/concurrency/sessions', session.session_id + '.json'), session);
}

function addPlan(root, options = {}) {
  const plan = {
    schema_version: 1,
    plan_id: options.plan_id || 'plan-test',
    task_id: options.task_id || 'task-test',
    version: 'v1',
    status: options.status || 'executing',
    human_plan: '10_plans/active/test/plan_v1.md',
    current_phase: options.current_phase || 'P1',
    next_action: options.next_action || '继续下一步',
    session_ids: options.session_ids || [],
    source_worktrees: options.source_worktrees || [],
    execution: { worktree: root },
    checkpoint: options.checkpoint || { blockers: [] },
    nodes: options.nodes || [
      { id: 'N1', status: 'delivered', summary: '已交付' },
      { id: 'N2', status: 'pending', summary: '修复实际看板状态' },
    ],
  };
  writeJson(path.join(root, '10_plans/active/test/plan_v1.json'), plan);
  fs.mkdirSync(path.join(root, '10_plans/active/test'), { recursive: true });
  fs.writeFileSync(path.join(root, '10_plans/active/test/plan_v1.md'), '# 看板任务\n');
}

function addCodexIndex(root, entries, t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-codex-index-'));
  t.after(() => {
    assert.equal(path.dirname(home), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith('muion-codex-index-'));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const state = new (createRequire(import.meta.url)('node:sqlite').DatabaseSync)(path.join(home, 'state_5.sqlite'));
  const history = new (createRequire(import.meta.url)('node:sqlite').DatabaseSync)(path.join(home, 'thread_history_1.sqlite'));
  state.exec('CREATE TABLE threads (id TEXT, name TEXT, title TEXT, cwd TEXT, archived INTEGER, updated_at INTEGER, updated_at_ms INTEGER, source TEXT, rollout_path TEXT)');
  history.exec('CREATE TABLE thread_turns (thread_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER, rollout_ordinal INTEGER)');
  const thread = state.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?,?,?,?)');
  const turn = history.prepare('INSERT INTO thread_turns VALUES (?,?,?,?,?)');
  for (const item of entries) {
    const rollout = path.join(home, item.id + '.jsonl');
    if (!item.rollout_missing) fs.writeFileSync(rollout, '');
    thread.run(item.id, item.name || null, item.title || null, root, 0, 0, Date.now(), 'vscode', rollout);
    turn.run(item.id, item.status, Math.floor(Date.now() / 1000) - 3600, item.completed ? Math.floor(Date.now() / 1000) - 1800 : null, item.ordinal || 1);
  }
  state.close();
  history.close();
  return home;
}

test('ignored runtime outputs stay discoverable only for a current session', t => {
  const root = makeRoot(t);
  fs.writeFileSync(path.join(root, '.gitignore'), '*.mph\n_work/\n');
  assert.equal(spawnSync('git', ['-C', root, 'add', '.gitignore'], { encoding: 'utf8' }).status, 0);
  fs.writeFileSync(path.join(root, 'model.mph'), 'important generated output');
  const session = { session_id: 's', task_id: 't', branch: 'codex/session/s', mode: 'worktree', worktree_path: root, status: 'active', lease_until: '2000-01-01T00:00:00Z' };
  addSession(root, session);
  const inventory = new ArtifactCatalog(root).inspect(session);
  const output = inventory.artifacts.find(item => item.path === 'model.mph');
  assert.equal(output.ignored_by_git, true);
  assert.match(output.sha256, /^[a-f0-9]{64}$/);
  const progress = aggregateProgress(root, { includeCodex: false });
  assert.equal(progress.counts.blocked, 0);
  assert.equal(progress.counts.unregistered_artifacts, 1);
  assert.equal(progress.artifact_counts.durable_unregistered, 1);
  assert.equal(progress.sessions[0].board_group, 'needs-attention');
  assert.doesNotMatch(JSON.stringify(progress), /owner_token/);
});

test('a live host is running evidence even when its lease and last update are old', t => {
  const root = makeRoot(t);
  addSession(root, {
    session_id: 'session-a', host_session_id: 'thread-a', task_id: 'task-a',
    status: 'active', mode: 'worktree', branch: 'codex/session/a',
    worktree_path: root, lease_until: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z',
  });
  addPlan(root, { task_id: 'task-a', session_ids: ['session-a'], checkpoint: { blockers: [] } });
  writeJson(path.join(root, '_work/current/project-supervisor/workers.json'), {
    workers: [{ session_id: 'session-a', host_status: 'running' }],
  });
  writeJson(path.join(root, '00_project/traceability/agent-runs/child.json'), {
    session_id: 'agent-a', parent_id: 'thread-a', status: 'running',
  });
  const progress = aggregateProgress(root, { includeCodex: false });
  const session = progress.sessions[0];
  assert.equal(session.board_group, 'running');
  assert.equal(session.stale, false);
  assert.equal(session.display_name, '看板任务');
  assert.equal(session.plan_progress.percent, 50);
  assert.match(session.current_step, /P1 · N2/);
  assert.equal(session.next_action, '继续下一步');
  assert.equal(session.running_subagents, 1);
});

test('a completed Codex turn remains pending while its project plan is incomplete', t => {
  const root = makeRoot(t);
  addSession(root, {
    session_id: 'session-a', host_session_id: 'thread-a', task_id: 'task-a',
    status: 'active', mode: 'worktree', branch: 'codex/session/a', worktree_path: root,
    updated_at: new Date().toISOString(),
  });
  addPlan(root, { task_id: 'task-a', session_ids: ['session-a'] });
  const home = addCodexIndex(root, [{ id: 'thread-a', name: '执行节点', status: 'completed', completed: true }], t);
  const progress = aggregateProgress(root, { codexHome: home });
  assert.equal(progress.sessions.length, 1);
  assert.equal(progress.sessions[0].board_group, 'needs-attention');
  assert.equal(progress.sessions[0].board_label, '待继续');
  assert.equal(progress.sessions[0].plan_progress.percent, 50);
});

test('completed plan hides a closed same-host row even while its old thread is live', t => {
  const root = makeRoot(t);
  addSession(root, {
    session_id: 'old-session', host_session_id: 'thread-a', task_id: 'task-test',
    status: 'closed', mode: 'worktree', worktree_path: root,
    created_at: '2026-09-29T19:51:26.312Z', updated_at: '2026-10-03T16:35:00.000Z',
  });
  addPlan(root, {
    status: 'completed', task_id: 'task-test', session_ids: ['old-session'],
    nodes: [{ id: 'N0', status: 'delivered' }],
  });
  writeJson(path.join(root, '_work/current/project-supervisor/workers.json'), {
    workers: [{ session_id: 'old-session', host_status: 'running' }],
  });
  const progress = aggregateProgress(root, { includeCodex: false });
  assert.equal(progress.sessions.length, 0);
});

test('a waiting card shows only explicit checkpoint input requirements', t => {
  const root = makeRoot(t);
  addSession(root, {
    session_id: 'session-a', host_session_id: 'thread-a', task_id: 'task-a',
    status: 'active', mode: 'worktree', worktree_path: root,
  });
  addPlan(root, {
    task_id: 'task-a', session_ids: ['session-a'],
    checkpoint: { blockers: [], user_input_required: '需要确认束流能量范围' },
  });
  writeJson(path.join(root, '_work/current/project-supervisor/workers.json'), {
    workers: [{ session_id: 'session-a', host_status: 'running' }],
  });
  const progress = aggregateProgress(root, { includeCodex: false });
  assert.equal(progress.sessions[0].board_group, 'needs-attention');
  assert.equal(progress.sessions[0].board_label, '等待输入');
  assert.equal(progress.sessions[0].waiting_for, '需要确认束流能量范围');
});

test('unnamed interrupted Codex work stays visible with a safe fallback name', t => {
  const root = makeRoot(t);
  const home = addCodexIndex(root, [
    { id: 'active-thread', name: '正在运行', status: 'inProgress' },
    { id: 'unnamed-thread', name: null, title: '', status: 'interrupted', rollout_missing: true },
    { id: 'anonymous-interrupted', name: null, title: '', status: 'interrupted' },
    { id: 'folder-plan-thread', name: '请阅读：codex://threads/01a07689-27fb-77d3-92ef-a89cc6ad826e我们关…', title: '请阅读：codex://threads/01a07689-27fb-77d3-92ef-a89cc6ad826e我们关于文件夹框架的设计以及后续的文件等级策略，继续制作计划', status: 'interrupted' },
    { id: 'old-running-thread', name: '长时间计算', status: 'inProgress' },
    { id: 'done-thread', name: '已完成', status: 'completed', completed: true },
  ], t);
  const warnings = [];
  const result = readCodexSessions(root, warnings, { codexHome: home });
  assert.deepEqual(result.sessions.map(session => session.host_session_id), ['active-thread', 'unnamed-thread', 'anonymous-interrupted', 'folder-plan-thread', 'old-running-thread']);
  assert.equal(result.sessions[1].host_name, null);
  assert.equal(result.sessions[1].turn_state, 'unknown');
  assert.equal(result.sessions[2].turn_state, 'interrupted');
  assert.ok(warnings.some(message => message.includes('rollout unavailable')));
  assert.ok(result.terminal_ids.has('done-thread'));
  const names = withDisplayNames(result.sessions);
  assert.equal(names[1].display_name, '未命名任务 · 1');
  assert.equal(names[2].display_name, '未命名任务 · 2');
  assert.match(names[3].display_name, /文件夹框架/);
  assert.doesNotMatch(names.map(session => session.display_name).join('\n'), /unnamed-thread|anonymous-interrupted|folder-plan-thread/);
});

test('older Codex indexes without rollout_path retain live turns with a diagnostic', t => {
  const root = makeRoot(t);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-codex-legacy-'));
  t.after(() => {
    assert.equal(path.dirname(home), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith('muion-codex-legacy-'));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const state = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  const history = new DatabaseSync(path.join(home, 'thread_history_1.sqlite'));
  state.exec('CREATE TABLE threads (id TEXT, name TEXT, title TEXT, cwd TEXT, archived INTEGER, updated_at INTEGER, updated_at_ms INTEGER, source TEXT)');
  history.exec('CREATE TABLE thread_turns (thread_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER, rollout_ordinal INTEGER)');
  state.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?,?,?)').run('live-thread', '兼容任务', null, root, 0, 0, Date.now(), 'vscode');
  history.prepare('INSERT INTO thread_turns VALUES (?,?,?,?,?)').run('live-thread', 'inProgress', Math.floor(Date.now() / 1000), null, 1);
  state.close();
  history.close();
  const warnings = [];
  const progress = readCodexSessions(root, warnings, { codexHome: home });
  assert.equal(progress.sessions[0].host_session_id, 'live-thread');
  assert.equal(progress.sessions[0].turn_state, 'running');
  assert.ok(warnings.some(message => message.includes('rollout_path column')));
});

test('duplicate registry rows from one host thread become one current card', t => {
  const root = makeRoot(t);
  addSession(root, {
    session_id: 'old-session', host_session_id: 'thread-a', task_id: 'old-task',
    status: 'closed', mode: 'worktree', worktree_path: root, updated_at: '2024-01-01T00:00:00Z',
  });
  addSession(root, {
    session_id: 'new-session', host_session_id: 'thread-a', task_id: 'task-test',
    status: 'active', mode: 'worktree', worktree_path: root, updated_at: '2026-09-30T00:00:00Z',
  });
  addPlan(root, { session_ids: ['new-session'] });
  writeJson(path.join(root, '_work/current/project-supervisor/workers.json'), {
    workers: [{ session_id: 'new-session', host_status: 'running' }],
  });
  const progress = aggregateProgress(root, { includeCodex: false });
  assert.equal(progress.sessions.length, 1);
  assert.equal(progress.sessions[0].session_id, 'new-session');
  assert.equal(progress.sessions[0].board_group, 'running');
});

test('latest same-host session wins when the live thread timestamp masks registry updates', t => {
  const root = makeRoot(t);
  addSession(root, {
    session_id: 'thread-session-1', host_session_id: 'thread-a', task_id: 'old-task',
    status: 'closed', mode: 'worktree', worktree_path: root,
    created_at: '2026-09-29T19:51:26.312Z', updated_at: '2026-10-03T16:35:00.000Z',
  });
  addSession(root, {
    session_id: 'thread-session-5', host_session_id: 'thread-a', task_id: 'current-task',
    status: 'integrated', integration_status: 'integrated', mode: 'worktree', worktree_path: root,
    created_at: '2026-10-03T16:35:31.921Z', updated_at: '2026-10-03T16:35:00.000Z',
  });
  addPlan(root, {
    status: 'completed', task_id: 'old-task', session_ids: ['thread-session-1'],
    nodes: [{ id: 'N0', status: 'delivered' }],
  });
  const home = addCodexIndex(root, [{ id: 'thread-a', status: 'inProgress' }], t);
  const progress = aggregateProgress(root, { codexHome: home });
  assert.equal(progress.sessions.length, 1);
  assert.equal(progress.sessions[0].session_id, 'thread-session-5');
  assert.equal(progress.sessions[0].board_group, 'running');
  assert.equal(progress.sessions[0].board_label, '运行中');
});

test('plan source branches stop appearing only after their resolving node is delivered', t => {
  const root = makeRoot(t);
  const planning = path.join(root, 'planning-source');
  const historical = path.join(root, 'historical-worker');
  const earlierDashboard = path.join(root, 'earlier-dashboard');
  addSession(root, {
    session_id: 'planning-session', host_session_id: 'shared-thread', task_id: 'planning-task',
    status: 'active', mode: 'worktree', worktree_path: planning, updated_at: '2026-09-30T01:00:00Z',
  });
  addSession(root, {
    session_id: 'historical-session', host_session_id: 'shared-thread', task_id: 'historical-task',
    status: 'closed', mode: 'worktree', worktree_path: historical, updated_at: '2026-09-25T01:00:00Z',
  });
  addSession(root, {
    session_id: 'earlier-dashboard-session', host_session_id: 'earlier-dashboard-thread', task_id: 'earlier-dashboard-task',
    status: 'closed', mode: 'worktree', worktree_path: earlierDashboard,
  });
  for (const [id, status] of [['historical-session', 'pending-integration'], ['earlier-dashboard-session', 'pending-integration']]) {
    writeJson(path.join(root, '_work/current/concurrency/sessions', id + '.integration.json'), { session_id: id, status });
  }
  const options = {
    task_id: 'current-task',
    session_ids: ['current-session'],
    source_worktrees: [
      { path: planning, label: '规划来源', resolution_node: 'N0' },
      { path: historical, label: '历史实现待核验', resolution_node: 'N3' },
      { path: earlierDashboard, label: '旧看板实现核验', resolution_node: 'N2' },
    ],
    nodes: [{ id: 'N0', status: 'delivered' }, { id: 'N2', status: 'pending' }, { id: 'N3', status: 'pending' }],
  };
  addPlan(root, options);
  const before = aggregateProgress(root, { includeCodex: false });
  assert.equal(before.sessions.length, 2);
  assert.equal(before.sessions.find(item => item.session_id === 'historical-session').board_label, '待集成');
  assert.match(before.sessions.find(item => item.session_id === 'historical-session').display_name, /历史实现待核验/);
  assert.match(before.sessions.find(item => item.session_id === 'earlier-dashboard-session').display_name, /旧看板实现核验/);
  addPlan(root, { ...options, nodes: [{ id: 'N0', status: 'delivered' }, { id: 'N2', status: 'delivered' }, { id: 'N3', status: 'pending' }] });
  const afterN2 = aggregateProgress(root, { includeCodex: false });
  assert.deepEqual(afterN2.sessions.map(item => item.session_id), ['historical-session']);
  addPlan(root, { ...options, nodes: [{ id: 'N0', status: 'delivered' }, { id: 'N2', status: 'delivered' }, { id: 'N3', status: 'delivered' }] });
  const afterN3 = aggregateProgress(root, { includeCodex: false });
  assert.equal(afterN3.sessions.length, 0);
});

test('abandoned history is hidden once its branch and worktree are gone', t => {
  const root = makeRoot(t);
  addSession(root, {
    session_id: 'old-session', host_session_id: 'old-thread', task_id: 'old-task',
    status: 'abandoned', mode: 'worktree', worktree_path: path.join(root, 'removed-worktree'),
    branch: 'codex/session/removed', updated_at: '2024-01-01T00:00:00Z',
  });
  const progress = aggregateProgress(root, { includeCodex: false });
  assert.equal(progress.sessions.length, 0);
});

test('artifact counts use the newest active scan, exclude runtime and deduplicate paths', t => {
  const root = makeRoot(t);
  addSession(root, {
    session_id: 'session-a', host_session_id: 'thread-a', task_id: 'task-a',
    status: 'active', mode: 'worktree', worktree_path: root, branch: 'codex/session/a',
  });
  addSession(root, {
    session_id: 'closed-session', host_session_id: 'closed-thread', task_id: 'old-task',
    status: 'closed', mode: 'worktree', worktree_path: root, branch: 'codex/session/closed',
  });
  addPlan(root, { task_id: 'task-a', session_ids: ['session-a'] });
  const currentFile = path.join(root, 'docs/current.txt');
  const quarantineFile = path.join(root, '90_migration/quarantine/current.txt');
  const privateFile = path.join(root, '00_project/web-research/private/profile.json');
  const staleFile = path.join(root, 'docs/stale.txt');
  const closedFile = path.join(root, 'docs/closed.txt');
  for (const file of [currentFile, quarantineFile, privateFile, staleFile, closedFile]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'observed');
  }
  const inventory = (sessionId, inspectedAt, artifacts) => ({ session_id: sessionId, inspected_at: inspectedAt, artifacts });
  const triage = path.join(root, '_work/current/artifact-triage');
  writeJson(path.join(triage, 'older.json'), inventory('session-a', '2026-09-01T00:00:00Z', [
    { path: 'docs/stale.txt', status: 'unregistered' },
  ]));
  writeJson(path.join(triage, 'latest.json'), inventory('session-a', '2026-09-30T00:00:00Z', [
    { path: 'docs/current.txt', status: 'unregistered' },
    { path: 'docs/current.txt', status: 'unregistered' },
    { path: '90_migration/quarantine/current.txt', status: 'unregistered' },
    { path: '00_project/web-research/private/profile.json', status: 'unregistered' },
  ]));
  writeJson(path.join(triage, 'closed.json'), inventory('closed-session', '2026-09-30T00:00:00Z', [
    { path: 'docs/closed.txt', status: 'unregistered' },
  ]));
  fs.writeFileSync(path.join(triage, 'session-a.promotion-plan.json'), 'not an artifact inventory');
  const progress = aggregateProgress(root, { includeCodex: false });
  assert.equal(progress.artifact_counts.durable_unregistered, 1);
  assert.equal(progress.artifact_counts.blocked, 1);
  assert.equal(progress.artifact_counts.registered_quarantine, 0);
  assert.equal(progress.counts.unregistered_artifacts, 1);
  assert.equal('artifact_triage' in progress, false);
  assert.equal(progress.warnings.some(item => item.includes('promotion-plan')), false);
  writeJson(path.join(triage, 'latest.json'), inventory('session-a', '2026-09-30T00:00:00Z', [
    { path: '90_migration/quarantine/current.txt', status: 'unregistered' },
  ]));
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(path.join(triage, 'latest.json'), future, future);
  const onlyQuarantine = aggregateProgress(root, { includeCodex: false }).artifact_counts;
  assert.equal(onlyQuarantine.durable_unregistered, 0);
  assert.equal(onlyQuarantine.blocked, 1);
});

test('only hash-matched quarantine copies are counted separately from unresolved project files', t => {
  const root = makeRoot(t);
  addSession(root, { session_id: 'session-a', task_id: 'task-a', status: 'active', mode: 'worktree', worktree_path: root, branch: 'codex/session/a' });
  addPlan(root, { task_id: 'task-a', session_ids: ['session-a'] });
  const bytes = 'archive copy\n'; const sha256 = createRequire(import.meta.url)('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const relative = '90_migration/quarantine/fixture/copy.txt'; const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
  writeJson(path.join(root, '90_migration/quarantine/fixture/quarantine-manifest.json'), { record_type: 'durable-quarantine-manifest', items: [{ quarantine_path: relative, bytes: Buffer.byteLength(bytes), sha256 }] });
  const triage = path.join(root, '_work/current/artifact-triage');
  writeJson(path.join(triage, 'session-a.json'), { session_id: 'session-a', inspected_at: new Date().toISOString(), artifacts: [{ path: relative, status: 'registered-quarantine', quarantine_registered: true, bytes: Buffer.byteLength(bytes), sha256 }] });
  const counts = aggregateProgress(root, { includeCodex: false }).artifact_counts;
  assert.equal(counts.durable_unregistered, 0);
  assert.equal(counts.blocked, 0);
  assert.equal(counts.registered_quarantine, 1);
});

test('an active registry without run evidence is unknown, not running', t => {
  const root = makeRoot(t);
  addSession(root, {
    session_id: 'session-a', host_session_id: 'thread-a', task_id: 'task-a',
    status: 'active', mode: 'worktree', worktree_path: root, lease_until: '2020-01-01T00:00:00Z',
  });
  const progress = aggregateProgress(root, { includeCodex: false });
  assert.equal(progress.sessions[0].board_group, 'needs-attention');
  assert.equal(progress.sessions[0].board_label, '状态未知');
  assert.equal(progress.sessions[0].stale, true);
  assert.equal(progress.counts.running, 0);
});
