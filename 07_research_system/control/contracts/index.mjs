import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseYaml } from '../../../.codex/skills/muion-project/scripts/yaml-lite.mjs';
import { makeId } from '../research-state/index.mjs';
import { contractsPath } from '../../paths.mjs';

const MODULES = new Set(['3d', 'comsol', 'geant4']);
const SCOPES = ['fixed', 'explorable', 'forbidden'];

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function scalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(String(value));
}
function yaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) return value.length ? value.map((v) => isObject(v) ? `${pad}-\n${yaml(v, indent + 2)}` : `${pad}- ${scalar(v)}`).join('\n') : `${pad}[]`;
  if (!isObject(value)) return `${pad}${scalar(value)}`;
  return Object.entries(value).map(([key, v]) => isObject(v) || Array.isArray(v) ? `${pad}${key}:\n${yaml(v, indent + 2)}` : `${pad}${key}: ${scalar(v)}`).join('\n');
}
function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function readDocument(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  if (text.startsWith('{') || text.startsWith('[')) return JSON.parse(text);
  return parseYaml(text);
}

function normalizeEntry(value, scope, index) {
  const entry = typeof value === 'string' ? { name: value } : { ...(value || {}) };
  const name = String(entry.name || '').trim();
  if (!name) throw new Error(`${scope}[${index}] requires name`);
  return { ...entry, name, canonical_name: name.toLowerCase(), scope };
}

function hasBoundary(entry) {
  return Array.isArray(entry.allowed_values) && entry.allowed_values.length > 0 || entry.allowed_range && Number.isFinite(Number(entry.allowed_range.min)) && Number.isFinite(Number(entry.allowed_range.max)) || Array.isArray(entry.explicit_cases) && entry.explicit_cases.length > 0;
}

export function normalizeContract(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('contract must be an object');
  const contract = { schema_version: input.schema_version || '1.0.0', ...input };
  contract.contract_id = contract.contract_id || makeId(`CONTRACT-${String(contract.module || 'UNKNOWN').toUpperCase()}`);
  contract.task_id = contract.task_id || makeId('TASK');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(contract.contract_id))) throw new Error('contract_id contains unsafe path characters');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(contract.task_id))) throw new Error('task_id contains unsafe path characters');
  if (!MODULES.has(contract.module)) throw new Error('module must be one of 3d, comsol, geant4');
  if (!String(contract.objective || '').trim()) throw new Error('objective is required');
  for (const scope of SCOPES) contract[scope] = (Array.isArray(contract[scope]) ? contract[scope] : []).map((value, index) => normalizeEntry(value, scope, index));
  return contract;
}

export function validateContract(input, { existingIds = new Set() } = {}) {
  try {
    const contract = normalizeContract(input); const owners = new Map(); const errors = []; const warnings = [];
    if (existingIds.has(contract.contract_id)) errors.push(`contract_id already exists: ${contract.contract_id}`);
    if (!contract.inputs || typeof contract.inputs !== 'object' || Array.isArray(contract.inputs)) errors.push('inputs must be an object');
    for (const scope of SCOPES) for (const entry of contract[scope]) {
      if (owners.has(entry.canonical_name)) errors.push(`${entry.name} overlaps ${owners.get(entry.canonical_name)} and ${scope}`); else owners.set(entry.canonical_name, scope);
      if (scope === 'explorable' && !hasBoundary(entry)) errors.push(`${entry.name} in explorable requires allowed_values, allowed_range or explicit_cases`);
      if (scope === 'explorable' && !entry.owner) errors.push(`${entry.name} in explorable requires owner`);
      if (scope === 'forbidden' && !entry.owner) errors.push(`${entry.name} in forbidden requires owner`);
      if (entry.allowed_range && Number(entry.allowed_range.min) > Number(entry.allowed_range.max)) errors.push(`${entry.name} has inverted allowed_range`);
    }
    if (!Array.isArray(contract.required_outputs) || !contract.required_outputs.length) warnings.push('required_outputs is empty');
    if (!Array.isArray(contract.validation_requirements)) warnings.push('validation_requirements should be an array');
    return { valid: errors.length === 0, contract, errors, warnings };
  } catch (error) { return { valid: false, contract: null, errors: [error.message], warnings: [] }; }
}

