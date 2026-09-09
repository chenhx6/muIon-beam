import { readState, setWorkflowPhase } from '../../../../07_research_system/control/research-state/index.mjs';

export const phases = ['idle', 'interview', 'planned', 'approved', 'running', 'review', 'qa', 'archived', 'published', 'synced', 'blocked'];
export function readWorkflowState(root) {
  try { const state = readState(root); return { schema_version: 1, phase: state.legacy_phase || (state.task_status === 'IDLE' ? 'idle' : 'running'), active_goal_id: state.current_goal?.id || null, updated_at: state.updated_at }; }
  catch (error) { return { phase: 'blocked', active_goal_id: null, updated_at: null, blocked_reason: error.message, state_error: true }; }
}
export function writeWorkflowState(root, state) {
  if (!phases.includes(state.phase)) throw new Error('invalid workflow phase: ' + state.phase);
  setWorkflowPhase(root, state.phase, state.active_goal_id || null);
}
