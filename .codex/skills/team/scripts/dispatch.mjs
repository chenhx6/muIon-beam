import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectModel } from './model-router.mjs';
import { createAgentRun, updateAgentRun } from './agent-run-ledger.mjs';
import { hashManifest, validateDispatchManifest, writeManifestValidation } from './dispatch-manifest.mjs';

function permissionsFromValidation(validation, task) { return validation.permissions?.[task.task_id] || task.permissions || { read: true, write: false, publish: false, spawn_child: false }; }

export function prepareDispatch(manifest, { root = process.cwd(), catalog, routing, parent_id = manifest.parent_id || null, refresh } = {}) {
  const validation = validateDispatchManifest(manifest);
  const manifest_hash = hashManifest(manifest);
  writeManifestValidation(root, manifest.dispatch_id, { dispatch_id: manifest.dispatch_id, manifest_hash, validation });
  const byId = new Map(manifest.tasks.map((task) => [task.task_id, task]));
  const routes = []; const runs = [];
  for (const task of manifest.tasks) {
    const selection = selectModel(catalog, { ...task, permissions: permissionsFromValidation(validation, task), parent_model: task.parent_model || null }, { routing, refresh });
    routes.push({ task_id: task.task_id, role: task.role, selection });
    const run = createAgentRun({ root, parent_id: task.parent_id || parent_id, task: { ...task, permissions: permissionsFromValidation(validation, task) }, selection, manifest_hash, input_hash: task.input_hash || null });
    if (!validation.valid) updateAgentRun(root, run.run_id, 'blocked', { failure_reason: validation.errors.join('; ') });
    else if (validation.statuses?.[task.task_id] === 'blocked' || !selection) {
      updateAgentRun(root, run.run_id, 'validated');
      updateAgentRun(root, run.run_id, 'blocked', { failure_reason: selection ? 'dependency or resource plan is blocked' : 'no compatible model and no parent fallback' });
    } else { updateAgentRun(root, run.run_id, 'validated'); updateAgentRun(root, run.run_id, 'ready'); }
    runs.push(run.run_id);
  }
  return { dispatch_id: manifest.dispatch_id, manifest_hash, validation, routes, run_ids: runs, task_count: byId.size, execution_boundary: 'protocol-only; runtime must enforce actual subprocess permissions and provider capacity' };
}

export function loadManifest(file) { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const file = process.argv[2]; if (!file) throw new Error('Usage: node dispatch.mjs <manifest.json>'); console.log(JSON.stringify(prepareDispatch(loadManifest(file)), null, 2));
}
