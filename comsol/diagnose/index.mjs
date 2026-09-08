import { makeEscalationRequest, makeIssue, makeScopeExpansionRequest, makeWarning } from '../interface/index.mjs';

const NUMERICAL_PATTERN = /(diverg|singular|mesh|element|step size|converg|numerical|instab|nonlinear solver|bad element)/i;
const PHYSICAL_PATTERN = /(collision|impact|wall|electrode|aperture|unreachable|transmission|trajectory|loss|clearance|gyro|orbit)/i;

function output(caseResult, key) { return caseResult?.outputs?.[key] ?? caseResult?.[key]; }
function list(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }

export function diagnoseCase(caseResult, { task = null } = {}) {
  const errors = list(caseResult.errors);
  const warnings = list(caseResult.warnings);
  const text = [...errors, ...warnings].map((v) => typeof v === 'string' ? v : `${v.category || ''} ${v.message || ''}`).join(' ');
  const convergence = output(caseResult, 'solver_convergence');
  const failureMode = output(caseResult, 'failure_mode') || output(caseResult, 'loss_mode') || null;
  const physicalEvidence = list(output(caseResult, 'physical_evidence'));
  const numericalEvidence = list(output(caseResult, 'numerical_evidence'));
  const numerical = convergence === false || errors.some((e) => NUMERICAL_PATTERN.test(`${e.category || ''} ${e.message || e}`)) || NUMERICAL_PATTERN.test(text) || numericalEvidence.length > 0;
  const physical = Boolean(failureMode || physicalEvidence.length || output(caseResult, 'collision_coordinates') || output(caseResult, 'loss_location') || output(caseResult, 'transmission_fraction') === 0 || PHYSICAL_PATTERN.test(text));
  let classification = 'unknown';
  if (caseResult.status === 'blocked' && errors.some((e) => ['adapter-unavailable', 'scope-violation'].includes(e.category))) classification = 'execution-blocked';
  else if (numerical && physical) classification = 'mixed';
  else if (numerical) classification = 'numerical-comsol-local';
  else if (physical) classification = 'physical-model';
  else if (caseResult.status === 'complete') classification = 'completed-no-failure-signal';
  else if (caseResult.status === 'blocked') classification = 'execution-blocked';
  const findings = [];
  if (classification === 'numerical-comsol-local' || classification === 'mixed') findings.push({ kind: 'numerical', statement: 'The case contains a COMSOL-local numerical failure signal.', evidence: numericalEvidence.length ? numericalEvidence : errors });
  if (classification === 'physical-model' || classification === 'mixed') findings.push({ kind: 'physical', statement: failureMode ? `Observed failure mode: ${failureMode}.` : 'A physical loss or reachability signal was observed.', evidence: physicalEvidence.length ? physicalEvidence : [failureMode, output(caseResult, 'collision_coordinates'), output(caseResult, 'loss_location')].filter(Boolean) });
  const discovered = list(output(caseResult, 'discovered_variables'));
  const candidates = list(output(caseResult, 'candidate_causes'));
  const trajectory = {
    trajectory_envelope: output(caseResult, 'trajectory_envelope') ?? null,
    collision_coordinates: output(caseResult, 'collision_coordinates') ?? null,
    wall_clearance: output(caseResult, 'wall_clearance') ?? null,
    aperture_clearance: output(caseResult, 'aperture_clearance') ?? null,
    field_topology: output(caseResult, 'field_topology') ?? null,
    parameter_sensitivity: output(caseResult, 'parameter_sensitivity') ?? null,
    loss_location: output(caseResult, 'loss_location') ?? null,
    time_evolution: output(caseResult, 'time_evolution') ?? null
  };
  const warningsOut = [];
  if (caseResult.status === 'complete' && !convergence) warningsOut.push(makeWarning({ code: 'convergence-not-recorded', message: 'The adapter did not record solver convergence; completion alone is not validation.', case_id: caseResult.case_id, phase: 'diagnose' }));
  return {
    case_id: caseResult.case_id,
    classification,
    failure_mode: failureMode,
    solver_convergence: convergence ?? 'not-evaluated',
    findings,
    trajectory,
    candidate_causes: candidates,
    discovered_variables: discovered,
    warnings: warningsOut,
    success_criteria: output(caseResult, 'success_criteria') || null,
    task_objective: task?.objective || null
  };
}