export function loadContract(file) { return normalizeContract(readDocument(path.resolve(file))); }

export function freezeContract(input, { root = process.cwd(), sourcePath = null, reuseExisting = false } = {}) {
  const checked = validateContract(input); if (!checked.valid) throw new Error(`Invalid contract: ${checked.errors.join('; ')}`);
  const contract = checked.contract; const directory = contractsPath(root, path.join('instances', contract.contract_id)); const file = path.join(directory, 'contract.yaml');
  fs.mkdirSync(directory, { recursive: true });
  // JSON is a strict YAML 1.2 subset and avoids lossy parsing of nested arrays
  // in the project's dependency-free YAML reader.
  const text = `${JSON.stringify(contract, null, 2)}\n`;
  if (reuseExisting && fs.existsSync(file)) {
    const digest = sha256(file);
    return { contract, path: path.relative(root, file).replaceAll('\\', '/'), sha256: digest, source_path: sourcePath ? path.relative(root, sourcePath).replaceAll('\\', '/') : null, reused: true };
  }
  const fd = fs.openSync(file, 'wx');
  try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
  const digest = sha256(file); const verify = sha256(file); if (digest !== verify) throw new Error('contract hash verification failed');
  return { contract, path: path.relative(root, file).replaceAll('\\', '/'), sha256: digest, source_path: sourcePath ? path.relative(root, sourcePath).replaceAll('\\', '/') : null };
}

