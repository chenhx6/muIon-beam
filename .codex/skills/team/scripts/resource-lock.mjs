import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const lockRoot = (root) => path.join(root, '_work', 'current', 'team', 'resource-locks');
const resourceName = (value) => typeof value === 'string' ? value : value && value.name ? String(value.name) : '';
const isExclusive = (value) => typeof value === 'object' ? value.exclusive !== false : true;
const lockKey = (name) => crypto.createHash('sha256').update(name).digest('hex').slice(0, 24);
const lockPath = (root, name) => path.join(lockRoot(root), `${lockKey(name)}.lock`);

function readOwner(file) {
  try { return JSON.parse(fs.readFileSync(path.join(file, 'owner.json'), 'utf8')); } catch { return null; }
}

function expired(owner, now = Date.now()) {
  return !owner || !owner.expires_at || Date.parse(owner.expires_at) <= now;
}

export function inspectResourceLock(root, resource, now = Date.now()) {
  const name = resourceName(resource); if (!name) throw new Error('resource name is required');
  const directory = lockPath(root, name); const owner = fs.existsSync(directory) ? readOwner(directory) : null;
  return { resource: name, exclusive: isExclusive(resource), locked: Boolean(owner && !expired(owner, now)), stale: Boolean(owner && expired(owner, now)), owner, path: directory };
}

export function acquireResourceLocks(root, resources = [], runId, { ttlMs = 30 * 60 * 1000, now = new Date() } = {}) {
  if (!runId) throw new Error('runId is required');
  const requested = [...new Map(resources.map((resource) => [resourceName(resource), resource])).values()].filter((resource) => resourceName(resource) && isExclusive(resource)).sort((a, b) => resourceName(a).localeCompare(resourceName(b)));
  const acquired = []; fs.mkdirSync(lockRoot(root), { recursive: true });
  for (const resource of requested) {
    const name = resourceName(resource); const directory = lockPath(root, name); const current = inspectResourceLock(root, resource, now.getTime());
    if (current.stale) fs.rmSync(directory, { recursive: true, force: true });
    try { fs.mkdirSync(directory); } catch {
      for (const owned of acquired) releaseResourceLock(root, owned.resource, runId);
      return { status: 'blocked', run_id: runId, resource: name, owner: inspectResourceLock(root, resource).owner, acquired: [] };
    }
    const owner = { schema_version: 1, run_id: runId, resource: name, acquired_at: now.toISOString(), expires_at: new Date(now.getTime() + ttlMs).toISOString(), enforcement: 'cooperative-protocol-lock' };
    fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify(owner, null, 2) + '\n'); acquired.push({ resource: name, owner });
  }
  return { status: 'acquired', run_id: runId, acquired, enforcement: 'cooperative-protocol-lock' };
}

export function releaseResourceLock(root, resource, runId) {
  const name = resourceName(resource); const directory = lockPath(root, name); const owner = readOwner(directory);
  if (!owner) return { status: 'already-released', resource: name };
  if (owner.run_id !== runId) return { status: 'owner-mismatch', resource: name, owner: owner.run_id };
  fs.rmSync(directory, { recursive: true, force: true }); return { status: 'released', resource: name, run_id: runId };
}

export function releaseResourceLocks(root, resources, runId) { return resources.map((resource) => releaseResourceLock(root, resource, runId)); }
