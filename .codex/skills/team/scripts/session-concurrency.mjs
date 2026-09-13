import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Project-local adaptation of the worktree/claim ideas used by oh-my-codex
// v0.21.4 and claude-fleet.  This module is deliberately Node-only and does not
// launch an external agent runtime.  It owns session admission, path claims,
// private baselines and the leader integration gate.

const SCHEMA_VERSION = 1;
const DEFAULT_LEASE_MS = 30 * 60 * 1000;
const LOCK_WAIT_MS = 15_000;
const LOCK_POLL_MS = 100;
const STALE_LOCK_MS = 10 * 60 * 1000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MODES = new Set(['worktree', 'shared-read', 'shared-write']);

const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const nowIso = () => new Date().toISOString();
const runtimeRoot = (root) => path.join(root, '_work', 'current', 'concurrency');
const sessionsRoot = (root) => path.join(runtimeRoot(root), 'sessions');
const claimsFile = (root) => path.join(runtimeRoot(root), 'claims.json');
const lockRoot = (root) => path.join(runtimeRoot(root), 'locks');
const safeId = (value, label = 'id') => {
  if (!ID.test(String(value || ''))) throw new Error(`invalid ${label}: ${value}`);
  return String(value);
};

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let n; do { n = fs.readSync(fd, buffer, 0, buffer.length, null); if (n) hash.update(buffer.subarray(0, n)); } while (n); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function runGit(cwd, args, { allowFailure = false, timeout = 60_000 } = {}) {
  const result = spawnSync('git', ['-c', 'safe.directory=D:/muIon-beam', '-C', cwd, ...args], {
    encoding: 'utf8', windowsHide: true, timeout,
  });
  if (!allowFailure && result.status !== 0) throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  return result;
}

function repoRootFrom(cwd) {
  return path.resolve(runGit(cwd, ['rev-parse', '--show-toplevel']).stdout.trim());
}

function gitCommonDir(repoRoot) {
  const raw = runGit(repoRoot, ['rev-parse', '--git-common-dir']).stdout.trim();
  return path.resolve(repoRoot, raw);
}

function processAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function lockName(name) { return crypto.createHash('sha256').update(String(name)).digest('hex').slice(0, 24); }
function lockDir(root, name) { return path.join(lockRoot(root), `${lockName(name)}.lock`); }

function acquireLock(root, name, { waitMs = LOCK_WAIT_MS, staleMs = STALE_LOCK_MS } = {}) {
  const directory = lockDir(root, name);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const token = crypto.randomUUID();
  const started = Date.now();
  while (Date.now() - started <= waitMs) {
    try {
      fs.mkdirSync(directory);
      const owner = { schema_version: SCHEMA_VERSION, token, operation: name, pid: process.pid, host: process.env.COMPUTERNAME || 'local', acquired_at: nowIso() };
      atomicWrite(path.join(directory, 'owner.json'), owner);
      return { directory, token, owner };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = readJson(path.join(directory, 'owner.json'));
      const acquired = Date.parse(owner?.acquired_at || '');
      const dirAge = (() => { try { return Date.now() - fs.statSync(directory).mtimeMs; } catch { return 0; } })();
      if ((!owner && dirAge > staleMs) || (owner && Number.isFinite(acquired) && Date.now() - acquired > staleMs && !processAlive(owner.pid))) {
        fs.rmSync(directory, { recursive: true, force: true });
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_MS);
    }
  }
  const error = new Error(`lock contention: ${name}`); error.code = 'LOCK_CONTENTION'; throw error;
}

function releaseLock(lock) {
  if (!lock) return;
  const owner = readJson(path.join(lock.directory, 'owner.json'));
  if (owner?.token === lock.token) fs.rmSync(lock.directory, { recursive: true, force: true });
}

function withLock(root, name, fn, options = {}) {
  const lock = acquireLock(root, name, options);
  try { return fn(lock); } finally { releaseLock(lock); }
}

export function acquireProjectLock(root, name, options = {}) { return acquireLock(repoRootFrom(path.resolve(root)), name, options); }
export function releaseProjectLock(lock) { releaseLock(lock); }

