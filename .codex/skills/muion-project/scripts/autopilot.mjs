import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, jsonWrite, nowIso } from './project-utils.mjs';
import { makeId } from '../../../../07_research_system/control/research-state/index.mjs';
import { createWorkflowOwnership } from './workflow-ownership.mjs';
import { readWorkflow, writeWorkflow, appendStageEvent, workflowDir, rel } from './workflow-store.mjs';

const STAGES = ['INTAKE', 'TASK_CARD_READY', 'DEEP_INTERVIEW', 'CONSENSUS_PLAN', 'PRECHECK', 'MODEL_CONFIRMED', 'SNAPSHOT_READY', 'CONTRACT_READY', 'RUNNING', 'VALIDATING', 'REPORTING', 'QA', 'ARCHIVING', 'PUBLISHED', 'CLOSED'];
const TERMINAL = new Set(['CLOSED', 'FAILED_TERMINAL']);
const runtimeDir = (root, id) => path.join(root, '_work', 'current', 'workflows', id);
const runFile = (root, id) => path.join(runtimeDir(root, id), 'workflow.json');
const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeRun = (root, run) => writeWorkflow(root, run);
const resolve = (root, file) => file ? path.resolve(root, file) : null;
const taskCard = (root, taskId) => {
  const dir = path.join(root, '00_project', 'task-cards');
  if (!fs.existsSync(dir)) return null;
  const candidate = fs.readdirSync(dir).find((name) => name.includes(taskId) && name.endsWith('.json'));
  return candidate ? path.join(dir, candidate) : null;
};
function event(root, run, event_type, stage, status, next_action = null, extra = {}) {
  return appendStageEvent(root, run, event_type, stage, status, next_action, extra);
}
function requireRun(root, id) { return readWorkflow(root, id); }
function outputToFile(result, file) { fs.writeFileSync(file, `${result.stdout || ''}${result.stderr || ''}`, 'utf8'); }
function executeNode(root, script, args, outputFile) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, encoding: 'utf8', timeout: 3600000, maxBuffer: 50 * 1024 * 1024 });
  if (outputFile) outputToFile(result, outputFile);
  return result;
}
function createRun(root, args) {
  if (!args.task_id) throw new Error('plan requires --task-id');
  const id = args.workflow_run_id || makeId('WF');
  const run = { schema_version: '1.0.0', workflow_run_id: id, task_id: String(args.task_id), stage: 'INTAKE', status: 'PLANNED', created_at: nowIso(), updated_at: nowIso(), attempts: 0, next_action: 'run', contract: args.contract ? rel(root, args.contract) : null, snapshot_ref: args.snapshot_ref ? rel(root, args.snapshot_ref) : null, run_dir: args.run_dir ? rel(root, args.run_dir) : null, summary_report: args.summary_report ? rel(root, args.summary_report) : null, detailed_report: args.detailed_report ? rel(root, args.detailed_report) : null, sync_state: args.sync_state ? rel(root, args.sync_state) : null, owned_paths: Array.isArray(args.owned_path) ? args.owned_path : args.owned_path ? [args.owned_path] : [], events: [] };
  const ownership = createWorkflowOwnership(root, id, run.task_id, run.owned_paths);
  run.owned_paths_file = path.relative(root, path.join(runtimeDir(root, id), 'owned_paths.json')).replaceAll('\\\\', '/');
  run.ownership_head = ownership.head;
  writeRun(root, run); return event(root, run, 'workflow-created', 'INTAKE', 'PLANNED', 'run');
}
function advance(root, run) {
  if (TERMINAL.has(run.status)) return run;
  if (run.status === 'BLOCKED' || run.status === 'FAILED_RETRYABLE') return run;
  if (run.stage === 'INTAKE') return taskCard(root, run.task_id) ? event(root, run, 'stage-completed', 'TASK_CARD_READY', 'READY', 'deep-interview') : event(root, run, 'stage-blocked', 'INTAKE', 'BLOCKED', 'create-task-card', { reason: 'task card not found' });
  if (run.stage === 'TASK_CARD_READY') return event(root, run, 'stage-entered', 'DEEP_INTERVIEW', 'WAITING_USER', 'deep-interview answer-or-skip');
  if (run.stage === 'DEEP_INTERVIEW') return run.requirements_handoff && fs.existsSync(resolve(root, run.requirements_handoff)) ? event(root, run, 'stage-completed', 'CONSENSUS_PLAN', 'READY', 'consensus-plan') : event(root, run, 'stage-blocked', 'DEEP_INTERVIEW', 'BLOCKED', 'deep-interview answer-or-skip', { reason: 'requirements handoff is missing' });
  if (run.stage === 'CONSENSUS_PLAN') return run.consensus_handoff && fs.existsSync(resolve(root, run.consensus_handoff)) ? event(root, run, 'stage-completed', 'PRECHECK', 'READY', 'preflight') : event(root, run, 'stage-blocked', 'CONSENSUS_PLAN', 'BLOCKED', 'consensus-plan record-review', { reason: 'approved consensus handoff is missing' });
  if (run.stage === 'PRECHECK') {
    const preflight = executeNode(root, '.codex/skills/muion-project/scripts/preflight.mjs', ['.']);
    if (preflight.status !== 0) return event(root, run, 'stage-blocked', 'PRECHECK', 'BLOCKED', 'resolve-preflight', { reason: 'preflight failed' });
    const models = executeNode(root, '.codex/skills/muion-project/scripts/check-model-changes.mjs', []);
    if (models.status !== 0) return event(root, run, 'stage-blocked', 'PRECHECK', 'BLOCKED', 'resolve-model-confirmation', { reason: 'model fingerprint requires confirmation' });
    return event(root, run, 'stage-completed', 'MODEL_CONFIRMED', 'READY', 'snapshot');
  }
  if (run.stage === 'MODEL_CONFIRMED') {
    return run.snapshot_ref && fs.existsSync(resolve(root, run.snapshot_ref)) ? event(root, run, 'stage-completed', 'SNAPSHOT_READY', 'READY', 'contract') : event(root, run, 'stage-blocked', 'MODEL_CONFIRMED', 'BLOCKED', 'create-run-snapshot', { reason: 'snapshot_ref is missing or unavailable' });
  }
  if (run.stage === 'SNAPSHOT_READY') {
    if (!run.contract || !fs.existsSync(resolve(root, run.contract))) return event(root, run, 'stage-blocked', 'SNAPSHOT_READY', 'BLOCKED', 'provide-contract', { reason: 'contract is missing' });
    const validation = executeNode(root, '07_research_system/control/research-workflow/index.mjs', ['validate', '--contract', resolve(root, run.contract)]);
    if (validation.status !== 0) return event(root, run, 'stage-blocked', 'SNAPSHOT_READY', 'BLOCKED', 'repair-contract', { reason: 'contract validation failed' });
    return event(root, run, 'stage-completed', 'CONTRACT_READY', 'READY', 'execute');
  }
  if (run.stage === 'CONTRACT_READY') {
    run.attempts += 1; writeRun(root, run);
    const resultFile = path.join(runtimeDir(root, run.workflow_run_id), `execution-${run.attempts}.json`);
    event(root, run, 'stage-entered', 'RUNNING', 'RUNNING', 'collect-result', { output_refs: [path.relative(root, resultFile).replaceAll('\\\\', '/')] });
    const result = executeNode(root, '07_research_system/control/research-workflow/index.mjs', ['execute', '--contract', resolve(root, run.contract), '--root', root, '--attempt-id', `${run.workflow_run_id}-${run.attempts}`], resultFile);
    if (result.status !== 0) return event(root, run, 'stage-failed', 'RUNNING', 'FAILED_RETRYABLE', 'retry', { reason: 'research-workflow execution failed' });
    run.execution_result = path.relative(root, resultFile).replaceAll('\\\\', '/');
    writeRun(root, run);
    return event(root, run, 'stage-completed', 'VALIDATING', 'READY', 'validate-result', { output_refs: [run.execution_result] });
  }
  if (run.stage === 'RUNNING') {
    if (run.execution_result && fs.existsSync(resolve(root, run.execution_result))) return event(root, run, 'stage-completed', 'VALIDATING', 'READY', 'validate-result', { output_refs: [run.execution_result] });
    return event(root, run, 'stage-failed', 'CONTRACT_READY', 'FAILED_RETRYABLE', 'retry', { reason: 'execution interrupted before a committed result file was written' });
  }
  if (run.stage === 'VALIDATING') {
    let result; try { result = JSON.parse(fs.readFileSync(resolve(root, run.execution_result), 'utf8')); } catch { return event(root, run, 'stage-blocked', 'VALIDATING', 'BLOCKED', 'diagnose-result', { reason: 'execution result is not valid JSON' }); }
    const status = result?.report?.status || result?.status || result?.raw?.status;
    if (String(status).toUpperCase() !== 'SUCCESS') return event(root, run, 'stage-blocked', 'VALIDATING', 'BLOCKED', 'diagnose-result', { reason: 'execution did not produce validated SUCCESS', result_status: status || null });
    return event(root, run, 'stage-completed', 'REPORTING', 'READY', 'provide-reports');
  }
  if (run.stage === 'REPORTING') {
    if (!run.summary_report || !run.detailed_report || !fs.existsSync(resolve(root, run.summary_report)) || !fs.existsSync(resolve(root, run.detailed_report))) return event(root, run, 'stage-blocked', 'REPORTING', 'BLOCKED', 'write-dual-reports', { reason: 'summary and detailed reports are required' });
    return event(root, run, 'stage-completed', 'QA', 'READY', 'run-ultraqa');
  }
  if (run.stage === 'QA') {
    const qa = executeNode(root, '.codex/skills/muion-project/scripts/ultraqa.mjs', ['run', '--workflow-run-id', run.workflow_run_id, '--project-root', root]);
    if (qa.status !== 0) return event(root, run, 'stage-blocked', 'QA', 'BLOCKED', 'repair-qa', { reason: 'ultraqa failed' });
    const refreshed = readWorkflow(root, run.workflow_run_id); return event(root, refreshed, 'stage-completed', 'ARCHIVING', 'READY', 'verify-archive', { artifact_refs: [refreshed.qa_artifact] });
  }
  if (run.stage === 'ARCHIVING') {
    if (!run.sync_state || !fs.existsSync(resolve(root, run.sync_state))) return event(root, run, 'stage-blocked', 'ARCHIVING', 'BLOCKED', 'sync-and-verify', { reason: 'verified sync state is required' });
    const state = readJson(resolve(root, run.sync_state));
    if (state?.status !== 'three-way-verified') return event(root, run, 'stage-blocked', 'ARCHIVING', 'BLOCKED', 'verify-archive', { reason: 'sync state is not three-way-verified' });
    return event(root, run, 'stage-completed', 'PUBLISHED', 'READY', 'close');
  }
  if (run.stage === 'PUBLISHED') return event(root, run, 'stage-blocked', 'PUBLISHED', 'BLOCKED', 'autopilot close', { reason: 'close requires explicit close command' });
  return run;
}
function advanceUntilPause(root, run) {
  for (let i = 0; i < 32; i += 1) {
    const before = `${run.stage}:${run.status}:${run.next_action}`;
    if (TERMINAL.has(run.status) || ['BLOCKED', 'WAITING_USER', 'FAILED_RETRYABLE'].includes(run.status)) return run;
    const next = advance(root, run);
    run = next;
    const after = `${run.stage}:${run.status}:${run.next_action}`;
    if (before === after || ['BLOCKED', 'WAITING_USER', 'FAILED_RETRYABLE'].includes(run.status)) return run;
  }
  return run;
}
function main() {
  const args = parseArgs(process.argv.slice(2)); const root = path.resolve(args.project_root || projectRootFromHere()); const command = args._[0] || 'status';
  let run;
  if (command === 'plan') run = createRun(root, args);
  else {
    const id = args.workflow_run_id; if (!id) throw new Error(`${command} requires --workflow-run-id`); run = requireRun(root, id);
    if (['run', 'resume'].includes(command)) run = advanceUntilPause(root, run);
    else if (command === 'retry') { if (!['BLOCKED', 'FAILED_RETRYABLE'].includes(run.status)) throw new Error('retry requires a blocked or retryable workflow'); run.status = 'READY'; writeRun(root, run); run = advanceUntilPause(root, run); }
    else if (command === 'cancel') {
      run.cancelled_at = nowIso();
      run = event(root, run, 'workflow-cancelled', run.stage, 'FAILED_TERMINAL', 'inspect-preserved-artifacts', { reason: args.reason || 'cancelled by operator' });
    }
    else if (command === 'close') {
      if (run.stage !== 'PUBLISHED') throw new Error('close requires a published workflow');
      const requestPath = path.join(root, '00_project/state/task-close-request.json');
      const qa = run.qa_artifact && readJson(resolve(root, run.qa_artifact));
      if (!qa || qa.status !== 'pass') throw new Error('close requires a passing ultraqa artifact');
      jsonWrite(requestPath, { schema_version: 1, task_id: run.task_id, workflow_run_id: run.workflow_run_id, close_requested: true, qa_passed: true, qa_evidence_ref: run.qa_artifact, created_at: nowIso() });
      run.close_request = path.relative(root, requestPath).replaceAll('\\\\', '/');
      const closePlan = executeNode(root, '.codex/skills/muion-project/scripts/task-close.mjs', ['--owned-paths', run.owned_paths_file, 'plan']);
      if (closePlan.status !== 0) throw new Error(`task-close plan failed: ${closePlan.stderr || closePlan.stdout}`);
      run = event(root, run, 'close-requested', 'PUBLISHED', 'READY', 'task-close execute', { output_refs: [run.close_request] });
    }
    else if (command === 'finalize') {
      if (run.stage !== 'PUBLISHED' || !run.close_request) throw new Error('finalize requires a published workflow with a close request');
      const result = executeNode(root, '.codex/skills/muion-project/scripts/task-close.mjs', ['--owned-paths', run.owned_paths_file, 'execute']);
      if (result.status !== 0) throw new Error(`task-close execute failed: ${result.stderr || result.stdout}`);
      run = event(root, run, 'workflow-closed', 'CLOSED', 'CLOSED', 'idle', { output_refs: [run.close_request] });
    }
  }
  console.log(JSON.stringify(run, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
