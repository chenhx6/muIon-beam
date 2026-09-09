import fs from 'node:fs';
import path from 'node:path';
import { parseYamlFile } from '../../../.codex/skills/muion-project/scripts/yaml-lite.mjs';
import { beginContext, closeContext, ensureInitialized, makeId, recordDispatch, recordModuleResult, recordValidation, readState, renderChatStatus } from '../research-state/index.mjs';
import { executeNative, normalizeModuleResult } from './scripts/adapters.mjs';
import { freezeContract, loadContract, validateContract, writeAttemptReport } from './scripts/contracts.mjs';

function inputDocument(file) { const target = path.resolve(file); return target.toLowerCase().endsWith('.json') ? JSON.parse(fs.readFileSync(target, 'utf8')) : parseYamlFile(target); }

export function validateResearchContract(input) { return validateContract(input); }

export function dispatchContract(contractInput, { root = process.cwd(), sourcePath = null, context = {} } = {}) {
  ensureInitialized(root);
  const frozen = freezeContract(contractInput, { root, sourcePath });
  const state = beginContext({ root, ...context, task_id: frozen.contract.task_id, module: frozen.contract.module, objective: frozen.contract.objective, context_id: context.context_id });
  const attemptId = makeId('ATT');
  recordDispatch(state.context_id, { attempt_id: attemptId, contract: { contract_id: frozen.contract.contract_id, path: frozen.path, sha256: frozen.sha256 } }, root);
  return { frozen, context_id: state.context_id, task_id: frozen.contract.task_id, attempt_id: attemptId };
}

export async function executeContract(contractInput, { root = process.cwd(), sourcePath = null, context = {}, module_options = {}, dryRun = false } = {}) {
  const dispatched = dispatchContract(contractInput, { root, sourcePath, context });
  let raw;
  try { raw = await executeNative(dispatched.frozen.contract, { module_options, dryRun }); }
  catch (error) { raw = { status: 'failed', issues: [{ category: 'infrastructure', code: 'module-exception', observation: error.message, evidence: [error.stack || String(error)] }] }; }
  const report = normalizeModuleResult(dispatched.frozen.contract.module, raw, { contract: dispatched.frozen.contract, attemptId: dispatched.attempt_id });
  const files = writeAttemptReport(dispatched.frozen, report, { root, attemptId: dispatched.attempt_id });
  report.traceability = { ...report.traceability, ...files };
  recordModuleResult(dispatched.context_id, { status: report.status, report_path: files.report_path, contract_id: dispatched.frozen.contract.contract_id }, root);
  if (report.validation && Object.keys(report.validation).length) recordValidation(dispatched.context_id, { status: report.validation_status, report_path: files.report_path }, root);
  closeContext(dispatched.context_id, report.status, root);
  return { ...dispatched, raw, report, files };
}

export function status(root = process.cwd()) { return { state: readState(root), chat: renderChatStatus(root) }; }

function argValue(args, key) { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : null; }
if (process.argv[1] && path.basename(process.argv[1]) === 'index.mjs' && process.argv[1].includes(`${path.sep}research-workflow${path.sep}`)) {
  const args = process.argv.slice(2); const command = args[0]; const root = path.resolve(argValue(args, '--root') || process.cwd());
  (async () => {
    if (command === 'validate') { const value = inputDocument(argValue(args, '--contract')); console.log(JSON.stringify(validateResearchContract(value), null, 2)); return; }
    if (command === 'status') { console.log(JSON.stringify(status(root), null, 2)); return; }
    if (command === 'dispatch') { const value = inputDocument(argValue(args, '--contract')); console.log(JSON.stringify(dispatchContract(value, { root, sourcePath: argValue(args, '--contract') }), null, 2)); return; }
    if (command === 'execute') { const file = argValue(args, '--contract'); const value = inputDocument(file); console.log(JSON.stringify(await executeContract(value, { root, sourcePath: file, dryRun: args.includes('--dry-run') }), null, 2)); return; }
    throw new Error('Usage: node 07_research_system/control/research-workflow/index.mjs validate|dispatch|execute|status --contract file [--root path]');
  })().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
