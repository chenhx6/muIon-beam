import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, jsonWrite, nowIso, sha256File } from './project-utils.mjs';
import { readWorkflow, writeWorkflow, workflowDir, appendStageEvent, makeId, rel, immutableJson } from './workflow-store.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || path.resolve(import.meta.dirname, '../../../..'));
const command = args._[0] || 'status';
const id = args.workflow_run_id;
function requireId() { if (!id) throw new Error(`${command} requires --workflow-run-id`); return readWorkflow(root, id); }
function readInput(file) { if (!file) return {}; const target = path.resolve(root, file); return JSON.parse(fs.readFileSync(target, 'utf8')); }
function artifact(run, input, skipped = false) {
  const dir = workflowDir(root, run.workflow_run_id); fs.mkdirSync(dir, { recursive: true });
  const snapshot = path.join(dir, 'context-snapshot.json');
  const handoff = path.join(dir, 'requirements-handoff.json');
  const card = input.task_card ? path.resolve(root, input.task_card) : null;
  const payload = { schema_version: '1.0.0', workflow_run_id: run.workflow_run_id, task_id: run.task_id, created_at: nowIso(), skipped, skip_reason: input.skip_reason || null, task_card: card ? { path: rel(root, card), sha256: sha256File(card) } : null, intake: input.intake || input.answers || input, constraints: input.constraints || [], success_criteria: input.success_criteria || [], non_goals: input.non_goals || [], decision_boundaries: input.decision_boundaries || [] };
  if (!fs.existsSync(snapshot)) immutableJson(snapshot, payload);
  if (!fs.existsSync(handoff)) immutableJson(handoff, { ...payload, artifact_type: 'requirements-handoff', context_snapshot: rel(root, snapshot), handoff_path: rel(root, handoff) });
  return { context_snapshot: rel(root, snapshot), requirements_handoff: rel(root, handoff) };
}
function main() {
  if (command === 'status') { const run = requireId(); console.log(JSON.stringify(run, null, 2)); return; }
  if (command === 'start') {
    if (!id || !args.task_id) throw new Error('start requires --workflow-run-id and --task-id');
    let run; try { run = readWorkflow(root, id); } catch { run = { schema_version: '1.0.0', workflow_run_id: id, task_id: String(args.task_id), stage: 'DEEP_INTERVIEW', status: 'WAITING_USER', attempts: 0, next_action: 'answer-intake', created_at: nowIso(), updated_at: nowIso(), events: [], owned_paths: [] }; }
    const input = readInput(args.input); if (args.task_card) input.task_card = args.task_card; const files = Object.keys(input).length ? artifact(run, input) : null;
    if (!files) { writeWorkflow(root, run); run = appendStageEvent(root, run, 'interview-started', 'DEEP_INTERVIEW', 'WAITING_USER', 'answer-intake'); }
    else { run.requirements_handoff = files.requirements_handoff; run.context_snapshot = files.context_snapshot; run = appendStageEvent(root, run, 'interview-completed', 'CONSENSUS_PLAN', 'READY', 'consensus-plan', { artifact_refs: [files.requirements_handoff, files.context_snapshot] }); }
    console.log(JSON.stringify(run, null, 2)); return;
  }
  const run = requireId();
  if (command === 'answer') {
    if (run.stage !== 'DEEP_INTERVIEW' || !['WAITING_USER', 'RECOVERABLE', 'BLOCKED'].includes(run.status)) throw new Error('answer requires a waiting deep-interview stage');
    const input = readInput(args.answers_file || args.input); if (!Object.keys(input).length) throw new Error('answer requires --answers-file or --input');
    const files = artifact(run, input); run.requirements_handoff = files.requirements_handoff; run.context_snapshot = files.context_snapshot; appendStageEvent(root, run, 'interview-completed', 'CONSENSUS_PLAN', 'READY', 'consensus-plan', { artifact_refs: [files.requirements_handoff, files.context_snapshot] });
  } else if (command === 'skip') {
    if (!args.reason) throw new Error('skip requires --reason');
    if (run.stage !== 'DEEP_INTERVIEW' || !['WAITING_USER', 'RECOVERABLE', 'BLOCKED'].includes(run.status)) throw new Error('skip requires a waiting deep-interview stage');
    const card = args.task_card || path.join('00_project/task-cards', `${run.task_id}.task-manifest.json`);
    if (!fs.existsSync(path.resolve(root, card))) throw new Error(`task card not found: ${card}`);
    const files = artifact(run, { task_card: card, skip_reason: args.reason, intake: { source: 'confirmed-task-card' } }, true);
    run.requirements_handoff = files.requirements_handoff; run.context_snapshot = files.context_snapshot; appendStageEvent(root, run, 'interview-skipped', 'CONSENSUS_PLAN', 'READY', 'consensus-plan', { artifact_refs: [files.requirements_handoff, files.context_snapshot], skip_reason: args.reason });
  } else if (command === 'resume') {
    if (run.stage === 'DEEP_INTERVIEW' && run.status === 'WAITING_USER') console.log(JSON.stringify(run, null, 2)); else console.log(JSON.stringify(run, null, 2));
    return;
  } else throw new Error('Usage: deep-interview start|answer|skip|status|resume');
  console.log(JSON.stringify(run, null, 2));
}
main();
