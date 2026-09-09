import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlFile } from '../../../.codex/skills/muion-project/scripts/yaml-lite.mjs';
import { normalizeTask, validateTask } from './contracts/index.mjs';
import { detectComsolAdapter, buildComsolModel } from './build/index.mjs';
import { planAdaptiveBoundedExploration } from './explore/index.mjs';
import { diagnoseCase, diagnoseCampaign, validateCases } from './diagnose/index.mjs';
import { buildComsolResult, renderMarkdownReport, writeResultBundle } from './report/index.mjs';
import { makeWarning } from './interface/index.mjs';
import { executeCases, makeCaseSpec } from './solve/index.mjs';
import { trackExecution } from '../../control/research-state/track.mjs';

function aggregateExecution(records) {
  return records.reduce((acc, value) => ({
    requested_cases: acc.requested_cases + (value.requested_cases || 0),
    requested_concurrency: Math.max(acc.requested_concurrency, value.requested_concurrency || 0),
    actual_concurrency: Math.max(acc.actual_concurrency, value.actual_concurrency || 0),
    execution_parallelism: 'case-level only',
    research_parallelism: 'not-owned-by-comsol-block',
    resource_awareness: 'task/adaptor resource limits are passed through; global scheduling is out of scope'
  }), { requested_cases: 0, requested_concurrency: 0, actual_concurrency: 0, execution_parallelism: 'case-level only', research_parallelism: 'not-owned-by-comsol-block', resource_awareness: 'task/adaptor resource limits are passed through; global scheduling is out of scope' });
}