function normalizeClaimPath(root, value) {
  const raw = String(value || '').replaceAll('\\', '/').trim();
  if (!raw) throw new Error('empty owned path');
  if (/^[A-Za-z]:\//.test(raw) || raw.startsWith('/')) throw new Error(`owned path must be repository-relative: ${value}`);
  const normalized = path.posix.normalize(raw.replace(/^\.\//, ''));
  if (normalized === '..' || normalized.startsWith('../')) throw new Error(`owned path escapes repository: ${value}`);
  // Claims are compared case-insensitively so a Windows checkout cannot admit
  // both `Package.json` and `package.json` as independent work.
  return normalized.toLowerCase();
}

function normalizeClaims(root, values) {
  return [...new Set(asArray(values).map((value) => normalizeClaimPath(root, value)))].sort();
}

function globRegex(pattern) {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') { source += '.*'; i += 1; }
    else if (char === '*') source += '[^/]*';
    else if ('\\.+^$()|{}[]?'.includes(char)) source += `\\${char}`;
    else source += char;
  }
  return new RegExp(`${source}$`);
}

function claimOverlap(left, right) {
  const a = String(left).replaceAll('\\', '/').toLowerCase(); const b = String(right).replaceAll('\\', '/').toLowerCase();
  if (a === '__workspace__' || b === '__workspace__') return true;
  const base = (value) => value.endsWith('/**') ? value.slice(0, -3).replace(/\/$/, '') : value;
  const ba = base(a); const bb = base(b);
  if (ba === bb || ba.startsWith(`${bb}/`) || bb.startsWith(`${ba}/`)) return true;
  return globRegex(a).test(b) || globRegex(b).test(a);
}

function claimsOverlap(left, right) { return asArray(left).some((a) => asArray(right).some((b) => claimOverlap(a, b))); }

function sessionFile(root, sessionId) { return path.join(sessionsRoot(root), `${safeId(sessionId, 'session_id')}.json`); }
function baselineFile(root, sessionId) { return path.join(sessionsRoot(root), `${safeId(sessionId, 'session_id')}.baseline.json`); }
function receiptFile(root, sessionId) { return path.join(sessionsRoot(root), `${safeId(sessionId, 'session_id')}.integration.json`); }

function readClaims(root) {
  const value = readJson(claimsFile(root), { schema_version: SCHEMA_VERSION, claims: [] });
  return { schema_version: SCHEMA_VERSION, claims: Array.isArray(value?.claims) ? value.claims : [] };
}

function writeClaims(root, value) { atomicWrite(claimsFile(root), value); }

function readSession(root, sessionId) {
  const value = readJson(sessionFile(root, sessionId));
  if (!value || value.schema_version !== SCHEMA_VERSION || value.session_id !== sessionId) throw new Error(`session not found: ${sessionId}`);
  return value;
}

function updateSession(root, session, patch) {
  const next = { ...session, ...patch, updated_at: nowIso() };
  atomicWrite(sessionFile(root, session.session_id), next);
  return next;
}

function currentStatus(cwd) {
  return runGit(cwd, ['status', '--porcelain', '--untracked-files=all']).stdout.split(/\r?\n/).filter(Boolean);
}

function statusPaths(cwd) {
  return currentStatus(cwd).map((line) => line.slice(3).replaceAll('\\', '/')).filter(Boolean);
}

function branchInUse(repoRoot, branch) {
  const raw = runGit(repoRoot, ['worktree', 'list', '--porcelain']).stdout;
  return raw.split(/\r?\n\r?\n/).some((chunk) => chunk.split(/\r?\n/).some((line) => line.trim() === `branch refs/heads/${branch}`));
}

function ensureWorktree(repoRoot, sessionId, baseRef) {
  const branch = `codex/session/${sessionId}`;
  const directory = path.join(repoRoot, '_work', 'current', 'worktrees', sessionId);
  if (branchInUse(repoRoot, branch)) throw new Error(`session branch already in use: ${branch}`);
  if (fs.existsSync(directory)) throw new Error(`session worktree path already exists: ${directory}`);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const result = runGit(repoRoot, ['worktree', 'add', '-b', branch, directory, baseRef], { allowFailure: true });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'git worktree add failed').trim());
  return { branch, directory: path.resolve(directory), created: true };
}

function hashesForPaths(cwd, claims) {
  const hashes = {};
  for (const claim of claims) {
    if (claim === '__workspace__') continue;
    const absolute = path.join(cwd, claim);
    hashes[claim] = fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? sha256File(absolute) : null;
  }
  return hashes;
}

function assertNoClaimCollision(root, sessionId, claims) {
  const active = readClaims(root).claims.filter((claim) => claim.status === 'active' && claim.session_id !== sessionId);
  const conflict = active.find((claim) => claimsOverlap(claim.paths, claims));
  if (conflict) throw new Error(`path claim collision: ${conflict.session_id} owns ${conflict.paths.join(', ')}`);
}

