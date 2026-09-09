import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackExecution } from '../research-state/track.mjs';

const MODES = new Set(['create', 'modify', 'inspect', 'export']);
const FORBIDDEN_KEYS = new Set(['comsol', 'geant4', 'physics', 'simulation', 'beam_optimization']);

export function validateGeometryTask(task) {
  const errors = [];
  if (!task || typeof task !== 'object' || Array.isArray(task)) errors.push('task must be an object');
  const value = task || {};
  if (!MODES.has(value.mode)) errors.push(`mode must be one of: ${[...MODES].join(', ')}`);
  if (value.geometry_level && !['G0', 'G1', 'G2', 'G3'].includes(value.geometry_level)) errors.push('geometry_level must be G0, G1, G2 or G3');
  for (const key of Object.keys(value)) if (FORBIDDEN_KEYS.has(key)) errors.push(`cross-module field is not owned by 3d: ${key}`);
  return { valid: errors.length === 0, errors, geometry_level: value.geometry_level || 'G1' };
}

export function run3d(task, { dryRun = false } = {}) {
  const checked = validateGeometryTask(task);
  if (!checked.valid) return { status: 'blocked', owner: '3d', errors: checked.errors };
  return {
    status: dryRun ? 'dry-run' : 'accepted',
    owner: '3d',
    mode: task.mode,
    geometry_level: checked.geometry_level,
    entrypoint: `3d/${task.mode}`,
    next: task.mode === 'create' ? 'create or read native CAD' : `${task.mode} current CAD only`,
    cross_module_policy: 'return an issue record; do not edit COMSOL, Geant4 or research-workflow state; the public boundary may record research-state evidence'
  };
}

export async function run3dTracked(task, { dryRun = false, research_state_root = process.cwd(), context_id = null } = {}) {
  const tracked = await trackExecution({ root: research_state_root, module: '3d', task, contextId: context_id, execute: () => run3d(task, { dryRun }) });
  return tracked.raw;
}

function help() {
  return 'Usage: node 3d/index.mjs --mode <create|modify|inspect|export> [--task task.json] [--dry-run]';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(help()); process.exit(0); }
  const modeIndex = args.indexOf('--mode');
  const taskIndex = args.indexOf('--task');
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : null;
  const task = taskIndex >= 0 ? JSON.parse(fs.readFileSync(path.resolve(args[taskIndex + 1]), 'utf8')) : { mode };
  const runner = args.includes('--no-research-state') ? run3d : run3dTracked;
  Promise.resolve(runner(task, { dryRun: args.includes('--dry-run'), research_state_root: process.cwd() })).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