function numeric(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

function successMet(value) {
  if (value === true) return true;
  if (!Array.isArray(value) || !value.length) return false;
  return value.every((entry) => entry === true || entry?.passed === true || entry?.value === true);
}

export function compareDiagnostics(baselineDiagnostic, diagnostics, baselineCase, cases) {
  const baselineFailure = baselineDiagnostic?.failure_mode || null;
  const all = diagnostics.filter(Boolean);
  const objectiveImproved = all.some((d) => d.case_id !== baselineDiagnostic?.case_id && successMet(d.success_criteria)) || cases.some((c) => c.outputs?.objective_improved === true);
  const changedFailure = all.some((d) => d.case_id !== baselineDiagnostic?.case_id && d.failure_mode && d.failure_mode !== baselineFailure);
  const baselineScore = numeric(baselineCase?.outputs?.objective_score);
  const improvedScore = cases.some((c) => c.case_id !== baselineCase?.case_id && baselineScore != null && numeric(c.outputs?.objective_score) != null && c.outputs.objective_score > baselineScore);
  const sensitivityMeaningful = cases.some((c) => c.outputs?.sensitivity_meaningful === true) || diagnostics.some((d) => d.trajectory?.parameter_sensitivity?.meaningful === true);
  const physical = all.filter((d) => d.classification === 'physical-model' || d.classification === 'mixed');
  const sameFailureMechanism = physical.length > 1 && physical.every((d) => d.failure_mode === baselineFailure);
  return { objective_improved: objectiveImproved || improvedScore, failure_mode_changed: changedFailure, sensitivity_meaningful: sensitivityMeaningful, same_failure_mechanism: sameFailureMechanism, information_gain: objectiveImproved || improvedScore || changedFailure || sensitivityMeaningful };
}

export function diagnoseCampaign({ task, baselineCase, baselineDiagnostic, cases = [], diagnostics = [] } = {}) {
  const comparison = compareDiagnostics(baselineDiagnostic, diagnostics, baselineCase, cases);
  const all = [baselineDiagnostic, ...diagnostics].filter(Boolean);
  const findings = all.flatMap((d) => d.findings || []);
  const warnings = all.flatMap((d) => d.warnings || []);
  const persistentPhysical = comparison.same_failure_mechanism && !comparison.information_gain;
  const issues = [];
  const escalations = [];
  const scopeRequests = [];
  for (const diagnostic of all) {
    for (const variable of diagnostic.discovered_variables || []) scopeRequests.push(makeScopeExpansionRequest({ variable, reason: 'A diagnostic observed a potentially important unscoped COMSOL-local variable.', evidence: diagnostic.trajectory.parameter_sensitivity ? [diagnostic.trajectory.parameter_sensitivity] : [], current_scope: 'unlisted' }));
  }
  if (persistentPhysical) {
    issues.push(makeIssue({
      code: 'persistent-physical-loss',
      title: 'Failure mechanism remained unchanged after bounded diagnostic probes',
      observation: 'The particle continues to be lost with no demonstrated information gain from the authorized probe.',
      evidence: all.map((d) => ({ case_id: d.case_id, failure_mode: d.failure_mode, classification: d.classification })),
      affected_scope: ['geometry', 'source', 'initial-state', 'field-configuration'],
      recommended_action: 'Escalate to Research Workflow for cross-module selection of the next investigation.'
    }));
    escalations.push(makeEscalationRequest({
      observation: 'The target region remains unreachable under the current model assumptions and the tested COMSOL-local variation did not change the loss mechanism.',
      evidence: all.map((d) => ({ case_id: d.case_id, failure_mode: d.failure_mode, trajectory: d.trajectory })),
      tested_hypotheses: cases.map((c) => ({ case_id: c.case_id, parameters: c.parameters, result: c.outputs?.failure_mode || c.outputs?.transmission_fraction })),
      candidate_causes: ['geometry', 'source', 'initial_state', 'field_configuration'],
      confidence: 'preliminary',
      recommended_investigation_directions: ['review aperture and wall clearance against orbit scale', 'review source position and injection phase/angle', 'review whether the initial state is representative of the upstream handoff', 'review field topology before changing the formal geometry']
    }));
  }
  return { comparison, findings, warnings, issues, escalations, scope_expansion_requests: scopeRequests, persistent_physical_failure: persistentPhysical };
}

export function validateCases({ task, cases = [], diagnostics = [] } = {}) {
  const byId = new Map(diagnostics.map((d) => [d.case_id, d]));
  const perCase = cases.map((c) => {
    const d = byId.get(c.case_id);
    return {
      case_id: c.case_id,
      calculation_finished: c.status === 'complete',
      solver_convergence: c.validation?.solver_convergence ?? d?.solver_convergence ?? 'not-evaluated',
      mesh_dependence: c.validation?.mesh_dependence ?? 'not-evaluated',
      time_step_dependence: c.validation?.time_step_dependence ?? 'not-evaluated',
      numerical_stability: c.validation?.numerical_stability ?? 'not-evaluated',
      sanity_checks: c.validation?.sanity_checks ?? [],
      success_criteria: c.outputs?.success_criteria ?? d?.success_criteria ?? 'not-evaluated',
      success_met: successMet(c.outputs?.success_criteria ?? d?.success_criteria)
    };
  });
  const complete = perCase.length > 0 && perCase.every((v) => v.calculation_finished);
  const explicitValidation = perCase.length > 0 && perCase.every((v) => v.solver_convergence !== 'not-evaluated' && v.numerical_stability !== 'not-evaluated');
  return { calculation_finished: complete, validation_status: explicitValidation ? 'recorded' : 'incomplete', solver_convergence: perCase.map((v) => ({ case_id: v.case_id, value: v.solver_convergence })), mesh_dependence: perCase.map((v) => ({ case_id: v.case_id, value: v.mesh_dependence })), time_step_dependence: perCase.map((v) => ({ case_id: v.case_id, value: v.time_step_dependence })), numerical_stability: perCase.map((v) => ({ case_id: v.case_id, value: v.numerical_stability })), sanity_checks: perCase.flatMap((v) => v.sanity_checks), success_criteria: perCase.map((v) => ({ case_id: v.case_id, value: v.success_criteria, passed: v.success_met })), per_case: perCase, note: 'Calculation finished does not imply physics validated.' };
}
