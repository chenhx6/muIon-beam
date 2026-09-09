import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlFile } from '../.codex/skills/muion-project/scripts/yaml-lite.mjs';
import { parseArgs } from './scripts/common.mjs';
import { preflight } from './scripts/preflight.mjs';
import { runExecutable } from './scripts/run.mjs';
import { runSmoke } from './scripts/smoke.mjs';
import { validateRunResult } from './scripts/validate.mjs';
import { summarize } from './scripts/summarize.mjs';
import { trackExecution } from '../research-state/track.mjs';

function issue(category, code, message, evidence = [], suggested_next_checks = []) {
  return { issue_id: `G4-ISSUE-${code}`, category, code, observation: message, evidence, candidate_explanations: [], suggested_next_checks, owner: 'research-workflow' };
}

function present(value) {
  return value != null && (typeof value !== 'object' || Object.keys(value).length > 0);
}

function statisticsFor(record) {
  return {
    events: record?.outputs?.events ?? 'not-evaluated',
    uncertainty: record?.outputs?.statistical_uncertainty ?? 'not-evaluated',
    needs_more_events: record?.outputs?.needs_more_events ?? 'not-evaluated'
  };
}

export function validateTask(task) {
  const errors = [];
  if (!task || typeof task !== 'object') errors.push('task must be an object');
  if (!task?.task_id) errors.push('task_id is required');
  if (!task?.objective) errors.push('objective is required');
  if (!task?.geometry?.ref && !task?.geometry?.inline) errors.push('geometry.ref or geometry.inline is required');
  return { valid: errors.length === 0, errors };
}