export function writeAttemptReport(frozen, report, { root = process.cwd(), attemptId = makeId('ATT') } = {}) {
  const directory = contractsPath(root, path.join('instances', frozen.contract.contract_id, 'attempts', attemptId)); fs.mkdirSync(directory, { recursive: true });
  const dispatch = { schema_version: '1.0.0', dispatch_id: makeId('DISPATCH'), attempt_id: attemptId, contract_id: frozen.contract.contract_id, contract_path: frozen.path, contract_sha256: frozen.sha256, created_at: new Date().toISOString() };
  const dispatchPath = path.join(directory, 'dispatch.json'); const reportPath = path.join(directory, 'result-issue-report.yaml');
  fs.writeFileSync(dispatchPath, `${JSON.stringify(dispatch, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { attempt_id: attemptId, dispatch_path: path.relative(root, dispatchPath).replaceAll('\\', '/'), report_path: path.relative(root, reportPath).replaceAll('\\', '/') };
}

export function readContractFile(file) { return readDocument(path.resolve(file)); }
export { yaml };

export function makeCompatibilityContract(module, task = {}) {
  const moduleName = String(module);
  return normalizeContract({
    schema_version: '1.0.0', contract_mode: 'native-compatibility', module: ['3d', 'comsol', 'geant4'].includes(moduleName) ? moduleName : 'comsol',
    task_id: null, external_task_id: task.task_id || null, objective: task.objective || `${moduleName} direct task`, current_question: task.objective || null,
    inputs: task.inputs || task, assumptions: task.assumptions || [], fixed: task.fixed || [], explorable: (task.variable || task.explorable || []).map((entry) => ({ ...entry, owner: entry.owner || moduleName, allowed_values: entry.allowed_values || entry.diagnostic_probe_values || (entry.current !== undefined ? [entry.current] : undefined) })),
    forbidden: (task.external || task.forbidden || []).map((entry) => ({ ...entry, owner: entry.owner || 'research-workflow' })), observables: task.observables || [], required_outputs: task.required_outputs || ['result'], success_criteria: task.success_criteria || [], validation_requirements: task.validation_requirements || [], traceability: task.traceability || {}
  });
}

export function checkScopeParameters(contract, parameters = {}, { baseline = false } = {}) {
  const errors = []; const fixed = new Map((contract.fixed || []).map((v) => [v.canonical_name || String(v.name).toLowerCase(), v])); const explorable = new Map((contract.explorable || []).map((v) => [v.canonical_name || String(v.name).toLowerCase(), v])); const forbidden = new Set((contract.forbidden || []).map((v) => v.canonical_name || String(v.name).toLowerCase()));
  const permitted = (entry, value) => {
    if (baseline && entry.current !== undefined && String(value) === String(entry.current)) return true;
    if (Array.isArray(entry.allowed_values) && entry.allowed_values.some((candidate) => String(candidate) === String(value))) return true;
    if (entry.allowed_range && typeof value === 'number') return value >= Number(entry.allowed_range.min) && value <= Number(entry.allowed_range.max);
    return false;
  };
  for (const [name, value] of Object.entries(parameters)) {
    const key = name.toLowerCase();
    if (fixed.has(key)) errors.push(`${name} is fixed`);
    else if (forbidden.has(key)) errors.push(`${name} is forbidden`);
    else if (!explorable.has(key)) errors.push(`${name} is not explorable`);
    else if (!permitted(explorable.get(key), value)) errors.push(`${name} value is outside the contract boundary`);
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeModuleResult(module, raw, { contract, attemptId, rawReference = null } = {}) {
  const nativeStatus = String(raw?.status || '').toLowerCase(); let status = 'PARTIAL';
  if (nativeStatus === 'blocked') status = 'BLOCKED'; else if (nativeStatus === 'failed') status = 'FAILED';
  else if (module === '3d') status = nativeStatus === 'accepted' || nativeStatus === 'dry-run' ? 'PARTIAL' : 'BLOCKED';
  else if (nativeStatus === 'complete' && raw?.validation && ['passed', 'pass', 'validated'].includes(String(raw.validation.status || raw.validation.validation_status).toLowerCase())) status = 'SUCCESS';
  const issues = [];
  const rawIssues = [...(raw?.issues || []), ...(raw?.baseline?.errors || []), ...(raw?.cases || []).flatMap((item) => item.errors || [])];
  for (const item of rawIssues) issues.push({ issue_id: item.issue_id || `${module}-issue-${issues.length + 1}`, category: item.category || 'unknown', code: item.code || item.title || 'module-issue', observation: item.observation || item.message || item.title || 'module issue', evidence: item.evidence || [], candidate_explanations: item.candidate_explanations || [], suggested_next_checks: item.suggested_next_checks || item.recommended_action || [], owner: item.owner || 'research-workflow', confidence: item.confidence || 'preliminary' });
  return { schema_version: '1.0.0', report_id: makeId('REPORT'), task_id: contract.task_id, contract_id: contract.contract_id, attempt_id: attemptId, entrypoint: module, module, status, execution_status: nativeStatus || 'not-evaluated', summary: status === 'SUCCESS' ? 'Module execution and required validation completed.' : `Module returned ${nativeStatus || 'no status'}; control-layer validation remains incomplete.`, main_results: raw?.findings || raw?.outputs || raw?.baseline || raw || {}, produced_artifacts: raw?.output_bundle || raw?.artifacts || [], validation_status: raw?.validation?.status || raw?.validation?.validation_status || 'not-evaluated', validation: raw?.validation || {}, issues, limitations: raw?.limitations || [], recommendation: raw?.suggested_next_checks || raw?.next_interface_requests || [], requires_new_contract: Boolean(raw?.scope_expansion_requests?.length || raw?.escalations?.length), proposal: raw?.scope_expansion_requests?.length || raw?.escalations?.length ? { scope_expansion_requests: raw.scope_expansion_requests || [], escalations: raw.escalations || [] } : null, raw_result_reference: rawReference || raw?.output_bundle || null, traceability: { contract_id: contract.contract_id, attempt_id: attemptId } };
}
