import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { classifyLocalArtifactPath, matchesQuarantineManifest, readQuarantineManifestEntries } from './local-runtime-paths.mjs';

const read = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const records = directory => fs.existsSync(directory)
  ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => path.join(directory, name))
  : [];
const terminalSessions = new Set(['closed', 'complete', 'completed', 'done', 'succeeded', 'success', 'expired', 'archived', 'abandoned']);
const terminalPlans = new Set(['closed', 'complete', 'completed', 'done', 'succeeded', 'success']);
const completedNodes = new Set(['delivered', 'complete', 'completed', 'done', 'succeeded', 'success']);
const interruptedStatuses = new Set(['failed', 'interrupted', 'aborted', 'cancelled', 'canceled', 'stopped']);
const projectRoots = new Map();
const artifactCache = new Map();

function normalizeWindowsPath(value) {
  return path.win32.normalize(String(value || '').replace(/^\\\\\?\\/, '')).replace(/[\\/]+$/, '').toLowerCase();
}

function canonicalProjectRoot(root) {
  const key = path.resolve(root);
  if (projectRoots.has(key)) return projectRoots.get(key);
  const result = spawnSync('git', ['-C', key, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', windowsHide: true });
  const value = result.status === 0 ? path.dirname(path.resolve(key, result.stdout.trim())) : key;
  projectRoots.set(key, value);
  return value;
}

function timestamp(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number)) return new Date(number < 1e12 ? number * 1000 : number).toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function readableName(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim().replace(/^请阅读[：:]?\s*/, '').replace(/codex:\/\/threads\/[a-f0-9-]+/ig, '').replace(/\s+/g, ' ').trim();
  if (/^(?:codex-)?[a-f0-9-]{20,}$/i.test(text)) return null;
  if (/^session-\d+-\d+-[a-f0-9]{6,}$/i.test(text.split('/').at(-1))) return null;
  if (/[a-f0-9]{20,}/i.test(text)) return null;
  if (/^\$|^https?:\/\//i.test(text) || /^\[[^\]]+\]\([^)]+\)/.test(text)) return null;
  const name = text.replace(/^task[_-]/i, '').replace(/[_-]\d{3,}$/, '').replace(/[_-]+/g, ' ').trim();
  if (name.endsWith('…') && name.length < 8) return null;
  return name ? (name.length > 80 ? name.slice(0, 77).trim() + '…' : name) : null;
}

function codexStatus(value) {
  const status = String(value || '').toLowerCase();
  if (['inprogress', 'in_progress', 'running', 'started'].includes(status)) return 'running';
  if (interruptedStatuses.has(status)) return 'interrupted';
  if (['completed', 'succeeded', 'success', 'done', 'closed'].includes(status)) return 'completed';
  return 'unknown';
}

// Codex indexes are queried read-only. A finished turn is kept as evidence;
// the linked project plan decides whether the task is finished.
export function readCodexSessions(root, warnings = [], { codexHome = path.join(os.homedir(), '.codex') } = {}) {
  const stateFile = path.join(codexHome, 'state_5.sqlite');
  const historyFile = path.join(codexHome, 'thread_history_1.sqlite');
  if (!fs.existsSync(stateFile) || !fs.existsSync(historyFile)) {
    warnings.push('Codex session index unavailable: state or turn history database is missing');
    return { sessions: [], threads: new Map(), terminal_ids: new Set() };
  }
  let stateDb; let historyDb;
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    stateDb = new DatabaseSync(stateFile, { readOnly: true });
    historyDb = new DatabaseSync(historyFile, { readOnly: true });
    const projectRoot = normalizeWindowsPath(canonicalProjectRoot(root));
    let threads;
    try {
      threads = stateDb.prepare('SELECT id, name, title, cwd, archived, updated_at, updated_at_ms, source, rollout_path FROM threads WHERE archived = 0').all();
    } catch (error) {
      if (!/no such column: rollout_path/i.test(error.message)) throw error;
      warnings.push('Codex thread index has no rollout_path column; incomplete turns may be unknown');
      threads = stateDb.prepare('SELECT id, name, title, cwd, archived, updated_at, updated_at_ms, source FROM threads WHERE archived = 0').all();
    }
    let latestTurn = null;
    try {
      latestTurn = historyDb.prepare('SELECT status, started_at, completed_at, rollout_ordinal FROM thread_turns WHERE thread_id = ? ORDER BY rollout_ordinal DESC LIMIT 1');
    } catch (error) { warnings.push('Codex turn history unavailable: ' + error.message); }
    const currentId = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID || null;
    const sessions = []; const known = new Map(); const terminalIds = new Set();
    for (const thread of threads) {
      if (!thread.cwd || normalizeWindowsPath(canonicalProjectRoot(thread.cwd)) !== projectRoot || String(thread.source || '').includes('subagent')) continue;
      const turn = latestTurn?.get(thread.id) || null;
      let state = codexStatus(turn?.status);
      if (!turn && thread.id === currentId) warnings.push('Codex turn status unavailable for current thread ' + thread.id);
      const rolloutMissing = !thread.rollout_path || !fs.existsSync(thread.rollout_path);
      if (rolloutMissing && (state === 'interrupted' || state === 'unknown')) {
        warnings.push('Codex rollout unavailable for thread ' + thread.id);
        state = 'unknown';
      }
      const name = readableName(thread.name) || readableName(thread.title);
      const info = {
        host_session_id: thread.id,
        host_name: name,
        turn_status: turn?.status == null ? null : String(turn.status),
        turn_state: state,
        turn_ordinal: turn?.rollout_ordinal ?? null,
        turn_started_at: timestamp(turn?.started_at),
        turn_completed_at: timestamp(turn?.completed_at),
        rollout_missing: rolloutMissing,
        updated_at: timestamp(thread.updated_at_ms ?? thread.updated_at ?? turn?.started_at),
      };
      known.set(thread.id, info);
      if (state === 'completed') terminalIds.add(thread.id);
      if ((turn && state !== 'completed') || thread.id === currentId) {
        sessions.push({
          ...info, session_id: thread.id, task_id: thread.id, task_name: null, name,
          branch: null, worktree_path: thread.cwd, status: state === 'completed' ? 'completed' : state,
          mode: 'codex', source: 'codex-thread',
        });
      }
    }
    return { sessions, threads: known, terminal_ids: terminalIds };
  } catch (error) {
    warnings.push('Codex session index unavailable: ' + error.message);
    return { sessions: [], threads: new Map(), terminal_ids: new Set() };
  } finally {
    try { stateDb?.close(); } catch {}
    try { historyDb?.close(); } catch {}
  }
}

function chooseDisplayName(item) {
  const taskId = item.task_id && item.task_id !== item.session_id && item.task_id !== item.host_session_id ? item.task_id : null;
  for (const [source, value] of [
    ['codex-thread-name', item.host_name],
    ['plan-title', item.plan_title],
    ['task-card', item.task_name],
    ['registered-name', item.display_name || item.name],
    ['task-id', taskId],
  ]) {
    const name = readableName(value);
    if (name) return { name, source };
  }
  return { name: '未命名任务', source: 'generated' };
}

export function withDisplayNames(items = []) {
  const rows = items.map(item => {
    const display = chooseDisplayName(item);
    return { ...item, display_name: display.name, display_name_source: display.source };
  });
  const counts = new Map();
  for (const row of rows) counts.set(row.display_name, (counts.get(row.display_name) || 0) + 1);
  const seen = new Map();
  return rows.map(row => {
    if (counts.get(row.display_name) < 2) return row;
    const ordinal = (seen.get(row.display_name) || 0) + 1;
    seen.set(row.display_name, ordinal);
    return { ...row, display_name: row.display_name + ' · ' + ordinal, display_name_conflict: true };
  });
}

function readTaskName(root, taskId, warnings) {
  if (!/^[a-z0-9_-]+$/i.test(String(taskId || ''))) return null;
  const file = path.join(root, '00_project/task-cards', taskId + '.task_manifest.json');
  try {
    const card = read(file, null);
    return readableName(card?.task_name || card?.title || card?.objective);
  } catch (error) { warnings.push(taskId + ': ' + error.message); return null; }
}

function planTitle(root, plan) {
  const explicit = readableName(plan.title || plan.plan_title || plan.task_name || plan.objective);
  if (explicit) return explicit;
  if (!plan.human_plan) return null;
  const file = path.resolve(root, plan.human_plan);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) return null;
  try {
    const heading = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(line => /^#\s+/.test(line));
    return readableName(heading?.replace(/^#\s+/, '').replace(/^plan_v\d+\s*[:：]\s*/i, ''));
  } catch { return null; }
}

function isDone(value) { return completedNodes.has(String(value || '').toLowerCase()); }

function readPlans(root, warnings) {
  const active = path.join(root, '10_plans/active');
  if (!fs.existsSync(active)) return [];
  const plans = [];
  for (const directory of fs.readdirSync(active, { withFileTypes: true }).filter(item => item.isDirectory())) {
    const folder = path.join(active, directory.name);
    const versioned = fs.readdirSync(folder).filter(name => /^plan_v\d+\.json$/i.test(name))
      .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
    const file = path.join(folder, versioned[0] || 'plan_index.json');
    try {
      const plan = read(file, null);
      if (!plan) continue;
      const nodes = Array.isArray(plan.nodes) ? plan.nodes : (Array.isArray(plan.phases) ? plan.phases : []);
      const completedCount = nodes.filter(node => isDone(node.status)).length;
      const current = nodes.find(node => !isDone(node.status)) || null;
      const total = nodes.length;
      const status = String(plan.status || 'unknown').toLowerCase();
      const complete = terminalPlans.has(status) && (!total || completedCount === total);
      const phase = plan.current_phase || plan.phase || null;
      const step = current
        ? [phase, current.id || current.name || null, current.summary || current.title || null].filter(Boolean).join(' · ')
        : plan.current_step || phase;
      const wait = plan.user_input_required || plan.waiting_for || current?.user_input_required || current?.waiting_for ||
        plan.checkpoint?.waiting_for || plan.checkpoint?.user_input_required ||
        (plan.checkpoint?.blockers?.length ? plan.checkpoint.blockers.join('; ') : null);
      const execution = plan.execution || {};
      const nodeStatus = new Map(nodes.map(node => [String(node.id || node.name || ''), String(node.status || '').toLowerCase()]));
      const sourceWorktrees = (Array.isArray(plan.source_worktrees) ? plan.source_worktrees : [])
        .filter(source => source?.path)
        .map(source => ({ ...source, resolved: isDone(nodeStatus.get(source.resolution_node)) }));
      const sessionIds = new Set([
        ...(Array.isArray(plan.session_ids) ? plan.session_ids : []),
        ...(Array.isArray(execution.session_ids) ? execution.session_ids : []),
        execution.session_id,
      ].filter(Boolean).map(String));
      plans.push({
        plan_id: plan.plan_id || plan.task_id || directory.name,
        task_id: plan.task_id || null,
        title: planTitle(root, plan),
        status,
        complete,
        current_phase: phase,
        current_step: step || null,
        next_action: plan.next_action || plan.checkpoint?.next_action || current?.next_action || null,
        waiting_for: wait == null ? null : String(wait),
        completed_count: completedCount,
        total_count: total,
        progress_percent: total ? Math.round(completedCount * 100 / total) : null,
        session_ids: [...sessionIds],
        source_worktrees: sourceWorktrees,
      });
    } catch (error) { warnings.push(path.relative(root, file) + ': ' + error.message); }
  }
  return plans;
}

function planForSession(session, plans) {
  const ids = new Set([session.session_id, session.host_session_id, session.task_id].filter(Boolean).map(String));
  const scored = plans.map(plan => {
    let score = 0;
    const source = plan.source_worktrees.find(item => normalizeWindowsPath(item.path) === normalizeWindowsPath(session.worktree_path));
    if (plan.session_ids.some(id => ids.has(id))) score = 3;
    else if (plan.task_id && plan.task_id === session.task_id) score = 2;
    else if (source) score = 1;
    return { plan, source, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

function registrySessions(root, warnings) {
  const directory = path.join(root, '_work/current/concurrency/sessions');
  let workers = [];
  try { workers = read(path.join(root, '_work/current/project-supervisor/workers.json'), { workers: [] }).workers || []; }
  catch (error) { warnings.push(error.message); }
  const workerBySession = new Map(workers.map(item => [item.session_id, item]));
  const sessions = [];
  for (const file of records(directory).filter(item => !/\.(baseline|integration)\.json$/.test(item))) {
    try {
      const record = read(file, null);
      if (!record?.session_id) continue;
      const worker = workerBySession.get(record.session_id);
      const integration = read(path.join(directory, record.session_id + '.integration.json'));
      const blockers = [];
      for (const blocker of record.blockers || record.checkpoint?.blockers || []) {
        const reason = typeof blocker === 'string' ? blocker : blocker.reason || blocker.next_action;
        if (reason) blockers.push(String(reason));
      }
      if (worker?.outside_claim_paths?.length) blockers.push('变更超出文件认领范围');
      if (String(integration?.status || '').startsWith('blocked')) blockers.push('集成被阻塞');
      sessions.push({
        session_id: record.session_id,
        host_session_id: record.host_session_id || null,
        name: record.name || null,
        display_name: record.display_name || null,
        task_id: record.task_id || null,
        task_name: readableName(record.task_name) || readTaskName(root, record.task_id, warnings),
        branch: record.branch || null,
        worktree_path: record.worktree_path || null,
        status: String(record.status || 'unknown').toLowerCase(),
        created_at: timestamp(record.created_at),
        mode: record.mode || null,
        host_status: worker?.host_status || null,
        lease_until: record.lease_until || null,
        updated_at: timestamp(record.updated_at || record.created_at),
        current_step: record.current_step || record.checkpoint?.current_step || record.checkpoint?.phase || null,
        next_action: record.next_action || record.checkpoint?.next_action || null,
        waiting_for: record.waiting_for || record.checkpoint?.waiting_for || record.checkpoint?.user_input_required || null,
        integration: integration?.status || record.integration_status || null,
        blockers,
        source: 'session-registry',
      });
    } catch (error) { warnings.push(path.basename(file) + ': ' + error.message); }
  }
  return sessions;
}

function newerSession(candidate, current) {
  const running = value => value.turn_state === 'running' || String(value.host_status || '').toLowerCase() === 'running';
  if (running(candidate) !== running(current)) return running(candidate) ? candidate : current;
  const pendingDelivery = value => ['submitted', 'pending-integration', 'pending-validation', 'pending-tag-receipt', 'pending-plan-receipt-push'].includes(String(value.integration || '').toLowerCase());
  if (pendingDelivery(candidate) !== pendingDelivery(current)) return pendingDelivery(candidate) ? candidate : current;
  const candidateTime = Date.parse(candidate.updated_at || '') || 0;
  const currentTime = Date.parse(current.updated_at || '') || 0;
  if (candidateTime !== currentTime) return candidateTime > currentTime ? candidate : current;
  const candidateCreated = Date.parse(candidate.created_at || '') || 0;
  const currentCreated = Date.parse(current.created_at || '') || 0;
  if (candidateCreated !== currentCreated) return candidateCreated > currentCreated ? candidate : current;
  const priority = value => ({ active: 4, submitted: 3, blocked: 3, integrated: 2, interrupted: 2, abandoned: 1, closed: 0 })[value.status] || 0;
  return priority(candidate) > priority(current) ? candidate : current;
}

function mergeSessions(registry, codex) {
  const byHost = new Map();
  for (const source of registry) {
    const thread = source.host_session_id ? codex.threads.get(source.host_session_id) : null;
    const turnState = thread?.turn_state || null;
    const session = {
      ...source,
      host_name: thread?.host_name || null,
      turn_status: thread?.turn_status || null,
      turn_state: turnState,
      turn_ordinal: thread?.turn_ordinal ?? null,
      host_status: turnState && turnState !== 'unknown' ? turnState : (source.host_status || 'unknown'),
      updated_at: [source.updated_at, thread?.updated_at].filter(Boolean).sort().at(-1) || null,
    };
    const key = session.host_session_id || 'session:' + session.session_id;
    byHost.set(key, byHost.has(key) ? newerSession(session, byHost.get(key)) : session);
  }
  const merged = [];
  const representedHosts = new Set();
  for (const session of byHost.values()) {
    if (session.host_session_id) representedHosts.add(session.host_session_id);
    merged.push(session);
  }
  for (const session of codex.sessions) {
    if (representedHosts.has(session.host_session_id)) continue;
    merged.push({ ...session, host_status: session.turn_state || 'unknown' });
  }
  return merged;
}

function agentRuns(root, warnings) {
  const output = [];
  for (const file of records(path.join(root, '00_project/traceability/agent-runs'))) {
    try { const record = read(file, null); if (record) output.push(record); }
    catch (error) { warnings.push(path.basename(file) + ': ' + error.message); }
  }
  return output;
}

function runningSubagents(session, agents) {
  const ids = new Set([session.session_id, session.host_session_id, session.task_id].filter(Boolean).map(String));
  const active = new Set(['running', 'inprogress', 'in_progress', 'turn_started']);
  return agents.filter(agent => {
    const parents = [
      agent.parent_id, agent.parent_session_id, agent.parent_thread_id, agent.parent_task_id,
      agent.parent?.session_id, agent.parent?.thread_id, agent.parent?.task_id,
    ].filter(Boolean).map(String);
    const status = String(agent.lifecycle_state || agent.status || agent.lifecycle || '').toLowerCase();
    return parents.some(id => ids.has(id)) && active.has(status);
  }).length;
}

function classifySession(session) {
  const status = String(session.status || 'unknown').toLowerCase();
  const turn = String(session.turn_state || 'unknown').toLowerCase();
  const hostStatus = String(session.host_status || '').toLowerCase();
  const planIncomplete = session.plan_complete === false;
  const waiting = Boolean(session.waiting_for);
  const blocked = status === 'blocked' || session.blockers?.length > 0 || String(session.integration || '').startsWith('blocked');
  const submitted = status === 'submitted' || session.integration === 'submitted' || session.integration === 'pending-integration';
  const terminal = terminalSessions.has(status);
  const runningEvidence = turn === 'running' || (String(session.host_status).toLowerCase() === 'running' && !['completed', 'interrupted'].includes(turn));

  if (submitted) return { board_group: 'needs-attention', board_label: '待集成', board_reason: '已提交，尚未完成集成' };
  if (blocked) return { board_group: 'needs-attention', board_label: '已阻塞', board_reason: session.blockers?.[0] || '需要处理阻塞' };
  if (waiting) return { board_group: 'needs-attention', board_label: '等待输入', board_reason: session.waiting_for };
  if (terminal && !planIncomplete) {
    if (runningEvidence) return { board_group: 'needs-attention', board_label: '状态冲突', board_reason: '生命周期已关闭，但宿主仍报告运行' };
    return null;
  }
  if (turn === 'completed') {
    if (planIncomplete || status === 'active') return { board_group: 'needs-attention', board_label: '待继续', board_reason: '本轮已结束，计划尚未完成' };
    return null;
  }
  if (turn === 'interrupted' || interruptedStatuses.has(hostStatus) || interruptedStatuses.has(status)) {
    if (planIncomplete || session.source === 'codex-thread' || !terminal) return { board_group: 'needs-attention', board_label: '已中断', board_reason: '保留未完成工作以便继续' };
    return null;
  }
  if (runningEvidence && !['paused', 'abandoned'].includes(status)) {
    return { board_group: 'running', board_label: '运行中', board_reason: null };
  }
  if (planIncomplete && terminal) return { board_group: 'needs-attention', board_label: '待继续', board_reason: 'session 已结束，计划仍有未交付步骤' };
  if (status === 'active' || status === 'unknown' || session.source === 'codex-thread' || planIncomplete) {
    return { board_group: 'needs-attention', board_label: '状态未知', board_reason: '缺少当前运行证据；请检查 checkpoint 后继续' };
  }
  return null;
}

function isLocalRuntimeArtifact(value) {
  const relative = String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '').toLowerCase();
  const category = classifyLocalArtifactPath(relative);
  return category === 'local-runtime' || category === 'quarantine-manifest';
}

function readArtifactInventory(file, warnings) {
  const stat = fs.statSync(file);
  const cached = artifactCache.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached;
  try {
    const record = read(file, null);
    if (!record || !Array.isArray(record.artifacts)) return null;
    const summary = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      session_id: record.session_id,
      artifacts: record.artifacts
        .filter(item => item.path && !isLocalRuntimeArtifact(item.path) &&
          (item.status === 'unregistered' || ['blocked-unregistered-output', 'retained-blocked', 'drive-required'].includes(item.status) || item.status === 'registered-quarantine' && item.quarantine_registered === true))
        .map(item => ({ path: String(item.path), status: String(item.status).toLowerCase(), quarantine_registered: item.quarantine_registered === true, bytes: item.bytes ?? null, sha256: item.sha256 ?? null })),
    };
    artifactCache.set(file, summary);
    return summary;
  } catch (error) {
    warnings.push(path.basename(file) + ': ' + error.message);
    return null;
  }
}

function artifactHeader(file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytes).toString('utf8');
    const decode = key => {
      const match = text.match(new RegExp('\"' + key + '\"\\s*:\\s*\"([^\"]*)\"'));
      return match ? match[1] : null;
    };
    return { session_id: decode('session_id'), inspected_at: decode('inspected_at') };
  } finally { fs.closeSync(descriptor); }
}

function artifactCounts(root, registry, visible, warnings) {
  const directory = path.join(root, '_work/current/artifact-triage');
  const visibleById = new Map(visible.map(session => [session.session_id, session]));
  const registryById = new Map(registry.map(session => [session.session_id, session]));
  const latest = new Map();
  for (const file of records(directory)) {
    if (path.basename(file).endsWith('.promotion-plan.json')) continue;
    try {
      const header = artifactHeader(file);
      const session = visibleById.get(header.session_id);
      if (!session || !registryById.has(header.session_id)) continue;
      const observed = Date.parse(header.inspected_at || '') || fs.statSync(file).mtimeMs;
      const previous = latest.get(header.session_id);
      if (!previous || observed > previous.observed) latest.set(header.session_id, { file, observed });
    } catch (error) { warnings.push('artifact scan header: ' + error.message); }
  }
  const currentFiles = new Set([...latest.values()].map(item => item.file));
  for (const file of artifactCache.keys()) if (!currentFiles.has(file)) artifactCache.delete(file);

  const trackedByWorktree = new Map(); const quarantineByWorktree = new Map(); const seen = new Set();
  const counts = { durable_unregistered: 0, blocked: 0, registered_quarantine: 0 };
  for (const [sessionId, candidate] of latest) {
    const session = registryById.get(sessionId);
    const worktree = session?.worktree_path;
    if (!worktree || !fs.existsSync(worktree)) continue;
    const record = readArtifactInventory(candidate.file, warnings);
    if (!record || record.session_id !== sessionId) continue;
    if (!trackedByWorktree.has(worktree)) {
      const git = spawnSync('git', ['-C', worktree, 'ls-files', '-z'], { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
      if (git.status !== 0) { warnings.push('artifact source Git index unavailable'); continue; }
      trackedByWorktree.set(worktree, new Set(git.stdout.split('\0').filter(Boolean).map(item => item.replaceAll('\\', '/').toLowerCase())));
      try { quarantineByWorktree.set(worktree, readQuarantineManifestEntries(worktree)); }
      catch (error) { warnings.push('quarantine manifest unavailable: ' + error.message); quarantineByWorktree.set(worktree, new Map()); }
    }
    for (const item of record.artifacts) {
      const status = String(item.status || '').toLowerCase();
      if (!item.path || isLocalRuntimeArtifact(item.path)) continue;
      if (status !== 'unregistered' && !['blocked-unregistered-output', 'retained-blocked', 'drive-required'].includes(status) && !(status === 'registered-quarantine' && item.quarantine_registered)) continue;
      const category = classifyLocalArtifactPath(item.path);
      const absolute = path.resolve(worktree, item.path);
      const relative = path.relative(worktree, absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) { warnings.push('artifact path outside worktree'); continue; }
      const key = normalizeWindowsPath(absolute);
      if (seen.has(key) || trackedByWorktree.get(worktree).has(relative.replaceAll('\\', '/').toLowerCase())) continue;
      let stat;
      try { stat = fs.lstatSync(absolute); } catch { continue; }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        seen.add(key);
        counts.blocked++;
        continue;
      }
      try {
        if (!fs.realpathSync(absolute).startsWith(fs.realpathSync(worktree) + path.sep)) continue;
      } catch { continue; }
      seen.add(key);
      if (category === 'quarantine') {
        if (status === 'registered-quarantine' && item.quarantine_registered && matchesQuarantineManifest(quarantineByWorktree.get(worktree) || new Map(), item.path, item.bytes, item.sha256)) counts.registered_quarantine++;
        else counts.blocked++;
      }
      else if (status === 'unregistered') counts.durable_unregistered++;
      else counts.blocked++;
    }
  }
  return counts;
}

function currentSession(sessions, now = Date.now()) {
  const hostId = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID || null;
  const match = hostId ? sessions.find(session => session.host_session_id === hostId || session.session_id === hostId) : null;
  if (match) return { session_id: match.session_id, host_session_id: match.host_session_id, status: match.status, board_group: match.board_group, display_name: match.display_name, source: match.source };
  return { status: 'unknown', current: true, source: 'runtime-session', display_name: '当前 session 未登记', host_session_id: hostId, observed_at: new Date(now).toISOString() };
}

export function aggregateProgress(root, options = {}) {
  const warnings = [];
  const registry = registrySessions(root, warnings);
  const codex = options.includeCodex === false ? { sessions: [], threads: new Map(), terminal_ids: new Set() } : readCodexSessions(root, warnings, options);
  const plans = readPlans(root, warnings);
  const merged = mergeSessions(registry, codex);
  const agents = agentRuns(root, warnings);
  const prepared = merged.map(session => {
    const planMatch = planForSession(session, plans);
    const plan = planMatch?.plan || null;
    const planSource = planMatch?.source || null;
    if (planSource?.resolved && session.host_status !== 'running') return null;
    const taskName = session.task_name || readTaskName(root, session.task_id, warnings);
    const wait = plan?.waiting_for || (session.blockers?.length ? session.blockers.join('; ') : null);
    const row = {
      ...session,
      task_name: taskName,
      plan_id: plan?.plan_id || null,
      plan_title: planSource?.label ? (plan?.title ? plan.title + ' · ' + planSource.label : planSource.label) : plan?.title || null,
      plan_status: plan?.status || null,
      plan_complete: plan ? plan.complete : null,
      plan_progress: plan ? {
        completed: plan.completed_count,
        total: plan.total_count,
        percent: plan.progress_percent,
      } : null,
      current_phase: plan?.current_phase || null,
      current_step: plan?.current_step || session.current_step || null,
      next_action: session.status === 'submitted' ? '等待 leader 集成' : plan?.next_action || session.next_action || null,
      waiting_for: wait || session.waiting_for || null,
      running_subagents: runningSubagents(session, agents),
    };
    const classification = classifySession(row);
    return classification ? { ...row, ...classification } : null;
  }).filter(Boolean);
  const uniqueByHost = new Map();
  for (const session of prepared) {
    const key = session.host_session_id || 'session:' + session.session_id;
    const previous = uniqueByHost.get(key);
    uniqueByHost.set(key, previous ? newerSession(session, previous) : session);
  }
  const visible = withDisplayNames([...uniqueByHost.values()]);
  const sessions = visible.map(session => {
    const last = session.updated_at || session.turn_started_at || null;
    const age = Date.parse(last || '');
    const running = session.board_group === 'running';
    const freshnessUnknown = !running && (session.board_label === '状态未知' || session.board_label === '状态冲突');
    return {
      session_id: session.session_id,
      host_session_id: session.host_session_id || null,
      task_id: session.task_id || null,
      display_name: session.display_name,
      display_name_source: session.display_name_source,
      status: session.status,
      board_group: session.board_group,
      board_label: session.board_label,
      board_reason: session.board_reason,
      source: session.source,
      location_label: path.basename(session.branch || session.worktree_path || '') || null,
      plan_id: session.plan_id,
      plan_status: session.plan_status,
      plan_progress: session.plan_progress,
      current_phase: session.current_phase,
      current_step: session.current_step,
      next_action: session.next_action,
      waiting_for: session.waiting_for,
      running_subagents: session.running_subagents,
      stale: freshnessUnknown,
      last_observed_at: last,
      age_ms: Number.isFinite(age) ? Math.max(0, Date.now() - age) : null,
      blockers: session.blockers || [],
    };
  });
  const artifact_counts = artifactCounts(root, registry, visible, warnings);
  const counts = {
    sessions: sessions.length,
    running: sessions.filter(session => session.board_group === 'running').length,
    needs_attention: sessions.filter(session => session.board_group === 'needs-attention').length,
    active: sessions.filter(session => session.board_group === 'running').length,
    blocked: sessions.filter(session => session.board_label === '已阻塞').length,
    stale: sessions.filter(session => session.stale).length,
    unregistered_artifacts: artifact_counts.durable_unregistered,
  };
  const generated_at = new Date().toISOString();
  return {
    generated_at,
    observed_at: generated_at,
    sessions,
    current_session: currentSession(sessions),
    plans: plans.map(plan => ({
      plan_id: plan.plan_id, task_id: plan.task_id, title: plan.title, status: plan.status,
      current_phase: plan.current_phase, current_step: plan.current_step, next_action: plan.next_action,
      waiting_for: plan.waiting_for, completed_count: plan.completed_count, total_count: plan.total_count,
      progress_percent: plan.progress_percent,
    })),
    counts,
    artifact_counts,
    warnings,
  };
}
