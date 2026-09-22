import fs from 'node:fs';
import path from 'node:path';

const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
const records = directory => fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => path.join(directory, name)) : [];

function readableName(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/^(?:codex-)?[a-f0-9]{16,}(?:-\d+)?$/i.test(text)) return null;
  if (/^session-\d+-\d+-[a-f0-9]{6,}$/i.test(text.split('/').at(-1))) return null;
  if (/[a-f0-9]{20,}/i.test(text)) return null;
  const name = text.replace(/^task[_-]/i, '').replace(/[_-]\d{3,}$/, '').replace(/[_-]+/g, ' ').trim();
  return name || null;
}

function deriveDisplayName(session) {
  for (const [source, value] of [['display_name', session.display_name], ['name', session.name], ['task_name', session.task_name], ['task_id', session.task_id], ['branch', session.branch]]) {
    const name = readableName(value);
    if (name) return { name, source };
  }
  return { name: null, source: 'generated' };
}

export function withDisplayNames(items = []) {
  const rows = items.map((item) => {
    const derived = deriveDisplayName(item);
    return { ...item, display_name: derived.name || null, display_name_source: derived.name ? derived.source : 'missing' };
  });
  const counts = new Map(); for (const row of rows) if (row.display_name) counts.set(row.display_name, (counts.get(row.display_name) || 0) + 1);
  const seen = new Map();
  return rows.map((row) => {
    if (!row.display_name || counts.get(row.display_name) < 2) return row;
    const ordinal = (seen.get(row.display_name) || 0) + 1; seen.set(row.display_name, ordinal);
    return { ...row, display_name: `${row.display_name} · ${ordinal}`, display_name_conflict: true };
  });
}

function freshness(session, now = Date.now()) {
  const updatedAt = session.updated_at || null; const updatedMs = Date.parse(updatedAt || ''); const leaseMs = Date.parse(session.lease_until || ''); const reasons = [];
  if (session.status === 'active' && Number.isFinite(leaseMs) && leaseMs < now) reasons.push('lease-expired');
  if (Number.isFinite(updatedMs) && now - updatedMs > 5 * 60 * 1000) reasons.push('last-update-stale');
  return { last_observed_at: updatedAt, age_ms: Number.isFinite(updatedMs) ? Math.max(0, now - updatedMs) : null, stale: reasons.length > 0, stale_reasons: reasons };
}

function currentSession(sessions, now = Date.now()) {
  const hostSessionId = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID || null;
  const match = hostSessionId ? sessions.find(session => session.host_session_id === hostSessionId || session.session_id === hostSessionId) : null;
  const observedAt = new Date(now).toISOString();
  if (match) return { ...match, current: true, source: 'session-registry', dashboard_observed_at: observedAt };
  return { status: 'unregistered', current: true, source: 'runtime-session', display_name: null, task_id: null, host_session_id: hostSessionId, stale: true, stale_reasons: ['current-session-not-registered'], last_observed_at: null, dashboard_observed_at: observedAt, age_ms: null };
}

// A disposable read model. No writes to research state, plans or session registry.
export function aggregateProgress(root) {
  const warnings = []; const sessionRows = [];
  const runtime = path.join(root, '_work/current/project-supervisor');
  let workers = []; try { workers = read(path.join(runtime, 'workers.json'), { workers: [] }).workers; } catch(error) { warnings.push(error.message); }
  const dir = path.join(root, '_work/current/concurrency/sessions');
  for (const file of records(dir).filter(file => !/\.(baseline|integration)\.json$/.test(file))) {
    try {
      const session = read(file); const worker = workers.find(item => item.session_id === session.session_id);
      let taskName = session.task_name || null;
      if (!taskName && /^[a-z0-9_-]+$/i.test(session.task_id || '')) {
        try { taskName = read(path.join(root, '00_project/task-cards', `${session.task_id}.task_manifest.json`))?.task_name || null; }
        catch(error) { warnings.push(`${session.task_id}: ${error.message}`); }
      }
      const integration = read(path.join(dir, `${session.session_id}.integration.json`));
      const blockers = [];
      if (worker?.outside_claim_paths?.length) blockers.push({ reason: 'outside-claim', paths: worker.outside_claim_paths, next_action: 'review ownership and preserve changed files' });
      if (integration?.status?.startsWith('blocked')) blockers.push({ reason: integration.status, paths: integration.conflicts || [], next_action: 'resolve integration in a separate attempt; keep branch and worktree' });
      if (session.status === 'active' && Date.parse(session.lease_until) < Date.now()) blockers.push({ reason: 'lease-expired', next_action: 'inspect host activity and checkpoint; never delete a dirty worktree' });
      sessionRows.push({ session_id: session.session_id, host_session_id: session.host_session_id || null, display_name: session.display_name || session.name || null, task_id: session.task_id, task_name: taskName, branch: session.branch, worktree_path: session.worktree_path, status: session.status, mode: session.mode, host_status: worker?.host_status || 'unobserved', lease_until: session.lease_until, updated_at: session.updated_at || null, integration: integration?.status || null, blockers });
    } catch(error) { warnings.push(error.message); }
  }
  const plans = [];
  const active = path.join(root, '10_plans/active');
  if (fs.existsSync(active)) for (const entry of fs.readdirSync(active, {withFileTypes:true}).filter(entry=>entry.isDirectory())) {
    try { const plan = read(path.join(active,entry.name,'plan_index.json')); if (plan) plans.push({ task_id:plan.task_id, status:plan.status, current_phase:plan.current_phase, next_action:plan.next_action }); } catch(error) { warnings.push(error.message); }
  }
  const artifacts = [];
  for (const file of records(path.join(root, '_work/current/artifact-triage'))) {
    try { const item = read(file); artifacts.push(item); } catch(error) { warnings.push(error.message); }
  }
  const generated_at = new Date().toISOString();
  const terminal = new Set(['closed', 'complete', 'completed', 'done', 'succeeded', 'success']);
  const visibleRows = sessionRows.filter(session => !terminal.has(String(session.status || '').toLowerCase()));
  const sessions = withDisplayNames(visibleRows).map(session => ({ ...session, ...freshness(session) }));
  return { generated_at, observed_at: generated_at, sessions, current_session: currentSession(sessions), plans, artifact_triage:artifacts, counts:{sessions:sessions.length, active:sessions.filter(s=>s.status==='active').length, blocked:sessions.filter(s=>s.blockers.length||s.status==='blocked').length, stale:sessions.filter(s=>s.stale).length, unregistered_artifacts:artifacts.flatMap(record=>record.artifacts||[]).filter(item=>item.status==='unregistered').length}, warnings };
}
