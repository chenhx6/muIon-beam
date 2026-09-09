import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYamlFile } from '../.codex/skills/muion-project/scripts/yaml-lite.mjs';
import { beginContext, closeContext, ensureInitialized, readState, recordDiagnosis, recordValidation, renderChatStatus } from '../07_research_system/control/research-state/index.mjs';
import { dispatchContract, executeContract, validateResearchContract } from '../07_research_system/control/research-workflow/index.mjs';
import { freezeContract } from '../07_research_system/control/research-workflow/scripts/contracts.mjs';
import { createHistorical100keVFixtureAdapter } from '../07_research_system/blocks/comsol/tests/fixtures/100kev-muon-adapter.mjs';

function tempRoot(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `muion-${name}-`)); }
function contract(overrides = {}) {
  return { module: 'comsol', objective: 'test objective', inputs: { geometry: { ref: 'fixture' } }, assumptions: [{ statement: 'test assumption' }], fixed: [{ name: 'magnetic_field', value: '1 T', owner: 'research-workflow' }], explorable: [{ name: 'electrode_voltage', owner: 'comsol', allowed_values: ['-1 kV', '1 kV'] }], forbidden: [{ name: 'aperture_geometry', owner: '3d' }], required_outputs: ['validation'], validation_requirements: ['solver_convergence'], ...overrides };
}

test('contract permission sets are disjoint and bounded', () => {
  const valid = validateResearchContract(contract());
  assert.equal(valid.valid, true, valid.errors?.join('; '));
  const overlap = validateResearchContract(contract({ forbidden: [{ name: 'magnetic_field', owner: 'research-workflow' }] }));
  assert.equal(overlap.valid, false);
  const unbounded = validateResearchContract(contract({ explorable: [{ name: 'voltage', owner: 'comsol' }] }));
  assert.equal(unbounded.valid, false);
});

