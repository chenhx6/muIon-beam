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
    model_family: selection?.family || selection?.model_family || task.model_family || null,
    reasoning: selection?.reasoning_effort || task.reasoning || null,
    backend: selection?.backend || selection?.provider || null,
    capability_requirements: { context: task.required_context || 0, modalities: task.required_modalities || [], tools: task.required_tools || [], backend: task.required_backend || null },
    candidates_considered: selection?.candidates_considered || [],
    selection_reason: selection?.selection_reason || null,
    catalog_freshness: selection?.catalog_freshness || null,
    stale_model_catalog: Boolean(selection?.stale_model_catalog),
    fallback: selection?.fallback || null,
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
    normalized_runtime: {
      run: runId,
      session: task.session_id || task.session || null,
      thread: task.thread_id || task.thread || null,
      model: selection?.model_id || null,
      reasoning: selection?.reasoning_effort || task.reasoning || null,
      backend: selection?.backend || selection?.provider || null,
      state: 'planned',
      retry: { count: 0, max: task.retry?.max ?? 1 },
      started_at: null,
      ended_at: null,
      output: null,
      verification: task.verification || {},
      unresolved_items: []
    },
    events: [{ at: now.toISOString(), from: null, to: 'planned', reason: 'run created' }]
  };
  writeAgentRun(root, record); return record;
}

export function writeAgentRun(root, record) {
  record.normalized_runtime = {
    ...(record.normalized_runtime || {}), run: record.run_id,
    session: record.session_id || record.session || record.normalized_runtime?.session || null,
    thread: record.thread_id || record.thread || record.normalized_runtime?.thread || null,
    model: record.selected_model || record.normalized_runtime?.model || null,
    reasoning: record.reasoning || record.normalized_runtime?.reasoning || null,
    backend: record.backend || record.normalized_runtime?.backend || null,
    state: record.lifecycle_state, retry: record.retry || record.normalized_runtime?.retry || null,
    started_at: record.start_time || record.normalized_runtime?.started_at || null,
    ended_at: record.end_time || record.normalized_runtime?.ended_at || null,
    output: record.output_reference || record.normalized_runtime?.output || null,
    verification: record.verification || {}, unresolved_items: record.unresolved_items || []
  };
  const file = fileFor(root, record.run_id); fs.mkdirSync(ledgerDir(root), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`; fs.writeFileSync(temp, JSON.stringify(record, null, 2) + '\n'); fs.renameSync(temp, file); return file;
}

export function readAgentRun(root, runId) { return JSON.parse(fs.readFileSync(fileFor(root, runId), 'utf8')); }

export function updateAgentRun(root, runId, next, patch = {}, now = new Date()) {
  const record = readAgentRun(root, runId); const previous = record.lifecycle_state; lifecycleTransition(previous, next);
  Object.assign(record, patch, { lifecycle_state: next });
  record.normalized_runtime = { ...(record.normalized_runtime || {}), state: next, ended_at: ['succeeded', 'failed', 'cancelled', 'blocked'].includes(next) ? now.toISOString() : record.normalized_runtime?.ended_at || null, started_at: next === 'running' && !record.normalized_runtime?.started_at ? now.toISOString() : record.normalized_runtime?.started_at || null, retry: record.retry, verification: record.verification, unresolved_items: record.unresolved_items || [] };
  if (next === 'running' && !record.start_time) record.start_time = now.toISOString();
  if (['succeeded', 'failed', 'cancelled', 'blocked'].includes(next)) record.end_time = now.toISOString();
  if (next === 'retrying') record.retry = { ...record.retry, count: (record.retry?.count || 0) + 1 };
  record.events = [...(record.events || []), { at: now.toISOString(), from: previous, to: next, reason: patch.failure_reason || patch.reason || null }];
  writeAgentRun(root, record); return record;
}

export function recordVerification(root, runId, verification) {
  const record = readAgentRun(root, runId); record.tests = [...(record.tests || []), ...(verification.tests || [])]; record.verification = { ...(record.verification || {}), ...verification }; writeAgentRun(root, record); return record;
}
