import fs from 'node:fs';
import path from 'node:path';
import { relativePath, nowIso, sha256File } from './project-utils.mjs';
import { makeId, recordWorkflowEvent } from '../../../../07_research_system/control/research-state/index.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const stages = ['INTAKE', 'TASK_CARD_READY', 'DEEP_INTERVIEW', 'CONSENSUS_PLAN', 'PRECHECK', 'MODEL_CONFIRMED', 'SNAPSHOT_READY', 'CONTRACT_READY', 'RUNNING', 'VALIDATING', 'REPORTING', 'QA', 'ARCHIVING', 'PUBLISHED', 'CLOSED'];
const statuses = ['PLANNED', 'WAITING_USER', 'READY', 'RUNNING', 'RECOVERABLE', 'BLOCKED', 'FAILED_RETRYABLE', 'CLOSED', 'FAILED_TERMINAL'];

function validId(id) { if (!ID.test(String(id || ''))) throw new Error(`invalid workflow id: ${id}`); }
export function workflowDir(root, id) { validId(id); return path.join(root, '07_research_system/control/research-state/workflows', id); }
export function runtimeWorkflowDir(root, id) { validId(id); return path.join(root, '_work/current/workflows', id); }
export function workflowPath(root, id) { return path.join(workflowDir(root, id), 'workflow.json'); }
export function runtimeWorkflowPath(root, id) { return path.join(runtimeWorkflowDir(root, id), 'workflow.json'); }
export function readWorkflow(root, id) {
  validId(id);
  for (const file of [workflowPath(root, id), runtimeWorkflowPath(root, id)]) {
    if (fs.existsSync(file)) {
      const run = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (run.workflow_run_id !== id || !stages.includes(run.stage) || !statuses.includes(run.status)) throw new Error('corrupt workflow checkpoint');
      return run;
    }
  }
  throw new Error(`workflow run not found: ${id}`);
}
export function writeWorkflow(root, run) {
  validId(run.workflow_run_id);
  if (!run.task_id || typeof run.task_id !== 'string') throw new Error('workflow task_id is required');
  if (!stages.includes(run.stage)) throw new Error(`invalid workflow stage: ${run.stage}`);
  if (!statuses.includes(run.status)) throw new Error(`invalid workflow status: ${run.status}`);
  if (!Number.isInteger(run.attempts) || run.attempts < 0) throw new Error('workflow attempts must be a non-negative integer');
  if (!Array.isArray(run.events) || !Array.isArray(run.owned_paths)) throw new Error('workflow events and owned_paths must be arrays');
  run.updated_at = nowIso();
  atomicJson(workflowPath(root, run.workflow_run_id), run);
  // Compatibility mirror for existing local ownership/runtime tools.
  atomicJson(runtimeWorkflowPath(root, run.workflow_run_id), run);
  return run;
}
export function rel(root, file) {
  if (!file) return null;
  const absolute = path.resolve(root, file);
  const relative = relativePath(root, absolute);
  if (relative.startsWith('../') || relative === '..') throw new Error(`workflow path escapes project: ${file}`);
  if (fs.existsSync(absolute)) {
    const actual = path.relative(fs.realpathSync(root), fs.realpathSync(absolute));
    if (path.isAbsolute(actual) || actual === '..' || actual.startsWith(`..${path.sep}`)) throw new Error(`workflow symlink escapes project: ${file}`);
  }
  return relative;
}
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
export function immutableJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export function artifactRef(root, file) { return { path: rel(root, file), sha256: sha256File(path.resolve(root, file)) }; }
export function verifyRef(root, ref) {
  if (!ref?.path || !/^[a-f0-9]{64}$/i.test(ref.sha256 || '')) throw new Error('missing artifact path/hash');
  rel(root, ref.path);
  if (sha256File(path.resolve(root, ref.path)) !== ref.sha256) throw new Error(`artifact hash mismatch: ${ref.path}`);
  return JSON.parse(fs.readFileSync(path.resolve(root, ref.path), 'utf8'));
}
export function appendStageEvent(root, run, eventType, stage, status, nextAction, extra = {}) {
  const operationId = `${run.workflow_run_id}:${stage}:${run.attempts || 0}:${eventType}`;
  const recorded = recordWorkflowEvent({
    event_type: eventType,
    workflow_run_id: run.workflow_run_id,
    task_id: run.task_id,
    stage,
    status,
    operation_id: operationId,
    idempotency_key: operationId,
    attempt: run.attempts || 0,
    retry_count: run.attempts || 0,
    next_action: nextAction,
    artifact_refs: extra.artifact_refs || [],
    ...extra,
  }, root);
  const existing = Array.isArray(run.events) ? run.events : [];
  if (!existing.some((item) => item.idempotency_key === recorded.idempotency_key)) existing.push(recorded);
  run.events = existing;
  run.stage = stage;
  run.status = status;
  run.next_action = nextAction;
  writeWorkflow(root, run);
  return run;
}
export function checkpoint(root, run, patch, eventType = 'stage-checkpoint') {
  Object.assign(run, patch);
  return appendStageEvent(root, run, eventType, run.stage, run.status, run.next_action, patch);
}
export function assertStage(run, expected) {
  if (run.stage !== expected) throw new Error(`workflow ${run.workflow_run_id} is at ${run.stage}; expected ${expected}`);
}
export { stages, statuses, makeId };