test('state creates one context and append-only prepare/commit events', () => {
  const root = tempRoot('state'); ensureInitialized(root);
  const context = beginContext({ root, entrypoint: 'validation', context_kind: 'validation', objective: 'validate result' });
  recordValidation(context.context_id, { status: 'partial' }, root);
  recordDiagnosis(context.context_id, { next_action: 'new-contract' }, root);
  closeContext(context.context_id, 'PARTIAL', root);
  const state = readState(root);
  assert.equal(state.task_status, 'IDLE');
  assert.match(renderChatStatus(root), /IDLE/);
  const lines = fs.readFileSync(path.join(root, '07_research_system/control/research-state/events.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  assert.ok(lines.some((line) => line.event_phase === 'prepare'));
  assert.ok(lines.some((line) => line.event_phase === 'commit'));
});

test('contract instance is frozen and cannot be overwritten', () => {
  const root = tempRoot('contract'); const value = contract({ contract_id: 'CONTRACT-TEST-FROZEN', task_id: 'TASK-TEST-FROZEN' });
  const first = freezeContract(value, { root });
  assert.ok(fs.existsSync(path.join(root, first.path)));
  assert.throws(() => freezeContract(value, { root }), /EEXIST|exists/);
});

test('contract identifiers cannot escape the canonical instance directory', () => {
  assert.throws(() => freezeContract(contract({ contract_id: '../escape' }), { root: tempRoot('unsafe-contract') }), /unsafe path characters/);
});

test('workflow executes a bounded COMSOL fixture and writes a control report', async () => {
  const root = tempRoot('workflow');
  const fixture = parseYamlFile('07_research_system/blocks/comsol/tests/fixtures/100kev-muon-aperture-failure.yaml');
  const result = await executeContract(contract({ inputs: fixture.inputs, assumptions: fixture.assumptions, fixed: fixture.fixed, explorable: fixture.variable.map((v) => ({ ...v, owner: 'comsol', allowed_values: v.diagnostic_probe_values })), forbidden: fixture.external, success_criteria: fixture.success_criteria, required_outputs: fixture.required_outputs, execution_policy: { exploration_level: fixture.exploration_level } }), { root, module_options: { adapter: createHistorical100keVFixtureAdapter() } });
  assert.equal(result.report.status, 'PARTIAL');
  assert.ok(fs.existsSync(path.join(root, result.files.report_path)));
  assert.equal(readState(root).task_status, 'IDLE');
});

test('COMSOL adapter guard blocks a case outside explorable scope before adapter execution', async () => {
  const root = tempRoot('scope-guard'); let calls = 0;
  const adapter = { kind: 'scope-test', available: true, capabilities: { parallel_cases: false }, async build() { return { model_handle: {} }; }, async solveCase() { calls += 1; return { status: 'complete', outputs: { solver_convergence: true } }; } };
  const result = await executeContract(contract({ inputs: { geometry: { ref: 'fixture' }, diagnostic_cases: [{ case_id: 'unauthorized', parameters: { forbidden_voltage: 9 } }] }, explorable: [{ name: 'allowed_voltage', owner: 'comsol', allowed_values: [1] }] }), { root, module_options: { adapter } });
  assert.equal(calls, 1, 'only the baseline reached the adapter');
  assert.ok(result.report.issues.some((item) => item.code === 'scope-violation'));
});

test('direct 3D entrypoint records research-state without workflow', async () => {
  const root = tempRoot('3d');
  const { run3dTracked } = await import('../07_research_system/blocks/3d/index.mjs');
  const result = await run3dTracked({ task_id: 'NATIVE-3D-TEST', mode: 'inspect', geometry_level: 'G1' }, { research_state_root: root, dryRun: true });
  assert.equal(result.status, 'dry-run');
  assert.equal(readState(root).task_status, 'IDLE');
  assert.match(fs.readFileSync(path.join(root, '07_research_system/control/research-state/events.jsonl'), 'utf8'), /module-result/);
});

test('direct COMSOL and Geant4 entrypoints share the state boundary', async () => {
  const comsolRoot = tempRoot('direct-comsol');
  const fixture = parseYamlFile('07_research_system/blocks/comsol/tests/fixtures/100kev-muon-aperture-failure.yaml');
  const { runComsolTracked } = await import('../07_research_system/blocks/comsol/index.mjs');
  const comsol = await runComsolTracked(fixture, { research_state_root: comsolRoot, adapter: createHistorical100keVFixtureAdapter() });
  assert.equal(comsol.status, 'partial');
  assert.equal(readState(comsolRoot).task_status, 'IDLE');
  assert.ok(fs.existsSync(path.join(comsolRoot, '07_research_system/control/contracts/instances')));

  const g4Root = tempRoot('direct-g4');
  const { runGeant4Tracked } = await import('../07_research_system/blocks/geant4/index.mjs');
  const g4 = await runGeant4Tracked({ task_id: 'NATIVE-G4-TEST', objective: 'track', geometry: { ref: 'fixture' } }, { research_state_root: g4Root, run_smoke: false, backend: 'native' });
  assert.equal(g4.status, 'blocked');
  assert.equal(readState(g4Root).task_status, 'IDLE');
});

test('invalid event log fails closed', () => {
  const root = tempRoot('bad-events'); ensureInitialized(root);
  fs.writeFileSync(path.join(root, '07_research_system/control/research-state/events.jsonl'), '{bad json}\n');
  assert.throws(() => readState(root), /invalid JSON/);
});

test('active state lock blocks a competing foreground context', () => {
  const root = tempRoot('lock'); ensureInitialized(root);
  const lockPath = path.join(root, '_work/current/research-state/state.lock'); fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ lock_token: 'held', pid: process.pid, acquired_at: new Date().toISOString() }));
  assert.throws(() => beginContext({ root, objective: 'competing task' }), /lock contention/);
});

test('workflow rejects a conflicting context before freezing a contract', () => {
  const root = tempRoot('dispatch-conflict');
  const active = beginContext({ root, entrypoint: 'existing', context_kind: 'workflow', objective: 'existing task' });
  assert.throws(() => dispatchContract(contract(), { root }), /foreground context already running/);
  const instances = path.join(root, '07_research_system/control/contracts/instances');
  assert.equal(fs.existsSync(instances) && fs.readdirSync(instances).length > 0, false);
  closeContext(active.context_id, 'PARTIAL', root);
});