function registerClaim(root, session) {
  const current = readClaims(root);
  assertNoClaimCollision(root, session.session_id, session.claims);
  const retained = current.claims.filter((claim) => claim.session_id !== session.session_id);
  retained.push({ session_id: session.session_id, task_id: session.task_id, paths: session.claims, mode: session.mode, status: 'active', updated_at: nowIso() });
  writeClaims(root, { schema_version: SCHEMA_VERSION, claims: retained.sort((a, b) => a.session_id.localeCompare(b.session_id)) });
}

function removeClaim(root, sessionId) {
  const current = readClaims(root);
  writeClaims(root, { schema_version: SCHEMA_VERSION, claims: current.claims.filter((claim) => claim.session_id !== sessionId) });
}

export function beginSession({ root = process.cwd(), sessionId = null, taskId = null, mode = 'worktree', ownedPaths = [], reads = [], leaseMs = DEFAULT_LEASE_MS, allowDirtyShared = false } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root));
  const id = safeId(sessionId || `session-${Date.now()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`, 'session_id');
  if (!MODES.has(mode)) throw new Error(`invalid session mode: ${mode}`);
  const claims = mode === 'shared-read' ? [] : (ownedPaths.length ? normalizeClaims(repoRoot, ownedPaths) : ['__workspace__']);
  return withLock(repoRoot, 'session-registry', () => {
    const existing = readJson(sessionFile(repoRoot, id));
    if (existing?.status === 'active') {
      if (existing.mode !== mode || JSON.stringify(existing.claims) !== JSON.stringify(claims)) throw new Error(`session already active with different ownership: ${id}`);
      return { ...existing, resumed: true, baseline_path: path.relative(repoRoot, baselineFile(repoRoot, id)).replaceAll('\\', '/') };
    }
    if (mode === 'shared-write' && !allowDirtyShared && currentStatus(repoRoot).length) throw new Error('shared-write requires a clean leader checkout; use worktree mode for dirty work');
    const baseRef = runGit(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
    let worktreePath = repoRoot; let branch = null; let worktreeCreated = false;
    if (mode === 'worktree') ({ branch, directory: worktreePath, created: worktreeCreated } = ensureWorktree(repoRoot, id, baseRef));
    const session = {
      schema_version: SCHEMA_VERSION, session_id: id, task_id: taskId || id, mode, repo_root: repoRoot,
      worktree_path: worktreePath, branch, base_ref: baseRef, claims, reads: normalizeClaims(repoRoot, reads),
      status: 'active', owner_token: crypto.randomUUID(), lease_until: new Date(Date.now() + leaseMs).toISOString(),
      worktree_created: worktreeCreated, created_at: nowIso(), updated_at: nowIso(),
    };
    registerClaim(repoRoot, session);
    atomicWrite(sessionFile(repoRoot, id), session);
    atomicWrite(baselineFile(repoRoot, id), {
      schema_version: SCHEMA_VERSION, session_id: id, base_ref: baseRef,
      worktree_path: worktreePath, paths: statusPaths(worktreePath), hashes: hashesForPaths(worktreePath, claims), created_at: nowIso(),
    });
    return { ...session, baseline_path: path.relative(repoRoot, baselineFile(repoRoot, id)).replaceAll('\\', '/') };
  });
}

export function heartbeatSession({ root = process.cwd(), sessionId, token, leaseMs = DEFAULT_LEASE_MS } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root));
  return withLock(repoRoot, 'session-registry', () => {
    const session = readSession(repoRoot, safeId(sessionId, 'session_id'));
    if (session.status !== 'active') throw new Error(`session is not active: ${session.session_id}`);
    if (token !== session.owner_token) throw new Error('session owner token mismatch');
    const next = updateSession(repoRoot, session, { lease_until: new Date(Date.now() + leaseMs).toISOString() });
    const claims = readClaims(repoRoot);
    writeClaims(repoRoot, { ...claims, claims: claims.claims.map((claim) => claim.session_id === session.session_id ? { ...claim, updated_at: nowIso() } : claim) });
    return next;
  });
}

export function checkSession({ root = process.cwd(), sessionId } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root)); const session = readSession(repoRoot, safeId(sessionId, 'session_id'));
  const cwd = session.worktree_path; const dirty = statusPaths(cwd).map((value) => normalizeClaimPath(repoRoot, value));
  const outside = session.claims.includes('__workspace__') ? [] : dirty.filter((file) => !session.claims.some((claim) => claimOverlap(claim, file)));
  const branchHead = runGit(cwd, ['rev-parse', 'HEAD'], { allowFailure: true }).stdout.trim() || null;
  const baseDiff = session.mode === 'worktree' ? runGit(cwd, ['diff', '--name-only', `${session.base_ref}..HEAD`], { allowFailure: true }).stdout.split(/\r?\n/).filter(Boolean).map((value) => normalizeClaimPath(repoRoot, value)) : [];
  const committedOutside = session.claims.includes('__workspace__') ? [] : baseDiff.filter((file) => !session.claims.some((claim) => claimOverlap(claim, file)));
  return { session_id: session.session_id, status: outside.length || committedOutside.length ? 'blocked' : 'ready', mode: session.mode, worktree_path: cwd, branch: session.branch, head: branchHead, dirty_paths: dirty, outside_claim_paths: [...new Set([...outside, ...committedOutside])], lease_until: session.lease_until };
}

