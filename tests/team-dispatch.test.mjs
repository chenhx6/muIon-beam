import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateDispatchManifest, lifecycleTransition, overlaps } from '../.codex/skills/team/scripts/dispatch-manifest.mjs';
import { createAgentRun, readAgentRun, updateAgentRun } from '../.codex/skills/team/scripts/agent-run-ledger.mjs';
import { prepareDispatch } from '../.codex/skills/team/scripts/dispatch.mjs';
import { runEvidenceGate, recordEvidenceGate } from '../.codex/skills/team/scripts/evidence-gate.mjs';
import { collectResearchEvidence, writeResearchEvidence } from '../.codex/skills/team/scripts/research-evidence.mjs';
import { summarizeAgentRuns, writeTelemetry } from '../.codex/skills/team/scripts/telemetry.mjs';
import { acquireResourceLocks, inspectResourceLock, releaseResourceLock } from '../.codex/skills/team/scripts/resource-lock.mjs';

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

test('code evidence gate uses executable checks as the oracle and finalizes a running ledger run', () => {
  const projectRoot = root(); const t = task({ task_id: 'gate', verification: { gate_type: 'code', checks: [{ check_id: 'pass', executable: process.execPath, args: ['-e', 'process.exit(0)'] }] } });
  const run = createAgentRun({ root: projectRoot, task: t, selection: { model_id: 'm', reasoning_effort: 'high' } });
  updateAgentRun(projectRoot, run.run_id, 'validated'); updateAgentRun(projectRoot, run.run_id, 'ready'); updateAgentRun(projectRoot, run.run_id, 'running');
  const evidence = runEvidenceGate({ root: projectRoot, verification: t.verification });
  assert.equal(evidence.verdict, 'passed');
  const saved = recordEvidenceGate(projectRoot, run.run_id, evidence);
  assert.equal(saved.lifecycle_state, 'succeeded'); assert.equal(saved.verification.gate, 'passed');
  const failed = runEvidenceGate({ root: projectRoot, verification: { checks: [{ check_id: 'fail', executable: process.execPath, args: ['-e', 'process.exit(2)'] }] } });
  assert.equal(failed.verdict, 'failed');
});

test('research evidence bundle preserves contract evidence and leaves scientific verdict to research-workflow', () => {
  const projectRoot = root(); const contractPath = path.join(projectRoot, 'contract.json'); const sourcePath = path.join(projectRoot, 'source.txt');
  fs.writeFileSync(contractPath, JSON.stringify({ schema_version: '1.0.0', contract_id: 'C-EVIDENCE', task_id: 'T-EVIDENCE', module: 'comsol', objective: 'bounded evidence', inputs: {}, fixed: [], explorable: [], forbidden: [], required_outputs: ['result'], validation_requirements: [] }, null, 2) + '\n'); fs.writeFileSync(sourcePath, 'source evidence\n');
  const evidence = collectResearchEvidence({ root: projectRoot, contract_path: 'contract.json', source_evidence: [{ path: 'source.txt', kind: 'source' }], numerical_comparisons: [{ comparison_id: 'numeric-1', status: 'passed', delta: 0.01 }], physics_reviewers: [{ run_id: 'review-1', evidence: 'independent reasoning', model_family: 'family-a' }], producer_model_family: 'family-a' });
  assert.equal(evidence.status, 'evidence-collected'); assert.equal(evidence.final_verdict, null); assert.equal(evidence.contract.validation.valid, true); assert.equal(evidence.correlated_review_risk, true);
  const file = writeResearchEvidence(projectRoot, evidence); assert.equal(fs.existsSync(file), true);
});

test('local telemetry aggregates ledger observations without inventing provider capacity', () => {
  const projectRoot = root(); const first = createAgentRun({ root: projectRoot, task: task({ task_id: 'telemetry-1', role: 'executor' }), selection: { model_id: 'm1', family: 'family-a', reasoning_effort: 'high', catalog_freshness: 'stale', stale_model_catalog: true } });
  updateAgentRun(projectRoot, first.run_id, 'validated'); updateAgentRun(projectRoot, first.run_id, 'ready'); updateAgentRun(projectRoot, first.run_id, 'running'); updateAgentRun(projectRoot, first.run_id, 'failed', { failure_reason: 'test failure' });
  const second = createAgentRun({ root: projectRoot, task: task({ task_id: 'telemetry-2', role: 'physics-reviewer', permissions: { read: true } }), selection: { model_id: 'm2', family: 'family-b', reasoning_effort: 'xhigh' } });
  const summary = summarizeAgentRuns(projectRoot); assert.equal(summary.window.run_count, 2); assert.equal(summary.failures_by_model.m1, 1); assert.equal(summary.stale_catalog_uses, 1); assert.equal(summary.provider_capacity, 'unknown'); assert.equal(summary.by_model_family['family-a'], 1);
  assert.equal(fs.existsSync(writeTelemetry(projectRoot, summary)), true); assert.ok(second.run_id);
});

test('cooperative resource lock serializes exclusive resources and releases only by owner', () => {
  const projectRoot = root(); const first = acquireResourceLocks(projectRoot, ['comsol-session'], 'run-1'); assert.equal(first.status, 'acquired');
  const blocked = acquireResourceLocks(projectRoot, ['comsol-session'], 'run-2'); assert.equal(blocked.status, 'blocked'); assert.equal(blocked.owner.run_id, 'run-1');
  assert.equal(releaseResourceLock(projectRoot, 'comsol-session', 'run-2').status, 'owner-mismatch'); assert.equal(releaseResourceLock(projectRoot, 'comsol-session', 'run-1').status, 'released');
  const expired = acquireResourceLocks(projectRoot, ['gui'], 'run-old', { now: new Date('2020-01-01T00:00:00Z'), ttlMs: 1 }); assert.equal(expired.status, 'acquired');
  const reclaimed = acquireResourceLocks(projectRoot, ['gui'], 'run-new', { now: new Date('2020-01-02T00:00:00Z') }); assert.equal(reclaimed.status, 'acquired'); assert.equal(inspectResourceLock(projectRoot, 'gui').owner.run_id, 'run-new');
});
