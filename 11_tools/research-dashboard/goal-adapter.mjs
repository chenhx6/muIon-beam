import fs from 'node:fs';
import path from 'node:path';

export function readGoalCheckpoint(root, workflow = null, state = {}) {
  const warnings = [];
  const empty = () => ({ source: null, workflow_run_id: null, goals: [], warnings });
  const id = workflow?.workflow_run_id;
  if (!id) return empty();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    warnings.push('goal checkpoint: invalid workflow id'); return empty();
  }
  if ((state.workflow_run_id && state.workflow_run_id !== id) ||
      (state.current_task?.task_id && state.current_task.task_id !== workflow.task_id)) {
    warnings.push('goal checkpoint: workflow conflicts with research-state'); return empty();
  }
  const canonical = path.resolve(root, '07_research_system/control/research-state/workflows', id, 'ultragoal-ledger.json');
  const mirror = path.resolve(root, '_work/current/workflows', id, 'ultragoal-ledger.json');
  const ref = workflow.ultragoal_ledger;
  if (ref && (typeof ref !== 'string' || ![canonical, mirror].includes(path.resolve(root, ref)))) {
    warnings.push('goal checkpoint: ledger reference is outside selected workflow'); return empty();
  }
  // Missing canonical storage permits the runtime mirror; corrupt canonical storage does not.
  for (const file of [canonical, mirror]) {
    try {
      const actual = fs.realpathSync(file);
      const relative = path.relative(fs.realpathSync(root), actual);
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('ledger symlink escapes project');
      const value = JSON.parse(fs.readFileSync(actual, 'utf8').replace(/^\uFEFF/, ''));
      if (value.workflow_run_id !== id || value.task_id !== workflow.task_id) throw new Error('ledger belongs to a different workflow/task');
      if (!Array.isArray(value.goals) || value.goals.some(g => !g || typeof g.id !== 'string' || typeof g.status !== 'string')) throw new Error('invalid goals');
      const activeGoal = state.current_goal?.id;
      if (activeGoal && !value.goals.some(g => g.id === activeGoal)) warnings.push('research-state goal is absent from selected checkpoint');
      if (value.goals.length && value.goals.every(g => g.status === 'complete') && workflow.status !== 'CLOSED') {
        warnings.push('goals complete; workflow validation, reports and archive gates are not proven complete');
      }
      return { source: path.relative(root, file).replaceAll('\\', '/'), workflow_run_id: id, goals: value.goals, warnings };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      warnings.push(`goal checkpoint: ${error.message}`); return empty();
    }
  }
  return empty();
}
