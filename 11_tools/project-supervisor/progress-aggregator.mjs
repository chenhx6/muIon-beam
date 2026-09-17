import fs from 'node:fs';
import path from 'node:path';

const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
const records = directory => fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => path.join(directory, name)) : [];

// A disposable read model. No writes to research state, plans or session registry.
export function aggregateProgress(root) {
  const warnings = []; const sessions = [];
  const runtime = path.join(root, '_work/current/project-supervisor');
  let workers = []; try { workers = read(path.join(runtime, 'workers.json'), { workers: [] }).workers; } catch(error) { warnings.push(error.message); }
  const dir = path.join(root, '_work/current/concurrency/sessions');
  for (const file of records(dir).filter(file => !/\.(baseline|integration)\.json$/.test(file))) {
    try {
      const session = read(file); const worker = workers.find(item => item.session_id === session.session_id);
      const integration = read(path.join(dir, `${session.session_id}.integration.json`));
      const blockers = [];
      if (worker?.outside_claim_paths?.length) blockers.push({ reason: 'outside-claim', paths: worker.outside_claim_paths, next_action: 'review ownership and preserve changed files' });
      if (integration?.status?.startsWith('blocked')) blockers.push({ reason: integration.status, paths: integration.conflicts || [], next_action: 'resolve integration in a separate attempt; keep branch and worktree' });
      if (session.status === 'active' && Date.parse(session.lease_until) < Date.now()) blockers.push({ reason: 'lease-expired', next_action: 'inspect host activity and checkpoint; never delete a dirty worktree' });
      sessions.push({ session_id: session.session_id, host_session_id: session.host_session_id || null, task_id: session.task_id, branch: session.branch, worktree_path: session.worktree_path, status: session.status, mode: session.mode, host_status: worker?.host_status || 'unobserved', lease_until: session.lease_until, integration: integration?.status || null, blockers });
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
  return { generated_at:new Date().toISOString(), sessions, plans, artifact_triage:artifacts, counts:{sessions:sessions.length, active:sessions.filter(s=>s.status==='active').length, blocked:sessions.filter(s=>s.blockers.length||s.status==='blocked').length, unregistered_artifacts:artifacts.flatMap(record=>record.artifacts||[]).filter(item=>item.status==='unregistered').length}, warnings };
}
