import test from 'node:test';
import assert from 'node:assert/strict';
import { run3d, validateGeometryTask } from '../index.mjs';

test('3D Block defaults accepted geometry work to G1', () => {
  const result = run3d({ mode: 'create' }, { dryRun: true });
  assert.equal(result.status, 'dry-run');
  assert.equal(result.geometry_level, 'G1');
  assert.equal(result.entrypoint, '3d/create');
});

test('3D Block keeps cross-module simulation fields outside its ownership', () => {
  const result = validateGeometryTask({ mode: 'inspect', comsol: { model: 'x' } });
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /cross-module/);
});

test('3D Block accepts each independent operation mode', () => {
  for (const mode of ['create', 'modify', 'inspect', 'export']) assert.equal(validateGeometryTask({ mode }).valid, true);
});
