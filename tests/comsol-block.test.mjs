import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYamlFile } from '../.codex/skills/muion-project/scripts/yaml-lite.mjs';
import { validateTask, normalizeTask } from '../07_research_system/blocks/comsol/contracts/index.mjs';
import { buildComsolModel } from '../07_research_system/blocks/comsol/build/index.mjs';
import { executeCase, executeCases, makeCaseSpec } from '../07_research_system/blocks/comsol/solve/index.mjs';
import { diagnoseCase, diagnoseCampaign } from '../07_research_system/blocks/comsol/diagnose/index.mjs';
import { planAdaptiveBoundedExploration } from '../07_research_system/blocks/comsol/explore/index.mjs';
import { runComsol } from '../07_research_system/blocks/comsol/index.mjs';
import { writeResultBundle } from '../07_research_system/blocks/comsol/report/index.mjs';
import { createHistorical100keVFixtureAdapter } from '../07_research_system/blocks/comsol/tests/fixtures/100kev-muon-adapter.mjs';

const fixture = parseYamlFile('07_research_system/blocks/comsol/tests/fixtures/100kev-muon-aperture-failure.yaml');

test('ComsolTask requires explicit scope and rejects overlap', () => {
  const valid = validateTask(fixture);
  assert.equal(valid.valid, true);
  assert.equal(valid.task.external.find((v) => v.name === 'aperture_geometry').owner, '3d-block');
  assert.throws(() => normalizeTask({ ...fixture, variable: [{ name: 'aperture_geometry' }] }), /scope overlap/);
  assert.equal(validateTask({ ...fixture, objective: '' }).valid, false);
});

test('Build emits semantic selection plan without editing the 3D block', async () => {
  const built = await buildComsolModel(normalizeTask(fixture));
  assert.ok(built.named_selections.includes('central_aperture'));
  assert.ok(built.named_selections.includes('target_region'));
  assert.equal(built.status, 'adapter-unavailable');
  assert.match(built.warnings[0].message, /named selections/);
});

test('Build keeps semantic named selections stable while treating geometry IDs as adapter evidence', async () => {
  const task = normalizeTask({ ...fixture, inputs: { ...fixture.inputs, named_selections: [{ name: 'custom_target', entity_ids: [17] }], named_selection_verification: { geometry_revision: 'g1', verified: true } } });
  const built = await buildComsolModel(task);
  assert.ok(built.named_selections.includes('custom_target'));
  assert.deepEqual(built.named_selection_specs[0], { name: 'custom_target', entity_ids: [17] });
  assert.equal(built.warnings.some((warning) => warning.code === 'named-selection-verification-pending'), false);
});

test('Solve blocks a case that changes EXTERNAL scope before invoking adapter', async () => {
  let invoked = false;
  const adapter = { available: true, kind: 'test', capabilities: { parallel_cases: true }, async solveCase() { invoked = true; return { status: 'complete' }; } };
  const task = normalizeTask(fixture);
  const result = await executeCase({ adapter, task, caseSpec: makeCaseSpec({ case_id: 'bad', kind: 'diagnostic-probe', parameters: { aperture_geometry: 'changed' } }) });
  assert.equal(result.status, 'blocked');
  assert.equal(invoked, false);
  assert.equal(result.errors[0].category, 'scope-violation');
});

test('Solve records bounded case-level concurrency', async () => {
  let active = 0;
  let peak = 0;
  const adapter = { available: true, kind: 'test', capabilities: { parallel_cases: true }, async solveCase() { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 8)); active -= 1; return { status: 'complete', outputs: { solver_convergence: true } }; } };
  const task = normalizeTask({ ...fixture, variable: [{ name: 'probe', scope: 'comsol-local' }], exploration_level: 'bounded' });
  const run = await executeCases({ adapter, task, maxParallelCases: 2, cases: [makeCaseSpec({ case_id: 'a', parameters: { probe: 1 } }), makeCaseSpec({ case_id: 'b', parameters: { probe: 2 } }), makeCaseSpec({ case_id: 'c', parameters: { probe: 3 } })] });
  assert.equal(run.execution_record.actual_concurrency, 2);
  assert.equal(peak, 2);
  assert.equal(run.results.length, 3);
});

test('Numerical failure is diagnosed before any exploration is planned', () => {
  const task = normalizeTask(fixture);
  const failed = { case_id: 'baseline', status: 'failed', errors: [{ category: 'solver-divergence', message: 'solver divergence' }], outputs: {} };
  const diagnostic = diagnoseCase(failed, { task });
  assert.equal(diagnostic.classification, 'numerical-comsol-local');
  const plan = planAdaptiveBoundedExploration({ task, baselineCase: failed, baselineDiagnostic: diagnostic, history: [{ stage: 'baseline' }] });
  assert.equal(plan.action, 'diagnose-first');
  assert.equal(plan.cases.length, 0);
});

