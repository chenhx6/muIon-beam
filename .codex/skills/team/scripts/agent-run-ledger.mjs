import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { lifecycleTransition } from './dispatch-manifest.mjs';

function safeId(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(value || ''))) throw new Error(`unsafe ${label}`);
  return String(value);
}

function ledgerDir(root) { return path.join(root, '00_project', 'traceability', 'agent-runs'); }
function fileFor(root, runId) { return path.join(ledgerDir(root), `${safeId(runId, 'run_id')}.json`); }

export function makeRunId(taskId, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `AGENT-${safeId(taskId, 'task_id')}-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

export function createAgentRun({ root = process.cwd(), run_id, parent_id = null, task, selection = null, manifest_hash = null, input_hash = null, now = new Date() }) {
  const runId = run_id || makeRunId(task.task_id, now);
  const permissions = task.permissions || { read: true, write: false, publish: false, spawn_child: false };
  const record = {
    schema_version: 1,
    run_id: runId,
    parent_id,
    task_id: task.task_id,
    role: task.role,
    lifecycle_state: 'planned',
    selected_model: selection?.model_id || null,
    reasoning: selection?.reasoning_effort || task.reasoning || null,
    backend: selection?.backend || selection?.provider || null,
    capability_requirements: { context: task.required_context || 0, modalities: task.required_modalities || [], tools: task.required_tools || [], backend: task.required_backend || null },
    candidates_considered: selection?.candidates_considered || [],
    selection_reason: selection?.selection_reason || null,
    catalog_freshness: selection?.catalog_freshness || null,
    permissions: { read: Boolean(permissions.read !== false), write: Boolean(permissions.write), publish: Boolean(permissions.publish), spawn_child: Boolean(permissions.spawn_child) },
    dependencies: task.depends_on || [],
    resources: task.resources || [],
    manifest_hash,
    input_hash,
    start_time: null,
    end_time: null,
    output_reference: null,
    changed_paths: [],
    verification: task.verification || {},
    tests: [],
    failure_reason: null,
    retry: { count: 0, max: task.retry?.max ?? 1, previous_run_ids: [] },
    unresolved_items: [],
    events: [{ at: now.toISOString(), from: null, to: 'planned', reason: 'run created' }]
  };
  writeAgentRun(root, record); return record;
}

export function writeAgentRun(root, record) {
  const file = fileFor(root, record.run_id); fs.mkdirSync(ledgerDir(root), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`; fs.writeFileSync(temp, JSON.stringify(record, null, 2) + '\n'); fs.renameSync(temp, file); return file;
}

export function readAgentRun(root, runId) { return JSON.parse(fs.readFileSync(fileFor(root, runId), 'utf8')); }

export function updateAgentRun(root, runId, next, patch = {}, now = new Date()) {
  const record = readAgentRun(root, runId); const previous = record.lifecycle_state; lifecycleTransition(previous, next);
  Object.assign(record, patch, { lifecycle_state: next });
  if (next === 'running' && !record.start_time) record.start_time = now.toISOString();
  if (['succeeded', 'failed', 'cancelled', 'blocked'].includes(next)) record.end_time = now.toISOString();
  if (next === 'retrying') record.retry = { ...record.retry, count: (record.retry?.count || 0) + 1 };
  record.events = [...(record.events || []), { at: now.toISOString(), from: previous, to: next, reason: patch.failure_reason || patch.reason || null }];
  writeAgentRun(root, record); return record;
}

export function recordVerification(root, runId, verification) {
  const record = readAgentRun(root, runId); record.tests = [...(record.tests || []), ...(verification.tests || [])]; record.verification = { ...(record.verification || {}), ...verification }; writeAgentRun(root, record); return record;
}