function uniqueRecords(records, key) {
  const seen = new Set();
  return records.filter((record) => {
    const value = key(record);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export async function runComsol(rawTask, options = {}) {
  const intake = validateTask(rawTask);
  if (!intake.valid) throw new Error(`Invalid ComsolTask: ${intake.errors.join('; ')}`);
  const task = normalizeTask(intake.task);
  const adapter = options.adapter || detectComsolAdapter(options.env || process.env);
  const build = await buildComsolModel(task, { adapter, logger: options.logger });
  const model = build.adapter_result?.model_handle || build.adapter_result || null;
  const buildNotReady = adapter.available && build.status !== 'built' && !task.inputs.previous_model;
  const solveAdapter = buildNotReady ? { ...adapter, available: false, kind: adapter.kind, unavailable_reason: 'Build did not execute and no explicit previous_model was supplied' } : adapter;
  const baselineSpec = options.baseline_case || makeCaseSpec({ case_id: 'baseline', kind: 'baseline', parameters: Object.fromEntries(task.variable.filter((v) => 'current' in v).map((v) => [v.name, v.current])), reason: 'required baseline before exploration' });
  const initialExecution = options.baseline_result ? { results: [options.baseline_result], execution_record: { requested_cases: 1, requested_concurrency: 1, actual_concurrency: 1, execution_parallelism: 'case-level only', research_parallelism: 'not-owned-by-comsol-block', resource_awareness: 'task/adaptor resource limits are passed through; global scheduling is out of scope' } } : await executeCases({ adapter: solveAdapter, cases: [baselineSpec], task, model, maxParallelCases: 1, maxRecoveryAttempts: Number(task.resources.max_recovery_attempts || 0), logger: options.logger });
  const baseline = initialExecution.results[0];
  const baselineDiagnostic = diagnoseCase(baseline, { task });
  const allCases = [baseline];
  const allDiagnostics = [baselineDiagnostic];
  const history = [{ stage: 'baseline', case_ids: [baseline.case_id], tested_variables: Object.keys(baseline.parameters || {}), failure_modes: [baselineDiagnostic.failure_mode].filter(Boolean), sensitivity: baselineDiagnostic.trajectory.parameter_sensitivity, stop_reason: null }];
  const executionRecords = [initialExecution.execution_record];
  const planningIssues = [...(build.issues || [])];
  const planningWarnings = [
    ...(intake.warnings || []).map((message) => makeWarning({ code: 'intake-warning', message, phase: 'intake' })),
    ...(build.warnings || [])
  ];
  const planningEscalations = [];
  const scopeRequests = [];
  let stoppingReason = null;
  const maxRounds = options.max_exploration_rounds == null ? Infinity : Math.max(0, Number(options.max_exploration_rounds));
  let round = 0;
  const seenPlannedCases = new Set();
  let plan = planAdaptiveBoundedExploration({ task, baselineCase: baseline, baselineDiagnostic, cases: [], diagnostics: [baselineDiagnostic], history });
  planningIssues.push(...(plan.issues || []));
  planningWarnings.push(...(plan.warnings || []));
  planningEscalations.push(...(plan.escalations || []));
  while (plan.cases.length && round < maxRounds) {
    const repeated = plan.cases.filter((value) => seenPlannedCases.has(value.case_id));
    if (repeated.length) {
      stoppingReason = `repeated case plan detected (${repeated.map((value) => value.case_id).join(', ')}); stopped to avoid duplicate execution`;
      break;
    }
    for (const value of plan.cases) seenPlannedCases.add(value.case_id);
    round += 1;
    const execution = await executeCases({ adapter: solveAdapter, cases: plan.cases, task, model, maxParallelCases: Number(task.resources.max_parallel_cases || options.max_parallel_cases || 1), maxRecoveryAttempts: Number(task.resources.max_recovery_attempts || 0), logger: options.logger });
    executionRecords.push(execution.execution_record);
    allCases.push(...execution.results);
    const diagnostics = execution.results.map((value) => diagnoseCase(value, { task }));
    allDiagnostics.push(...diagnostics);
    history.push({ stage: plan.stage, case_ids: plan.cases.map((c) => c.case_id), tested_variables: [...new Set(plan.cases.flatMap((c) => Object.keys(c.parameters || {})))], failure_modes: diagnostics.map((d) => d.failure_mode).filter(Boolean), sensitivity: diagnostics.map((d) => d.trajectory.parameter_sensitivity).filter(Boolean), action: plan.action, information_gain: plan.information_gain, stop_reason: null });
    const next = planAdaptiveBoundedExploration({ task, baselineCase: baseline, baselineDiagnostic, cases: allCases.slice(1), diagnostics: allDiagnostics, history });
    planningIssues.push(...(next.issues || []));
    planningWarnings.push(...(next.warnings || []));
    planningEscalations.push(...(next.escalations || []));
    plan = next;
    if (!plan.cases.length) stoppingReason = plan.stop_reason;
  }
  if (!stoppingReason) stoppingReason = plan.stop_reason || (Number.isFinite(maxRounds) && round >= maxRounds ? 'explicit exploration round limit reached' : 'no further cases authorized');
  history.push({ stage: 'stop', case_ids: [], action: plan.action, information_gain: plan.information_gain, stop_reason: stoppingReason });
  const campaign = diagnoseCampaign({ task, baselineCase: baseline, baselineDiagnostic, cases: allCases.slice(1), diagnostics: allDiagnostics });
  planningWarnings.push(...allCases.flatMap((value) => value.warnings || []));
  planningIssues.push(...allCases.flatMap((value) => value.issues || []));
  planningIssues.push(...campaign.issues);
  planningWarnings.push(...campaign.warnings);
  planningEscalations.push(...campaign.escalations);
  scopeRequests.push(...campaign.scope_expansion_requests);
  const validation = validateCases({ task, cases: allCases, diagnostics: allDiagnostics });
  const findings = campaign.findings;
  const warnings = uniqueRecords(planningWarnings, (value) => `${value.code || value.message}:${value.case_id || ''}`);
  const issues = uniqueRecords(planningIssues, (value) => `${value.code || value.title || value.observation}:${value.case_id || ''}`);
  const escalations = uniqueRecords(planningEscalations, (value) => (value.candidate_causes || []).join('|') || value.observation);
  const scopeExpansionRequests = uniqueRecords(scopeRequests, (value) => `${value.variable?.name || value.variable}:${value.reason}`);
  const nextInterfaceRequests = [...issues, ...escalations, ...scopeExpansionRequests];
  const result = buildComsolResult({ task, adapter, build, baseline, cases: allCases, validation, findings, warnings, issues, escalations, scope_expansion_requests: scopeExpansionRequests, exploration_history: history, stopping_reason: stoppingReason, execution_record: aggregateExecution(executionRecords), next_interface_requests: nextInterfaceRequests });
  result.diagnostics = allDiagnostics;
  result.intake = { valid: intake.valid, warnings: intake.warnings };
  result.traceability = task.traceability || null;
  if (options.output_dir) result.output_bundle = writeResultBundle(result, { directory: options.output_dir });
  return result;
}

export async function runComsolTracked(rawTask, options = {}) {
  const tracked = await trackExecution({ root: options.research_state_root || process.cwd(), module: 'comsol', task: rawTask, contextId: options.context_id, execute: () => runComsol(rawTask, { ...options, research_state: false }) });
  return tracked.raw;
}

function readTask(file) {
  const absolute = path.resolve(file);
  return absolute.toLowerCase().endsWith('.json') ? JSON.parse(fs.readFileSync(absolute, 'utf8')) : parseYamlFile(absolute);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const taskFlag = process.argv.indexOf('--task');
  const reportFlag = process.argv.indexOf('--report');
  const outputFlag = process.argv.indexOf('--output-dir');
  if (taskFlag < 0 || !process.argv[taskFlag + 1]) {
    console.error('Usage: node 07_research_system/blocks/comsol/index.mjs --task path/to/task.json [--report path/to/report.md] [--output-dir path]');
    process.exitCode = 2;
  } else {
    const outputDir = outputFlag >= 0 ? process.argv[outputFlag + 1] : null;
    const options = { ...(outputDir ? { output_dir: outputDir } : {}), research_state_root: process.cwd() };
    const runner = process.argv.includes('--no-research-state') ? runComsol : runComsolTracked;
    runner(readTask(process.argv[taskFlag + 1]), options).then((result) => {
      if (reportFlag >= 0 && process.argv[reportFlag + 1]) fs.writeFileSync(path.resolve(process.argv[reportFlag + 1]), renderMarkdownReport(result));
      console.log(JSON.stringify(result, null, 2));
    }).catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
  }
}