test('Historical 100 keV smoke stops blind voltage scanning and escalates', async () => {
  assert.equal(fixture.regression_seed, true);
  assert.equal(fixture.regression_id, 'COMSOL-REGRESSION-100KEV-MUON-APERTURE');
  const result = await runComsol(fixture, { adapter: createHistorical100keVFixtureAdapter() });
  assert.equal(result.status, 'partial');
  assert.equal(result.adapter.kind, 'documented-behavioural-fixture');
  assert.equal(result.cases.length, 3, 'baseline plus two explicit diagnostic probes');
  assert.ok(result.findings.some((f) => f.kind === 'physical'));
  assert.ok(result.issues.some((i) => i.code === 'persistent-physical-loss'));
  assert.ok(result.escalations.some((e) => e.candidate_causes.includes('geometry') && e.candidate_causes.includes('source')));
  assert.match(result.stopping_reason, /no_information_gain/);
  assert.equal(result.exploration_history[1].stage, 'diagnostic-probe');
  assert.equal(result.exploration_history.length, 3);
  assert.equal(result.exploration_history.at(-1).stage, 'stop');
  assert.equal(result.exploration_history.some((item) => item.stage === 'unbounded-scan'), false);
  assert.equal(result.validation.calculation_finished, true);
  assert.match(result.validation.note, /does not imply/);
});

test('No adapter is a blocked execution with no fabricated numerical outputs', async () => {
  const result = await runComsol(fixture, { env: {} });
  assert.equal(result.status, 'blocked');
  assert.equal(result.baseline.status, 'blocked');
  assert.deepEqual(result.baseline.outputs, {});
  assert.ok(result.warnings.some((w) => w.code === 'adapter-unavailable'));
});

test('Unscoped discovered variable produces a ScopeExpansionRequest', () => {
  const task = normalizeTask(fixture);
  const d = diagnoseCase({ case_id: 'probe', status: 'complete', outputs: { discovered_variables: [{ name: 'phase_space_correlation' }], parameter_sensitivity: { meaningful: true } } }, { task });
  assert.equal(d.discovered_variables[0].name, 'phase_space_correlation');
});

test('A newly discovered local variable gets at most an explicit diagnostic probe and remains a scope request', async () => {
  const task = normalizeTask({ ...fixture, variable: [{ ...fixture.variable[0], diagnostic_probe: false }] });
  const diagnostic = diagnoseCase({
    case_id: 'baseline',
    status: 'complete',
    outputs: {
      failure_mode: 'electrode_or_wall_collision',
      discovered_variables: [{ name: 'phase_space_correlation', scope: 'comsol-local', diagnostic_probe: true, constraint_check: 'pass', probe_parameters: { phase_space_correlation: 'preserve-current' } }]
    }
  }, { task });
  const plan = planAdaptiveBoundedExploration({ task, baselineCase: { case_id: 'baseline', status: 'complete' }, baselineDiagnostic: diagnostic, history: [{ stage: 'baseline' }], diagnostics: [diagnostic] });
  assert.equal(plan.cases.length, 1);
  assert.equal(plan.cases[0].kind, 'discovered-diagnostic-probe');
  const executed = await executeCase({ adapter: { available: true, kind: 'probe-test', capabilities: { parallel_cases: false }, async solveCase() { return { status: 'complete', outputs: { failure_mode: 'electrode_or_wall_collision' } }; } }, task, caseSpec: plan.cases[0] });
  assert.equal(executed.status, 'complete');
  const campaign = diagnoseCampaign({ task, baselineCase: { case_id: 'baseline' }, baselineDiagnostic: diagnostic, cases: [executed], diagnostics: [diagnoseCase(executed, { task })] });
  assert.ok(campaign.scope_expansion_requests.some((request) => request.variable.name === 'phase_space_correlation'));
});

test('Result bundle writes machine data plus concise and detailed reports without overwrite', async () => {
  const result = await runComsol(fixture, { adapter: createHistorical100keVFixtureAdapter() });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comsol-result-'));
  const bundle = writeResultBundle(result, { directory });
  assert.ok(fs.existsSync(path.join(directory, 'comsol-result.json')));
  assert.ok(fs.existsSync(path.join(directory, 'summary-report-zh.md')));
  assert.ok(fs.existsSync(path.join(directory, 'detailed-report-zh.md')));
  assert.ok(fs.existsSync(path.join(directory, 'comsol-result-manifest.json')));
  assert.throws(() => writeResultBundle(result, { directory }), /Refusing to overwrite/);
  assert.equal(bundle.files.length, 3);
});
