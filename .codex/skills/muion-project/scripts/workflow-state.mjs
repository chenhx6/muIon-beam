import fs from 'node:fs';
import path from 'node:path';

export const phases = ['idle', 'interview', 'planned', 'approved', 'running', 'review', 'qa', 'archived', 'published', 'synced', 'blocked'];
export function readWorkflowState(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '00_project/state/workflow-state.json'), 'utf8')); }
  catch { return { phase: 'idle', active_goal_id: null, updated_at: null }; }
}
export function writeWorkflowState(root, state) {
  if (!phases.includes(state.phase)) throw new Error('invalid workflow phase: ' + state.phase);
  const file = path.join(root, '00_project/state/workflow-state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, ...state, updated_at: new Date().toISOString() }, null, 2) + '\n');
}
