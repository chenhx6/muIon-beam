import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROLES = new Set(['architect', 'critic', 'physics-reviewer', 'executor', 'researcher', 'qa', 'reporter', 'archivist', 'leader']);
const LIFECYCLE = ['planned', 'validated', 'ready', 'running', 'retrying', 'succeeded', 'failed', 'cancelled', 'blocked'];
const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
function clean(value) {
  let normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
  // Dispatch paths are repository-relative.  Normalize lexical aliases before
  // comparing them so Windows case-insensitivity and `src/../file` cannot hide
  // a writer collision.  Keep glob stars intact while normalizing segments.
  normalized = normalized.split('/').filter(Boolean).join('/');
  const parts = [];
  for (const part of normalized.split('/')) {
    if (part === '.') continue;
    if (part === '..') { if (parts.length) parts.pop(); continue; }
    parts.push(part);
  }
  normalized = parts.join('/');
  return normalized.toLowerCase();
}

function pathPatternMatches(a, b) {
  const left = clean(a).replace(/\*\*/g, '*'); const right = clean(b).replace(/\*\*/g, '*');
  if (!left || !right) return false;
  const wildcard = (value) => value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const exact = left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  return exact || new RegExp(`^${wildcard(left)}$`).test(right) || new RegExp(`^${wildcard(right)}$`).test(left);
}

export function overlaps(left, right) { return asArray(left).some((a) => asArray(right).some((b) => pathPatternMatches(a, b))); }

function permissionsFor(task) {
  const configured = task.permissions && typeof task.permissions === 'object' ? { ...task.permissions } : {};
  if (task.role === 'leader') configured.publish = configured.publish ?? true;
  if (task.role !== 'leader') configured.publish = false;
  if (task.role !== 'leader') configured.spawn_child = false;
  if (['critic', 'physics-reviewer', 'qa'].includes(task.role)) configured.write = false;
  return { read: configured.read !== false, write: Boolean(configured.write), publish: Boolean(configured.publish), spawn_child: Boolean(configured.spawn_child) };
}

function taskConflict(a, b) {
  const aWrites = [...asArray(a.owns), ...asArray(a.writes)]; const bWrites = [...asArray(b.owns), ...asArray(b.writes)];
  if (overlaps(aWrites, bWrites)) return 'writer ownership overlap';
  if (overlaps(aWrites, b.reads) || overlaps(bWrites, a.reads)) {
    const frozen = new Set([...asArray(a.frozen_inputs), ...asArray(b.frozen_inputs)].map(clean));
    const reads = [...asArray(a.reads), ...asArray(b.reads)];
    if (!reads.every((item) => frozen.has(clean(item)))) return 'mutable read/write conflict';
  }
  if (overlaps(a.resources, b.resources)) return 'exclusive resource conflict';
  return null;
}

export function validateDispatchManifest(manifest, options = {}) {
  const errors = []; const warnings = []; const tasks = asArray(manifest?.tasks); const seen = new Set();
  if (!manifest || typeof manifest !== 'object') errors.push('manifest must be an object');
  if (!manifest?.dispatch_id) errors.push('dispatch_id is required');
  for (const task of tasks) {
    if (!task?.task_id || seen.has(task.task_id)) errors.push(`task_id missing or duplicated: ${task?.task_id || '<missing>'}`);
    seen.add(task?.task_id);
    if (!ROLES.has(task?.role)) errors.push(`unknown role: ${task?.role || '<missing>'}`);
    if (!String(task?.summary || '').trim()) errors.push(`summary is required: ${task?.task_id || '<missing>'}`);
    for (const dep of asArray(task.depends_on)) if (!tasks.some((candidate) => candidate.task_id === dep)) errors.push(`${task.task_id} depends on unknown task ${dep}`);
    const permissions = permissionsFor(task);
    const requested = task.permissions && typeof task.permissions === 'object' ? task.permissions : {};
    if (['critic', 'physics-reviewer', 'qa'].includes(task.role) && (requested.write === true || asArray(task.writes).length || asArray(task.owns).length)) errors.push(`${task.task_id} reviewer must be read-only`);
    if (task.role !== 'leader' && requested.publish === true) errors.push(`${task.task_id} non-leader cannot publish`);
    if (task.role !== 'leader' && requested.spawn_child === true) errors.push(`${task.task_id} child cannot spawn_child`);
  }
  const completed = new Set(options.completed_ids || []); const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const statuses = new Map(tasks.map((task) => [task.task_id, completed.has(task.task_id) ? 'succeeded' : 'planned']));
  const limit = manifest?.policy?.max_concurrency || manifest?.policy?.default_concurrency || options.max_concurrency || 2;
  const waves = [];
  let remaining = new Set(tasks.filter((task) => !completed.has(task.task_id)).map((task) => task.task_id));
  while (remaining.size) {
    const ready = [...remaining].map((id) => byId.get(id)).filter((task) => asArray(task.depends_on).every((dep) => completed.has(dep) || statuses.get(dep) === 'succeeded'));
    if (!ready.length) { errors.push('dependency cycle or unresolved dependency prevents a ready wave'); for (const id of remaining) statuses.set(id, 'blocked'); break; }
    const wave = []; const blocked = new Set();
    for (const task of ready) {
      if (wave.length >= limit) {
        blocked.add(task.task_id);
        warnings.push(`${task.task_id} serialized after current wave: concurrency limit`);
        continue;
      }
      const conflict = wave.map((other) => ({ other, reason: taskConflict(task, other) })).find((item) => item.reason);
      if (conflict) { blocked.add(task.task_id); warnings.push(`${task.task_id} serialized after ${conflict.other.task_id}: ${conflict.reason}`); }
      else wave.push(task);
    }
    if (wave.length) { waves.push(wave.map((task) => task.task_id)); for (const task of wave) { statuses.set(task.task_id, 'ready'); remaining.delete(task.task_id); completed.add(task.task_id); } }
    if (blocked.size && !wave.length) { const [first] = blocked; waves.push([first]); statuses.set(first, 'ready'); remaining.delete(first); }
  }
  for (const task of tasks) if (statuses.get(task.task_id) === 'planned' && !completed.has(task.task_id)) statuses.set(task.task_id, 'blocked');
  if (limit < 1) errors.push('concurrency limit must be positive');
  return { valid: errors.length === 0, errors, warnings, waves: waves.map((wave) => wave.slice(0, limit)), statuses: Object.fromEntries(statuses), permissions: Object.fromEntries(tasks.map((task) => [task.task_id, permissionsFor(task)])) };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
export function hashManifest(manifest) { return crypto.createHash('sha256').update(JSON.stringify(stable(manifest))).digest('hex'); }
export function lifecycleTransition(current, next) {
  if (!LIFECYCLE.includes(next)) throw new Error(`unknown lifecycle state: ${next}`);
  const allowed = { planned: ['validated', 'blocked', 'cancelled'], validated: ['ready', 'blocked', 'cancelled'], ready: ['running', 'blocked', 'cancelled'], running: ['retrying', 'succeeded', 'failed', 'cancelled'], retrying: ['running', 'failed', 'cancelled'], failed: ['retrying', 'cancelled'], succeeded: [], blocked: [], cancelled: [] };
  if (!allowed[current]?.includes(next)) throw new Error(`invalid lifecycle transition: ${current} -> ${next}`);
  return next;
}

export function writeManifestValidation(root, dispatchId, result) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(dispatchId))) throw new Error('unsafe dispatch_id');
  const dir = path.join(root, '_work', 'dispatch'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${dispatchId}.validation.json`); fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n'); return file;
}
