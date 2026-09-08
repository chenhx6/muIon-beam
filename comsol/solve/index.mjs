import { makeIssue, makeWarning } from '../interface/index.mjs';
import { validateCaseScope } from '../contracts/index.mjs';

function now() { return new Date().toISOString(); }

export function makeCaseSpec({ case_id, parameters = {}, kind = 'baseline', reason = null, discovered_variable = null, probe_only = false } = {}) {
  if (!case_id) throw new Error('case_id is required');
  return { case_id, kind, parameters: { ...parameters }, reason, discovered_variable, probe_only };
}

function unavailableCase(caseSpec, adapter) {
  return {
    case_id: caseSpec.case_id,
    kind: caseSpec.kind,
    parameters: caseSpec.parameters,
    reason: caseSpec.reason,
    discovered_variable: caseSpec.discovered_variable,
    probe_only: caseSpec.probe_only,
    status: 'blocked',
    started_at: now(),
    finished_at: now(),
    adapter: adapter.kind || 'unavailable',
    outputs: {},
    errors: [{ category: 'adapter-unavailable', message: adapter.unavailable_reason || 'No COMSOL adapter is available' }],
    warnings: [makeWarning({ code: 'adapter-unavailable', message: 'No numerical COMSOL result was produced.', case_id: caseSpec.case_id, phase: 'solve' })]
  };
}

export async function executeCase({ adapter, caseSpec, task, model, maxRecoveryAttempts = 0, logger = null } = {}) {
  const scope = task ? validateCaseScope(task, caseSpec) : { valid: true, errors: [] };
  if (!scope.valid) return {
    case_id: caseSpec.case_id,
    kind: caseSpec.kind,
    parameters: caseSpec.parameters,
    reason: caseSpec.reason,
    status: 'blocked',
    started_at: now(),
    finished_at: now(),
    adapter: adapter?.kind || 'unknown',
    outputs: {},
    errors: [{ category: 'scope-violation', message: scope.errors.join('; ') }],
    warnings: [makeWarning({ code: 'scope-violation', message: 'Case was not executed because it attempted to change FIXED or EXTERNAL scope.', case_id: caseSpec.case_id, phase: 'solve' })],
    issues: [makeIssue({ code: 'scope-violation', title: 'Unauthorized case parameters', observation: scope.errors.join('; '), case_id: caseSpec.case_id, affected_scope: ['fixed', 'external'], recommended_action: 'Return the case to Intake and obtain an explicit upstream scope decision.' })]
  };
  if (!adapter?.available || typeof adapter.solveCase !== 'function') return unavailableCase(caseSpec, adapter || { kind: 'unavailable' });
  const startedAt = now();
  let recoveryAttempts = 0;
  let lastError = null;
  while (true) {
    try {
      const value = await adapter.solveCase(caseSpec, { task, model, logger, recovery_attempt: recoveryAttempts });
      const result = value && typeof value === 'object' ? value : { outputs: value };
      return {
        case_id: caseSpec.case_id,
        kind: caseSpec.kind,
        parameters: caseSpec.parameters,
        reason: caseSpec.reason,
        discovered_variable: caseSpec.discovered_variable,
        probe_only: caseSpec.probe_only,
        status: result.status || 'complete',
        started_at: startedAt,
        finished_at: now(),
        adapter: adapter.kind || 'unknown',
        recovery_attempts: recoveryAttempts,
        outputs: result.outputs || {},
        validation: result.validation || {},
        errors: result.errors || [],
        warnings: result.warnings || [],
        raw: result.raw || null
      };
    } catch (error) {
      lastError = error;
      if (recoveryAttempts >= maxRecoveryAttempts || typeof adapter.recoverCase !== 'function') break;
      recoveryAttempts += 1;
      try { await adapter.recoverCase(caseSpec, { error, task, model, logger, recovery_attempt: recoveryAttempts }); }
      catch (recoveryError) { lastError = recoveryError; break; }
    }
  }
  return {
    case_id: caseSpec.case_id,
    kind: caseSpec.kind,
    parameters: caseSpec.parameters,
    reason: caseSpec.reason,
    discovered_variable: caseSpec.discovered_variable,
    probe_only: caseSpec.probe_only,
    status: 'failed',
    started_at: startedAt,
    finished_at: now(),
    adapter: adapter.kind || 'unknown',
    recovery_attempts: recoveryAttempts,
    outputs: {},
    validation: {},
    errors: [{ category: 'solve-exception', message: lastError?.message || 'solveCase failed' }],
    warnings: [makeWarning({ code: 'solve-failed', message: 'Case failed after permitted local recovery attempts.', case_id: caseSpec.case_id, phase: 'solve' })],
    issues: [makeIssue({ code: 'solve-failed', title: 'COMSOL case failed', observation: lastError?.message || 'solveCase failed', case_id: caseSpec.case_id, affected_scope: ['comsol-local'], recommended_action: 'Diagnose solver, mesh, step size and model state before expanding parameters.' })]
  };
}

export async function executeCases({ adapter, cases = [], task, model, maxParallelCases = 1, maxRecoveryAttempts = 0, logger = null } = {}) {
  const requested = Math.max(1, Number.isInteger(maxParallelCases) ? maxParallelCases : 1);
  const adapterParallel = adapter?.capabilities?.parallel_cases !== false;
  const concurrency = adapterParallel ? Math.min(requested, Math.max(1, cases.length || 1)) : 1;
  const results = new Array(cases.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= cases.length) return;
      results[index] = await executeCase({ adapter, caseSpec: cases[index], task, model, maxRecoveryAttempts, logger });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return {
    results,
    execution_record: {
      requested_cases: cases.length,
      requested_concurrency: requested,
      actual_concurrency: concurrency,
      execution_parallelism: 'case-level only',
      research_parallelism: 'not-owned-by-comsol-block',
      resource_awareness: 'task/adaptor resource limits are passed through; global scheduling is out of scope'
    }
  };
}