export async function runGeant4(rawTask, options = {}) {
  const intake = validateTask(rawTask);
  if (!intake.valid) throw new Error(`Invalid G4 Task: ${intake.errors.join('; ')}`);
  const task = structuredClone(rawTask);
  const check = preflight({ project: options.project || process.cwd(), backend: options.backend || task.backend || 'auto', distribution: options.distribution || task.distribution || 'Ubuntu-20.04', env_script: options.env_script || task.env_script || null, geant4_dir: options.geant4_dir || task.geant4_dir || null });
  const setupChecks = [
    { name: 'geometry-reference', status: task.geometry?.ref || task.geometry?.inline ? 'recorded' : 'missing', detail: task.geometry?.ref || 'inline geometry' },
    { name: 'particle-source', status: present(task.source?.particle) || present(task.source?.particle_name) ? 'recorded' : 'not-evaluated', detail: task.source?.particle || task.source?.particle_name || 'task did not name a particle' },
    { name: 'physics-list', status: present(task.physics?.list) || present(task.physics?.physics_list) ? 'recorded' : 'not-evaluated', detail: task.physics?.list || task.physics?.physics_list || 'task did not name a physics list' },
    { name: 'field', status: present(task.fields) || present(task.field) ? 'recorded' : 'not-evaluated', detail: task.fields || task.field || 'no external field declared' }
  ];
  const result = { result_id: `G4-RESULT-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`, task_id: task.task_id, status: 'partial', preflight: check, setup: { geometry: task.geometry, materials: task.materials || [], source: task.source || {}, physics: task.physics || {}, fields: task.fields || {}, run_configuration: task.run || {}, sanity: { status: setupChecks.some((item) => item.status === 'missing') ? 'blocked' : 'recorded', checks: setupChecks } }, smoke: null, baseline: null, diagnostic_runs: [], production: null, scoring: task.scoring || [], statistics: {}, validation: {}, findings: [], warnings: [], issues: [], evidence: [], candidate_explanations: [], suggested_next_checks: [], stopping_reason: null, traceability: task.traceability || null };

  if (options.run_smoke !== false && task.run_smoke !== false) {
    result.smoke = runSmoke({ executable: options.smoke_executable || null, build: options.smoke_build !== false, backend: check.backend, distribution: check.distribution || 'Ubuntu-20.04', env_script: check.runtime.env_script, output_dir: options.smoke_output_dir });
    if (result.smoke.status === 'failed') result.issues.push(issue('g4-local', 'smoke-failed', 'Geant4 smoke validation failed before task execution.', result.smoke.scenarios || [], ['inspect the first failed smoke scenario before changing task parameters']));
    if (result.smoke.status === 'failed') { result.status = 'blocked'; result.stopping_reason = 'smoke-failed-before-baseline'; result.validation = { status: 'not-yet-validated', calculation_finished: false }; return result; }
  }

  const executable = options.executable || task.executable || null;
  const workdir = options.workdir || task.workdir || process.cwd();
  if (!executable) {
    result.baseline = { status: 'blocked', reason: 'missing-executable' };
    result.validation = { status: 'not-yet-validated', calculation_finished: false, note: 'No Geant4 executable was supplied; no numerical result was fabricated.' };
    result.issues.push(issue('g4-local', 'missing-executable', 'No task executable was supplied after smoke setup.', [], ['supply a built Geant4 executable and repeat the baseline run']));
    result.stopping_reason = 'baseline-not-executable';
    result.status = 'blocked';
    return result;
  }

  const runConfig = task.run || {};
  const baselineOutput = options.baseline_output || runConfig.baseline_output || path.join(workdir, 'g4-baseline.json');
  result.baseline = runExecutable({ executable, args: [...(task.arguments || []), '--events', String(runConfig.baseline_events ?? 100), '--output', baselineOutput], cwd: workdir, output: baselineOutput, backend: check.backend, distribution: check.distribution || 'Ubuntu-20.04', env_script: check.runtime.env_script, project: workdir });
  const baselineValidation = validateRunResult(result.baseline);
  result.validation.baseline = baselineValidation;
  result.evidence.push({ stage: 'baseline', result: result.baseline });
  for (const candidate of result.baseline.outputs?.issues || []) {
    if (candidate.category && candidate.category !== 'g4-local') result.issues.push({ ...candidate, owner: 'research-workflow' });
  }

  const diagnosticCases = Array.isArray(task.diagnostic_cases) ? task.diagnostic_cases : [];
  if (result.baseline.status === 'complete') {
    for (const [index, diagnostic] of diagnosticCases.entries()) {
      const output = diagnostic.output || path.join(workdir, `g4-diagnostic-${index + 1}.json`);
      result.diagnostic_runs.push(runExecutable({ executable, args: [...(task.arguments || []), ...(diagnostic.arguments || []), '--events', String(diagnostic.events ?? 10), '--output', output], cwd: workdir, output, backend: check.backend, distribution: check.distribution || 'Ubuntu-20.04', env_script: check.runtime.env_script, project: workdir }));
    }
    if (runConfig.production_events != null && runConfig.production_events > 0) {
      const output = options.production_output || runConfig.production_output || path.join(workdir, 'g4-production.json');
      result.production = runExecutable({ executable, args: [...(task.arguments || []), '--events', String(runConfig.production_events), '--output', output], cwd: workdir, output, backend: check.backend, distribution: check.distribution || 'Ubuntu-20.04', env_script: check.runtime.env_script, project: workdir });
    }
  } else {
    result.issues.push(issue('g4-local', 'baseline-failed', 'Baseline execution failed; production was not started.', [result.baseline.command], ['diagnose the recorded Geant4 error before increasing event count or scanning parameters']));
    result.stopping_reason = 'baseline-failed-before-production';
  }
  result.statistics = { requested_events: { baseline: runConfig.baseline_events ?? 100, diagnostic: diagnosticCases.map((item) => item.events ?? 10), production: runConfig.production_events ?? null }, observed: { baseline: statisticsFor(result.baseline), diagnostic: result.diagnostic_runs.map(statisticsFor), production: statisticsFor(result.production) }, event_increase_reason: null, convergence: 'not-evaluated' };
  result.status = result.baseline.status === 'complete' && (!result.production || result.production.status === 'complete') ? 'complete' : 'partial';
  result.validation.calculation_finished = result.status === 'complete';
  result.validation.note = 'Calculation completion does not by itself establish physical validity.';
  result.suggested_next_checks.push('review geometry and source ownership before escalating a cross-module loss');
  if (options.output_dir) result.output_bundle = summarize(result, { output_dir: options.output_dir });
  return result;
}

export async function runGeant4Tracked(rawTask, options = {}) {
  const tracked = await trackExecution({ root: options.research_state_root || process.cwd(), module: 'geant4', task: rawTask, contextId: options.context_id, execute: () => runGeant4(rawTask, { ...options, research_state: false }) });
  return tracked.raw;
}

function readTask(file) { const target = path.resolve(file); return target.toLowerCase().endsWith('.json') ? JSON.parse(fs.readFileSync(target, 'utf8')) : parseYamlFile(target); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.task) { console.error('Usage: node geant4/index.mjs --task path/to/task.yaml [--output-dir path]'); process.exitCode = 2; }
  else {
    const options = { output_dir: args.output_dir ? path.resolve(args.output_dir) : null, workdir: args.workdir ? path.resolve(args.workdir) : undefined, backend: args.backend || 'auto', distribution: args.distribution || 'Ubuntu-20.04', env_script: args.env_script || null, executable: args.executable || null, research_state_root: process.cwd() };
    const runner = process.argv.includes('--no-research-state') ? runGeant4 : runGeant4Tracked;
    runner(readTask(args.task), options).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
  }
}
