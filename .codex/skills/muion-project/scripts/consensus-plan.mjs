import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, jsonWrite, nowIso, sha256File } from './project-utils.mjs';
import { readWorkflow, workflowDir, appendStageEvent, rel } from './workflow-store.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || path.resolve(import.meta.dirname, '../../../..'));
const command = args._[0] || 'status'; const id = args.workflow_run_id;
function run() { if (!id) throw new Error(`${command} requires --workflow-run-id`); return readWorkflow(root, id); }
function readDoc(file) { const target = path.resolve(root, file); if (!fs.existsSync(target)) throw new Error(`review file not found: ${file}`); return { path: rel(root, target), sha256: sha256File(target), value: JSON.parse(fs.readFileSync(target, 'utf8')) }; }
function main() {
  if (command === 'status' || command === 'resume') { console.log(JSON.stringify(run(), null, 2)); return; }
  const workflow = run();
  if (command === 'start') {
    if (workflow.stage !== 'CONSENSUS_PLAN' || !['READY', 'WAITING_USER', 'BLOCKED', 'RECOVERABLE'].includes(workflow.status)) throw new Error('consensus-plan start requires CONSENSUS_PLAN stage');
    const dir = workflowDir(root, id); fs.mkdirSync(dir, { recursive: true });
    const requirements = args.requirements || workflow.requirements_handoff; if (!requirements || !fs.existsSync(path.resolve(root, requirements))) throw new Error('requirements handoff is required');
    const plan = path.join(dir, 'consensus-plan.json');
    if (!fs.existsSync(plan)) jsonWrite(plan, { schema_version: '1.0.0', artifact_type: 'consensus-plan', workflow_run_id: id, task_id: workflow.task_id, requirements: rel(root, path.resolve(root, requirements)), review_cycle: 1, plan: { objective: workflow.task_id, steps: [], tests: [], verification: [] }, architect: null, critic: null, created_at: nowIso() });
    workflow.consensus_plan = rel(root, plan); appendStageEvent(root, workflow, 'consensus-plan-started', 'CONSENSUS_PLAN', 'WAITING_USER', 'record-architect', { artifact_refs: [workflow.consensus_plan] });
  } else if (command === 'record-review') {
    if (!args.role || !['architect', 'critic'].includes(String(args.role))) throw new Error('role must be architect or critic');
    if (!args.review_file) throw new Error('record-review requires --review-file');
    if (workflow.stage !== 'CONSENSUS_PLAN' || !['READY', 'WAITING_USER', 'BLOCKED', 'RECOVERABLE'].includes(workflow.status)) throw new Error('record-review requires CONSENSUS_PLAN stage');
    const review = readDoc(args.review_file); const body = review.value; const verdict = String(body.verdict || body.recommendation || '').toUpperCase();
    if (!['APPROVE', 'ITERATE', 'REJECT'].includes(verdict)) throw new Error('review verdict must be APPROVE, ITERATE or REJECT');
    if (args.role === 'critic' && (!workflow.architect_review || workflow.architect_review.verdict !== 'APPROVE')) throw new Error('critic review requires an approved architect review first');
    if (body.workflow_run_id && body.workflow_run_id !== id) throw new Error('review workflow_run_id mismatch');
    if (body.review_cycle && Number(body.review_cycle) !== Number(workflow.review_cycle || 1)) throw new Error('review cycle mismatch');
    const key = `${args.role}_review`; workflow[key] = { role: args.role, verdict, review_path: review.path, sha256: review.sha256, review_cycle: Number(body.review_cycle || workflow.review_cycle || 1), recorded_at: nowIso() };
    if (workflow.consensus_plan && fs.existsSync(path.resolve(root, workflow.consensus_plan))) {
      const planFile = path.resolve(root, workflow.consensus_plan); const plan = JSON.parse(fs.readFileSync(planFile, 'utf8')); plan[args.role] = workflow[key]; jsonWrite(planFile, plan);
    }
    if (args.role === 'architect') appendStageEvent(root, workflow, 'architect-review-recorded', 'CONSENSUS_PLAN', verdict === 'APPROVE' ? 'READY' : 'BLOCKED', verdict === 'APPROVE' ? 'record-critic' : 'revise-plan', { artifact_refs: [review.path] });
    else if (verdict === 'APPROVE') {
      const handoff = path.join(workflowDir(root, id), 'consensus-handoff.json');
      jsonWrite(handoff, { schema_version: '1.0.0', artifact_type: 'consensus-handoff', workflow_run_id: id, task_id: workflow.task_id, plan_path: workflow.consensus_plan || null, architect_review: workflow.architect_review, critic_review: workflow.critic_review, approved_at: nowIso() });
      workflow.consensus_handoff = rel(root, handoff);
      appendStageEvent(root, workflow, 'consensus-approved', 'PRECHECK', 'READY', 'preflight', { artifact_refs: [review.path, workflow.architect_review?.review_path, workflow.consensus_handoff] });
    }
    else appendStageEvent(root, workflow, 'consensus-revision-required', 'CONSENSUS_PLAN', 'BLOCKED', 'revise-plan', { artifact_refs: [review.path], reason: verdict });
  } else throw new Error('Usage: consensus-plan start|record-review|status|resume');
  console.log(JSON.stringify(workflow, null, 2));
}
main();