export function submitSession({ root = process.cwd(), sessionId } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root)); const session = readSession(repoRoot, safeId(sessionId, 'session_id')); const checked = checkSession({ root: repoRoot, sessionId });
  if (checked.status !== 'ready') throw new Error(`session ownership check failed: ${checked.outside_claim_paths.join(', ')}`);
  if (session.mode === 'worktree' && currentStatus(session.worktree_path).length) throw new Error('submit requires a clean worktree; commit the owned changes first');
  const head = runGit(session.worktree_path, ['rev-parse', 'HEAD']).stdout.trim();
  const changed = runGit(session.worktree_path, ['diff', '--name-only', `${session.base_ref}..HEAD`]).stdout.split(/\r?\n/).filter(Boolean).map((value) => normalizeClaimPath(repoRoot, value));
  const receipt = { schema_version: SCHEMA_VERSION, session_id: session.session_id, task_id: session.task_id, source_branch: session.branch, source_head: head, base_ref: session.base_ref, changed_paths: changed, created_at: nowIso(), status: 'pending-integration' };
  atomicWrite(receiptFile(repoRoot, session.session_id), receipt); updateSession(repoRoot, session, { status: 'submitted', receipt_path: path.relative(repoRoot, receiptFile(repoRoot, session.session_id)).replaceAll('\\', '/') });
  return receipt;
}

export function planIntegration({ root = process.cwd(), sessionId } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root)); const session = readSession(repoRoot, safeId(sessionId, 'session_id'));
  if (session.mode !== 'worktree' || !session.branch) throw new Error('only worktree sessions can be integrated');
  const checked = checkSession({ root: repoRoot, sessionId }); if (checked.status !== 'ready') throw new Error(`integration ownership check failed: ${checked.outside_claim_paths.join(', ')}`);
  const head = runGit(session.worktree_path, ['rev-parse', 'HEAD']).stdout.trim();
  const receipt = { schema_version: SCHEMA_VERSION, session_id: session.session_id, task_id: session.task_id, source_branch: session.branch, source_head: head, base_ref: session.base_ref, changed_paths: runGit(session.worktree_path, ['diff', '--name-only', `${session.base_ref}..HEAD`]).stdout.split(/\r?\n/).filter(Boolean).map((value) => normalizeClaimPath(repoRoot, value)), target_branch: runGit(repoRoot, ['symbolic-ref', '--short', 'HEAD']).stdout.trim() || 'main', status: 'pending-integration', created_at: nowIso() };
  atomicWrite(receiptFile(repoRoot, session.session_id), receipt); return receipt;
}

export function applyIntegration({ root = process.cwd(), sessionId } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root)); const id = safeId(sessionId, 'session_id');
  return withLock(repoRoot, 'leader-integration', () => {
    const session = readSession(repoRoot, id); if (session.mode !== 'worktree' || !session.branch) throw new Error('only worktree sessions can be integrated');
    if (currentStatus(repoRoot).length) throw new Error('leader checkout is dirty; integration is blocked');
    const sourceHead = runGit(session.worktree_path, ['rev-parse', 'HEAD']).stdout.trim();
    const merge = runGit(repoRoot, ['merge', '--no-ff', '--no-edit', session.branch], { allowFailure: true });
    if (merge.status !== 0) {
      const conflicts = runGit(repoRoot, ['diff', '--name-only', '--diff-filter=U'], { allowFailure: true }).stdout.split(/\r?\n/).filter(Boolean);
      runGit(repoRoot, ['merge', '--abort'], { allowFailure: true });
      const blocked = { schema_version: SCHEMA_VERSION, session_id: id, source_branch: session.branch, source_head: sourceHead, status: 'blocked-conflict', conflicts, created_at: nowIso(), detail: (merge.stderr || merge.stdout || '').trim() };
      atomicWrite(receiptFile(repoRoot, id), blocked); updateSession(repoRoot, session, { status: 'blocked', integration_status: 'blocked-conflict' }); return blocked;
    }
    const targetHead = runGit(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
    const done = { schema_version: SCHEMA_VERSION, session_id: id, source_branch: session.branch, source_head: sourceHead, target_head: targetHead, status: 'integrated', created_at: nowIso() };
    atomicWrite(receiptFile(repoRoot, id), done); updateSession(repoRoot, session, { status: 'integrated', integration_status: 'integrated', integrated_head: targetHead }); removeClaim(repoRoot, id); return done;
  });
}

