import { beginContext, closeContext, ensureInitialized, makeId, readState, recordDispatch, recordModuleResult, recordValidation } from './index.mjs';
import { freezeContract, makeCompatibilityContract, normalizeModuleResult, writeAttemptReport } from '../contracts/index.mjs';

export async function trackExecution({ root = process.cwd(), module, task = {}, contextId = null, execute, phase = 'module-execution' } = {}) {
  if (typeof execute !== 'function') throw new Error('trackExecution requires execute');
  ensureInitialized(root);
  const current = readState(root);
  if (current.context_id && current.context_id !== contextId) throw new Error(`foreground context already running: ${current.context_id}`);
  const contract = makeCompatibilityContract(module, task);
  const frozen = freezeContract(contract, { root });
  const context = contextId && current.context_id === contextId ? { context_id: contextId } : beginContext({ root, context_id: contextId, entrypoint: module, context_kind: 'direct-module', module, task_id: frozen.contract.task_id, external_task_id: task.task_id || null, objective: task.objective || `${module} direct task`, current_question: task.objective || null });
  const attemptId = makeId('ATT');
  recordDispatch(context.context_id, { attempt_id: attemptId, contract: { contract_id: frozen.contract.contract_id, path: frozen.path, sha256: frozen.sha256 }, phase }, root);
  let raw;
  try { raw = await execute(); } catch (error) { raw = { status: 'failed', issues: [{ category: 'infrastructure', code: 'module-exception', observation: error.message, evidence: [error.stack || String(error)] }] }; }
  const report = normalizeModuleResult(module, raw, { contract: frozen.contract, attemptId });
  const files = writeAttemptReport(frozen, report, { root, attemptId });
  recordModuleResult(context.context_id, { status: report.status, report_path: files.report_path, contract_id: frozen.contract.contract_id }, root);
  if (report.validation && Object.keys(report.validation).length) recordValidation(context.context_id, { status: report.validation_status, report_path: files.report_path }, root);
  closeContext(context.context_id, report.status, root);
  return { raw, report, frozen, files, context_id: context.context_id, attempt_id: attemptId };
}

export async function trackValidation({ root = process.cwd(), module = 'validation', task = {}, contextId = null, execute } = {}) {
  return trackExecution({ root, module, task, contextId, execute, phase: 'validation' });
}
