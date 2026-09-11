const terminal = new Set(['closed', 'resolved', 'rebutted']);
export function reviewClosure(feedback = {}) {
  const evidence = Array.isArray(feedback.evidence) && feedback.evidence.length > 0;
  const classified = Boolean(feedback.severity);
  const addressed = Boolean(feedback.fix || feedback.rebuttal);
  const rerun = Boolean(feedback.rerun_validation || feedback.validation);
  const requested = feedback.status === 'requested' || feedback.requested === true;
  const closed = terminal.has(String(feedback.status || '').toLowerCase());
  const missing = []; if (!evidence) missing.push('evidence'); if (!classified) missing.push('severity'); if (!addressed) missing.push('fix_or_rebuttal'); if (!rerun) missing.push('rerun_validation');
  return { requested, closed: closed && missing.length === 0, missing, research_state_unchanged: true };
}
