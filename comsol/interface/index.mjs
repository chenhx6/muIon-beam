function id(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

export function makeWarning({ code, message, evidence = [], case_id = null, phase = null, ...extra }) {
  return { type: 'Warning', warning_id: id('WARN'), code, message, evidence, case_id, phase, ...extra };
}

export function makeIssue({ code, title, observation, evidence = [], affected_scope = [], recommended_action = null, case_id = null, ...extra }) {
  return { type: 'Issue', issue_id: id('ISSUE'), code, title, observation, evidence, affected_scope, recommended_action, case_id, ...extra };
}

export function makeEscalationRequest({ observation, evidence = [], tested_hypotheses = [], candidate_causes = [], confidence = 'preliminary', recommended_investigation_directions = [], ...extra }) {
  return {
    type: 'EscalationRequest',
    request_id: id('ESC'),
    observation,
    evidence,
    tested_hypotheses,
    candidate_causes,
    confidence,
    recommended_investigation_directions,
    ...extra
  };
}

export function makeScopeExpansionRequest({ variable, reason, evidence = [], current_scope = 'variable', requested_by = 'comsol-diagnose', ...extra }) {
  return { type: 'ScopeExpansionRequest', request_id: id('SCOPE'), variable, reason, evidence, current_scope, requested_by, ...extra };
}

export function collectInterfaceRequests(result) {
  return [
    ...(result.warnings || []),
    ...(result.issues || []),
    ...(result.escalations || []),
    ...(result.scope_expansion_requests || [])
  ];
}