export function closeSession({ root = process.cwd(), sessionId, token, cleanup = false } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root));
  return withLock(repoRoot, 'session-registry', () => {
    const session = readSession(repoRoot, safeId(sessionId, 'session_id')); if (token !== session.owner_token) throw new Error('session owner token mismatch');
    if (session.mode === 'worktree' && currentStatus(session.worktree_path).length) throw new Error('cannot close a dirty worktree; submit or preserve it first');
    if (cleanup && session.mode === 'worktree' && session.worktree_created) runGit(repoRoot, ['worktree', 'remove', session.worktree_path]);
    removeClaim(repoRoot, session.session_id);
    return updateSession(repoRoot, session, { status: 'closed', closed_at: nowIso(), cleanup });
  });
}

export function reapSession({ root = process.cwd(), sessionId, cleanup = true } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root));
  return withLock(repoRoot, 'session-registry', () => {
    const session = readSession(repoRoot, safeId(sessionId, 'session_id'));
    if (session.status !== 'active') return { ...session, reaped: false };
    if (Date.parse(session.lease_until || '') > Date.now()) throw new Error(`session lease is still active: ${session.session_id}`);
    if (session.mode === 'worktree' && fs.existsSync(session.worktree_path) && currentStatus(session.worktree_path).length) throw new Error('stale session worktree is dirty; preserve it before reaping');
    if (cleanup && session.mode === 'worktree' && session.worktree_created && fs.existsSync(session.worktree_path)) runGit(repoRoot, ['worktree', 'remove', session.worktree_path]);
    removeClaim(repoRoot, session.session_id);
    return updateSession(repoRoot, session, { status: 'abandoned', reaped: true, reaped_at: nowIso(), cleanup });
  });
}

export function listSessions({ root = process.cwd() } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root)); if (!fs.existsSync(sessionsRoot(repoRoot))) return [];
  return fs.readdirSync(sessionsRoot(repoRoot)).filter((name) => name.endsWith('.json') && !name.includes('.baseline.') && !name.includes('.integration.')).map((name) => readJson(path.join(sessionsRoot(repoRoot), name))).filter(Boolean).sort((a, b) => a.session_id.localeCompare(b.session_id));
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) { const token = argv[i]; if (!token.startsWith('--')) { out._.push(token); continue; } const key = token.slice(2).replaceAll('-', '_'); const next = argv[i + 1]; if (!next || next.startsWith('--')) out[key] = true; else { out[key] = out[key] === undefined ? next : [].concat(out[key], next); i += 1; } }
  return out;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv); const command = args._[0] || 'status'; const root = path.resolve(args.project_root || process.cwd());
  if (args.help || command === 'help') {
    return 'Usage: node session-concurrency.mjs begin|check|heartbeat|submit|integrate|close|reap|status --project-root PATH [options]\n' +
      'begin options: --session-id ID --task-id ID --mode worktree|shared-read|shared-write --owned-path PATH';
  }
  if (command === 'begin') return beginSession({ root, sessionId: args.session_id, taskId: args.task_id, mode: args.mode || 'worktree', ownedPaths: args.owned_path || [], reads: args.read || [], allowDirtyShared: Boolean(args.allow_dirty_shared) });
  if (command === 'heartbeat') return heartbeatSession({ root, sessionId: args.session_id, token: args.token });
  if (command === 'check') return checkSession({ root, sessionId: args.session_id });
  if (command === 'submit') return submitSession({ root, sessionId: args.session_id });
  if (command === 'integrate') return args.apply ? applyIntegration({ root, sessionId: args.session_id }) : planIntegration({ root, sessionId: args.session_id });
  if (command === 'close') return closeSession({ root, sessionId: args.session_id, token: args.token, cleanup: Boolean(args.cleanup) });
  if (command === 'reap') return reapSession({ root, sessionId: args.session_id, cleanup: args.cleanup !== false });
  if (command === 'status') return { sessions: listSessions({ root }), claims: readClaims(repoRootFrom(root)).claims };
  throw new Error(`unknown session-concurrency command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(main(), null, 2)); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

export { claimOverlap, claimsOverlap, normalizeClaimPath, readClaims, readSession, runtimeRoot, withLock };
