import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateDispatchManifest, lifecycleTransition, overlaps } from '../.codex/skills/team/scripts/dispatch-manifest.mjs';
import { createAgentRun, readAgentRun, updateAgentRun } from '../.codex/skills/team/scripts/agent-run-ledger.mjs';
import { prepareDispatch } from '../.codex/skills/team/scripts/dispatch.mjs';

const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'muion-team-'));
const task = (overrides = {}) => ({ task_id: 'task-' + Math.random().toString(16).slice(2), role: 'executor', summary: 'bounded task', permissions: { read: true, write: true }, ...overrides });

test('independent writers form one ready wave while overlap is rejected for the same wave', () => {
  const a = task({ task_id: 'a', owns: ['src/a/**'] }); const b = task({ task_id: 'b', owns: ['src/b/**'] });
  const independent = validateDispatchManifest({ dispatch_id: 'independent', tasks: [a, b] });
  assert.equal(independent.valid, true); assert.deepEqual(independent.waves[0], ['a', 'b']);
  const overlap = validateDispatchManifest({ dispatch_id: 'overlap', tasks: [a, task({ task_id: 'b', owns: ['src/a/file.js'] })] });
  assert.equal(overlap.valid, true); assert.equal(overlap.waves.length, 2); assert.ok(overlap.warnings.some((item) => item.includes('writer ownership overlap')));
  assert.equal(overlaps(['src/a/**'], ['src/a/file.js']), true);
});

test('mutable read/write and exclusive resource conflicts are serialized; frozen input is safe', () => {
  const writer = task({ task_id: 'writer', owns: ['input.json'], resources: ['comsol-session'] });
  const reader = task({ task_id: 'reader', reads: ['input.json'], resources: ['comsol-session'] });
  const blocked = validateDispatchManifest({ dispatch_id: 'mutable', tasks: [writer, reader] });
  assert.equal(blocked.waves.length, 2); assert.ok(blocked.warnings.some((item) => item.includes('mutable read/write')));
  const frozen = validateDispatchManifest({ dispatch_id: 'frozen', tasks: [writer, { ...reader, frozen_inputs: ['input.json'] }] });
  assert.equal(frozen.waves.length, 2); assert.ok(frozen.warnings.some((item) => item.includes('exclusive resource')));
});

test('dependencies block until completed and ready waves advance by dependency', () => {
  const result = validateDispatchManifest({ dispatch_id: 'deps', tasks: [task({ task_id: 'a' }), task({ task_id: 'b', depends_on: ['a'] })] });
  assert.deepEqual(result.waves, [['a'], ['b']]);
  const unknown = validateDispatchManifest({ dispatch_id: 'bad-dep', tasks: [task({ task_id: 'b', depends_on: ['missing'] })] });
  assert.equal(unknown.valid, false); assert.equal(unknown.statuses.b, 'blocked');
});

test('reviewer, child and worker permissions are enforced', () => {
  const reviewer = validateDispatchManifest({ dispatch_id: 'permissions', tasks: [task({ task_id: 'r', role: 'critic', owns: ['x'], permissions: { read: true, write: true } })] });
  assert.equal(reviewer.valid, false); assert.match(reviewer.errors.join(' '), /read-only/);
  const child = validateDispatchManifest({ dispatch_id: 'child', tasks: [task({ task_id: 'c', parent_id: 'p', permissions: { spawn_child: true } })] });
  assert.equal(child.valid, false); assert.match(child.errors.join(' '), /spawn_child/);
  const worker = validateDispatchManifest({ dispatch_id: 'worker', tasks: [task({ task_id: 'w', permissions: { publish: true } })] });
  assert.equal(worker.valid, false); assert.match(worker.errors.join(' '), /cannot publish/);
});

test('lifecycle transitions and durable agent-run ledger preserve retry/cancel evidence', () => {
  const projectRoot = root(); const t = task({ task_id: 'ledger', permissions: { read: true, write: true }, verification: { command: 'npm test' }, retry: { max: 2 } });
  const run = createAgentRun({ root: projectRoot, task: t, selection: { model_id: 'm', reasoning_effort: 'high', selection_reason: 'test' }, manifest_hash: 'abc' });
  updateAgentRun(projectRoot, run.run_id, 'validated'); updateAgentRun(projectRoot, run.run_id, 'ready'); updateAgentRun(projectRoot, run.run_id, 'running'); updateAgentRun(projectRoot, run.run_id, 'retrying', { failure_reason: 'transient' }); updateAgentRun(projectRoot, run.run_id, 'running'); updateAgentRun(projectRoot, run.run_id, 'cancelled', { unresolved_items: ['manual follow-up'] });
  const saved = readAgentRun(projectRoot, run.run_id); assert.equal(saved.lifecycle_state, 'cancelled'); assert.equal(saved.retry.count, 1); assert.equal(saved.events.length, 7); assert.equal(saved.permissions.publish, false);
  assert.throws(() => lifecycleTransition('succeeded', 'running'), /invalid lifecycle/);
});

test('dispatch preparation records routes and ledger entries without claiming runtime enforcement', () => {
  const projectRoot = root(); const manifest = { dispatch_id: 'prepare', goal: 'test', policy: { max_concurrency: 2 }, tasks: [task({ task_id: 'one', role: 'executor', owns: ['a.js'] })] };
  const catalog = { fetched_at: new Date().toISOString(), stale: false, models: [{ id: 'm', context_window: 10000, efforts: ['high'], input_modalities: ['text'], tools: [], permissions: ['read', 'write'], capabilities: ['execution'] }] };
  const result = prepareDispatch(manifest, { root: projectRoot, catalog });
  assert.equal(result.validation.valid, true); assert.equal(result.routes[0].selection.model_id, 'm'); assert.match(result.execution_boundary, /protocol-only/);
  assert.equal(fs.readdirSync(path.join(projectRoot, '00_project/traceability/agent-runs')).length, 1);
});
