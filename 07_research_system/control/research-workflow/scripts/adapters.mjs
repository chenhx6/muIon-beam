import { run3d } from '../../../blocks/3d/index.mjs';
import { runComsol } from '../../../blocks/comsol/index.mjs';
import { detectComsolAdapter } from '../../../blocks/comsol/build/index.mjs';
import { runGeant4 } from '../../../blocks/geant4/index.mjs';
import { checkScopeParameters } from '../../contracts/index.mjs';
import { makeId } from '../../research-state/index.mjs';

function guardedComsolAdapter(contract, adapter) {
  if (!adapter) return adapter;
  return {
    ...adapter,
    async solveCase(caseSpec, context) {
      const check = checkScopeParameters(contract, caseSpec?.parameters || {}, { baseline: caseSpec?.kind === 'baseline' });
      if (!check.valid) return { status: 'blocked', outputs: {}, errors: [{ category: 'scope-violation', message: check.errors.join('; ') }], warnings: [{ code: 'scope-violation', message: 'Control layer prevented an unauthorized COMSOL case.' }] };
      return adapter.solveCase(caseSpec, context);
    },
    async recoverCase(caseSpec, context) {
      const check = checkScopeParameters(contract, caseSpec?.parameters || {}, { baseline: caseSpec?.kind === 'baseline' });
      if (!check.valid) throw new Error(`scope violation during recovery: ${check.errors.join('; ')}`);
      if (typeof adapter.recoverCase === 'function') return adapter.recoverCase(caseSpec, context);
      return undefined;
    }
  };
}

export function toNativeTask(contract) {
  if (contract.module === '3d') return { task_id: contract.task_id, ...(contract.inputs || {}), mode: contract.inputs?.mode || contract.mode, geometry_level: contract.inputs?.geometry_level || contract.geometry_level || 'G1', _research_contract: contract.contract_id };
  if (contract.module === 'comsol') {
    const external = [...(contract.forbidden || [])].filter((v) => ['3d', 'geant4', 'research-workflow', 'upstream-source'].includes(String(v.owner || '').toLowerCase())).map(({ canonical_name, scope, ...v }) => v);
    return { task_id: contract.task_id, objective: contract.objective, inputs: contract.inputs || {}, assumptions: contract.assumptions || [], fixed: contract.fixed || [], variable: contract.explorable || [], external, success_criteria: contract.success_criteria || [], required_outputs: contract.required_outputs || [], exploration_level: contract.execution_policy?.exploration_level || (contract.explorable?.length ? 'bounded' : 'none'), diagnostic_cases: contract.inputs?.diagnostic_cases || [], exploration_cases: contract.inputs?.exploration_cases || [], traceability: { contract_id: contract.contract_id }, _research_contract: contract.contract_id };
  }
  const input = contract.inputs || {};
  return { task_id: contract.task_id, objective: contract.objective, geometry: input.geometry || contract.geometry, materials: input.materials || [], source: input.source || input.particle_source || {}, physics: input.physics || {}, fields: input.fields || input.field_configuration || {}, scoring: input.scoring || [], diagnostic_cases: input.diagnostic_cases || [], run: input.run || {}, executable: input.executable, arguments: input.arguments || [], traceability: { contract_id: contract.contract_id }, _research_contract: contract.contract_id };
}

export function normalizeModuleResult(module, raw, { contract, attemptId }) {
  const nativeStatus = String(raw?.status || '').toLowerCase(); let status = 'PARTIAL';
  if (nativeStatus === 'blocked') status = 'BLOCKED';
  else if (nativeStatus === 'failed') status = 'FAILED';
  else if (module === '3d') status = nativeStatus === 'accepted' ? 'PARTIAL' : nativeStatus === 'dry-run' ? 'PARTIAL' : 'BLOCKED';
  else if (nativeStatus === 'complete' && raw?.validation && ['passed', 'pass', 'validated'].includes(String(raw.validation.status || raw.validation.validation_status).toLowerCase())) status = 'SUCCESS';
  const issues = [];
  const rawIssues = [...(raw?.issues || []), ...(raw?.baseline?.errors || []), ...(raw?.cases || []).flatMap((item) => item.errors || [])];
  for (const item of rawIssues) issues.push({ issue_id: item.issue_id || `${module}-issue-${issues.length + 1}`, category: item.category || 'unknown', code: item.code || item.title || 'module-issue', observation: item.observation || item.message || item.title || 'module issue', evidence: item.evidence || [], candidate_explanations: item.candidate_explanations || [], suggested_next_checks: item.suggested_next_checks || item.recommended_action || [], owner: item.owner || 'research-workflow', confidence: item.confidence || 'preliminary' });
  const validation_status = raw?.validation?.status || raw?.validation?.validation_status || 'not-evaluated';
  const evidence_summary = { status: validation_status, issue_count: issues.length, artifacts: raw?.output_bundle || raw?.artifacts || [], rerun_required: status !== 'SUCCESS', unresolved_items: issues.map((item) => item.code) };
  return { schema_version: '1.0.0', report_id: makeId('REPORT'), task_id: contract.task_id, contract_id: contract.contract_id, attempt_id: attemptId, entrypoint: module, module, status, execution_status: nativeStatus || 'not-evaluated', summary: status === 'SUCCESS' ? 'Module execution and required validation completed.' : `Module returned ${nativeStatus || 'no status'}; control-layer validation remains incomplete.`, main_results: raw?.findings || raw?.outputs || raw?.baseline || raw || {}, produced_artifacts: raw?.output_bundle || raw?.artifacts || [], validation_status, validation: raw?.validation || {}, evidence_summary, issues, limitations: raw?.limitations || [], recommendation: raw?.suggested_next_checks || raw?.next_interface_requests || [], requires_new_contract: Boolean(raw?.scope_expansion_requests?.length || raw?.escalations?.length), proposal: raw?.scope_expansion_requests?.length || raw?.escalations?.length ? { scope_expansion_requests: raw.scope_expansion_requests || [], escalations: raw.escalations || [] } : null, raw_result_reference: raw?.output_bundle || null, traceability: { contract_id: contract.contract_id, attempt_id: attemptId } };
}

export async function executeNative(contract, options = {}) {
  const native = toNativeTask(contract);
  if (contract.module === '3d') return run3d(native, { dryRun: options.dryRun === true });
  if (contract.module === 'comsol') {
    const moduleOptions = options.module_options || {};
    const adapter = guardedComsolAdapter(contract, moduleOptions.adapter || detectComsolAdapter(moduleOptions.env || process.env));
    return runComsol(native, { ...moduleOptions, adapter, research_state: false });
  }
  return runGeant4(native, { ...(options.module_options || {}), research_state: false });
}
