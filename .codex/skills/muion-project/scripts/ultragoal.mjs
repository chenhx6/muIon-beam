import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, jsonWrite, nowIso, sha256File } from './project-utils.mjs';
import { readWorkflow, workflowDir, appendStageEvent, rel } from './workflow-store.mjs';

const args = parseArgs(process.argv.slice(2)); const root = path.resolve(args.project_root || path.resolve(import.meta.dirname, '../../../..')); const command = args._[0] || 'status'; const id = args.workflow_run_id;
function main() {
  if (!id) throw new Error(`${command} requires --workflow-run-id`);
  const run = readWorkflow(root, id); const dir = workflowDir(root, id); fs.mkdirSync(dir, { recursive: true }); const ledger = path.join(dir, 'ultragoal-ledger.json');
  if (command === 'status' || command === 'resume') { console.log(JSON.stringify({ workflow: run, ledger: fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : null }, null, 2)); return; }
  if (command === 'create-goals') {
    const goals = (args.goal ? (Array.isArray(args.goal) ? args.goal : [args.goal]) : ['execute', 'validate', 'report', 'archive']).map((objective, index) => ({ id: `goal-${index + 1}`, objective, status: 'pending', evidence: [], attempts: 0 }));
    jsonWrite(ledger, { schema_version: '1.0.0', workflow_run_id: id, task_id: run.task_id, created_at: nowIso(), goals }); run.ultragoal_ledger = rel(root, ledger); appendStageEvent(root, run, 'ultragoal-created', 'RUNNING', 'READY', 'execute-goal', { artifact_refs: [run.ultragoal_ledger] });
  } else if (command === 'checkpoint') {
    if (!fs.existsSync(ledger)) throw new Error('ultragoal ledger is missing'); const value = JSON.parse(fs.readFileSync(ledger, 'utf8')); const goal = value.goals.find((item) => item.id === args.goal_id); if (!goal) throw new Error('goal not found');
    goal.status = args.status || 'complete'; goal.attempts += 1; if (args.evidence) goal.evidence.push({ path: rel(root, args.evidence), sha256: sha256File(path.resolve(root, args.evidence)), recorded_at: nowIso() }); jsonWrite(ledger, value); run.ultragoal_ledger = rel(root, ledger); appendStageEvent(root, run, 'ultragoal-checkpoint', 'RUNNING', 'READY', 'execute-goal', { artifact_refs: goal.evidence });
  } else if (command === 'complete') {
    if (!fs.existsSync(ledger)) throw new Error('ultragoal ledger is missing'); const value = JSON.parse(fs.readFileSync(ledger, 'utf8')); if (value.goals.some((goal) => goal.status !== 'complete')) throw new Error('cannot complete ultragoal with pending goals'); run.ultragoal_completed_at = nowIso(); appendStageEvent(root, run, 'ultragoal-completed', 'VALIDATING', 'READY', 'validate-result', { artifact_refs: [rel(root, ledger)] });
  } else throw new Error('Usage: ultragoal create-goals|status|checkpoint|resume|complete');
  console.log(JSON.stringify(run, null, 2));
}
main();
