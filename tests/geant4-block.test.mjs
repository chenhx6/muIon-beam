import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runGeant4, validateTask } from '../07_research_system/blocks/geant4/index.mjs';
import { larmorRadius, validateSmokeResult } from '../07_research_system/blocks/geant4/scripts/validate.mjs';
import { checkRegistry } from '../07_research_system/blocks/3d/regression/check.mjs';

test('G4 task intake keeps geometry explicit and rejects incomplete scope', () => {
  assert.equal(validateTask({ task_id: 'G4-TEST', objective: 'track', geometry: { ref: 'fixture' } }).valid, true);
  assert.equal(validateTask({ task_id: 'G4-TEST', objective: 'track' }).valid, false);
});

test('G4 main entry blocks without an executable and does not fabricate a result', async () => {
  const result = await runGeant4({ task_id: 'G4-NO-EXEC', objective: 'diagnose', geometry: { ref: 'registered-geometry' } }, { run_smoke: false, backend: 'native' });
  assert.equal(result.status, 'blocked');
  assert.equal(result.baseline.reason, 'missing-executable');
  assert.equal(result.validation.status, 'not-yet-validated');
});

test('Larmor helper gives the historical 100 keV muon scale at 1 T', () => {
  const radius = larmorRadius({ kinetic_energy_ev: 100000, magnetic_field_t: 1 });
  assert.ok(radius > 0.014 && radius < 0.017, `radius=${radius}`);
});

test('smoke validation accepts clean geometry and rejects a wrong field scale', () => {
  const clean = validateSmokeResult({ scenario: 'geometry', geant4_version: '11.2.2', navigation_completed: true, overlap_detected: false, expected_overlap: false });
  assert.equal(clean.status, 'passed');
  const wrong = validateSmokeResult({ scenario: 'uniform-magnetic-field', geant4_version: '11.2.2', measured_radius_m: 0.3, analytic_larmor_radius_m: 0.015 });
  assert.equal(wrong.status, 'failed');
});

test('3D regression registry starts explicitly not-yet-validated', () => {
  const result = checkRegistry(path.resolve(import.meta.dirname, '../07_research_system/blocks/3d/regression/registry.yaml'));
  assert.equal(result.status, 'not-yet-validated');
  assert.equal(result.cases, 0);
});
