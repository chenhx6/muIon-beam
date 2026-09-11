import fs from 'node:fs';
import path from 'node:path';

const read = (file, fallback = null, warnings = []) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (fs.existsSync(file)) warnings.push(`${path.basename(file)}: ${e.message}`); return fallback; } };
export function buildContinuation(root, state = {}, workflow = null) {
  const warnings = [];
  const farmer = read(path.join(root, '_work/current/farmer/state.json'), {}, warnings);
  const completed = Array.isArray(state.completed_stages) ? state.completed_stages : [];
  const current = workflow?.current || workflow?.current_stage || state.current_phase || 'idle';
  const next = workflow?.next_action || state.next_action || null;
  const leases = Object.entries(farmer || {}).map(([session_id, value]) => ({ session_id, status: value.status || null, lifecycle: value.lifecycle || null, last_event_timestamp: value.last_event_timestamp || null }));
  return { source: ['state.yaml', workflow ? 'workflow checkpoint' : null, leases.length ? '_work/current/farmer/state.json' : null].filter(Boolean), task: state.current_task || null, goal: state.current_goal || null, current, completed, next_action: next, leases, warnings };
}
