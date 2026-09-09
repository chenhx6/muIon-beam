import { isInternalVariable } from '../contracts/index.mjs';
import { makeEscalationRequest, makeIssue, makeWarning } from '../interface/index.mjs';
import { makeCaseSpec } from '../solve/index.mjs';

function successMet(value) { return value === true || (Array.isArray(value) && value.length > 0 && value.every((entry) => entry === true || entry?.passed === true || entry?.value === true)); }

function explicitCases(task, field, already) {
  const seen = new Set(already.map((c) => c.case_id));
  return (task[field] || []).filter((c) => c && c.case_id && !seen.has(c.case_id)).map((c) => makeCaseSpec({ case_id: c.case_id, kind: c.kind || (field === 'diagnostic_cases' ? 'diagnostic-probe' : 'coarse-exploration'), parameters: c.parameters || {}, reason: c.reason || `explicit ${field}` }));
}

function variableProbeCases(task, already) {
  const seen = new Set(already.map((c) => c.case_id));
  const result = [];
  for (const variable of task.variable) {
    if (!isInternalVariable(task, variable) || variable.diagnostic_probe !== true) continue;
    const values = Array.isArray(variable.diagnostic_probe_values) ? variable.diagnostic_probe_values : [];
    for (const [index, value] of values.entries()) {
      const caseId = `probe-${variable.name}-${index + 1}`.replace(/[^A-Za-z0-9_-]/g, '_');
      if (!seen.has(caseId)) result.push(makeCaseSpec({ case_id: caseId, kind: 'diagnostic-probe', parameters: { [variable.name]: value }, reason: `small diagnostic probe for authorized COMSOL-local variable ${variable.name}` }));
    }
  }
  return result;
}

function discoveredProbeCases(task, diagnostics, already) {
  const seen = new Set(already.map((c) => c.case_id));
  const result = [];
  for (const diagnostic of diagnostics) {
    for (const discovered of diagnostic.discovered_variables || []) {
      if (!discovered || typeof discovered !== 'object' || !discovered.name || !isInternalVariable(task, discovered)) continue;
      if (discovered.diagnostic_probe !== true || discovered.constraint_check !== 'pass' || !discovered.probe_parameters || typeof discovered.probe_parameters !== 'object') continue;
      const caseId = `discovered-probe-${discovered.name}`.replace(/[^A-Za-z0-9_-]/g, '_');
      if (seen.has(caseId)) continue;
      seen.add(caseId);
      result.push(makeCaseSpec({ case_id: caseId, kind: 'discovered-diagnostic-probe', parameters: discovered.probe_parameters, discovered_variable: discovered, probe_only: true, reason: `single diagnostic probe for newly observed COMSOL-local variable ${discovered.name}` }));
    }
  }
  return result;
}

export function planAdaptiveBoundedExploration({ task, baselineCase, baselineDiagnostic, cases = [], diagnostics = [], history = [] } = {}) {
  if (task.exploration_level === 'none') return { action: 'stop', stage: 'disabled', cases: [], stop_reason: 'exploration_level=none', information_gain: false, issues: [], warnings: [] };
  if (baselineDiagnostic?.classification === 'numerical-comsol-local' || baselineCase?.status === 'failed') return {
    action: 'diagnose-first', stage: 'numerical-diagnosis', cases: [], stop_reason: 'baseline has a numerical/COMSOL-local failure; repair or understand it before scanning', information_gain: false,
    issues: [makeIssue({ code: 'diagnose-before-scan', title: 'Numerical failure must be diagnosed before exploration', observation: 'The baseline cannot support a meaningful parameter comparison.', evidence: baselineDiagnostic?.findings || baselineCase?.errors || [], affected_scope: ['comsol-local'], recommended_action: 'Inspect solver convergence, mesh, singularities and time-step settings.' })], warnings: []
  };
  const already = [...cases];
  if (!history.length || history.every((h) => h.stage === 'baseline')) {
    const probes = [...explicitCases(task, 'diagnostic_cases', already), ...variableProbeCases(task, already), ...discoveredProbeCases(task, diagnostics, already)];
    if (probes.length) return { action: 'diagnostic-probe', stage: 'diagnostic-probe', cases: probes, stop_reason: null, information_gain: null, issues: [], warnings: [] };
  }
  const campaign = diagnostics.length > 1 ? diagnostics : [baselineDiagnostic];
  const comparison = campaign.length > 1 ? {
    objective_improved: campaign.some((d) => successMet(d.success_criteria)),
    failure_mode_changed: new Set(campaign.map((d) => d.failure_mode).filter(Boolean)).size > 1,
    sensitivity_meaningful: campaign.some((d) => d.trajectory?.parameter_sensitivity?.meaningful === true),
    same_failure_mechanism: campaign.filter((d) => d.failure_mode).length > 1 && new Set(campaign.map((d) => d.failure_mode).filter(Boolean)).size === 1
  } : { objective_improved: false, failure_mode_changed: false, sensitivity_meaningful: false, same_failure_mechanism: false };
  const informationGain = comparison.objective_improved || comparison.failure_mode_changed || comparison.sensitivity_meaningful;
  if (informationGain) {
    const coarse = explicitCases(task, 'exploration_cases', already);
    if (coarse.length) return { action: 'coarse-exploration', stage: 'coarse-exploration', cases: coarse, stop_reason: null, information_gain: true, issues: [], warnings: [] };
    return { action: 'stop', stage: 'bounded-exploration', cases: [], stop_reason: 'evidence changed the outcome, but no additional explicit candidate cases were authorized', information_gain: true, issues: [], warnings: [makeWarning({ code: 'no-more-explicit-cases', message: 'Exploration stopped because no additional task-authorized cases were supplied.', phase: 'explore' })] };
  }
  const physical = diagnostics.some((d) => d.classification === 'physical-model' || d.classification === 'mixed');
  const escalation = physical ? makeEscalationRequest({
    observation: 'No tested COMSOL-local variation produced objective improvement, a changed failure mechanism or meaningful sensitivity.',
    evidence: diagnostics.map((d) => ({ case_id: d.case_id, failure_mode: d.failure_mode, classification: d.classification })),
    tested_hypotheses: cases.map((c) => ({ case_id: c.case_id, parameters: c.parameters })),
    candidate_causes: ['geometry', 'source', 'initial_state', 'field_configuration'],
    confidence: 'preliminary',
    recommended_investigation_directions: ['inspect trajectory and clearance evidence', 'review source and initial-state assumptions', 'ask Research Workflow to select a cross-module investigation']
  }) : null;
  return {
    action: 'stop',
    stage: 'diagnostic-stop',
    cases: [],
    stop_reason: physical ? 'no_information_gain_same_failure_mechanism; stopped before blind scan' : 'no_information_gain; no basis for expanding exploration',
    information_gain: false,
    issues: physical ? [makeIssue({ code: 'no-information-gain', title: 'Bounded exploration stopped', observation: 'The failure mechanism did not change under authorized probes.', evidence: diagnostics, affected_scope: ['geometry', 'source', 'initial-state', 'field-configuration'], recommended_action: 'Return the escalation to Research Workflow.' })] : [],
    warnings: physical ? [] : [makeWarning({ code: 'exploration-stopped', message: 'No evidence justified broader exploration.', phase: 'explore' })],
    escalations: escalation ? [escalation] : []
  };
}
