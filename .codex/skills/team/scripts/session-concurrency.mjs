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
  return normalized.replace(/\/$/, '').toLowerCase();
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
  const tokens = runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout.split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]; paths.push(token.slice(3).replaceAll('\\', '/'));
    if (/[RC]/.test(token.slice(0, 2))) paths.push(tokens[++index]);
  }
  return paths.filter(Boolean);
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

function assertNoClaimCollision(root, sessionId, claims, mode = null, isolatedOverlap = false) {
  const active = readClaims(root).claims.filter((claim) => claim.status === 'active' && claim.session_id !== sessionId);
  const conflict = active.find((claim) => claimsOverlap(claim.paths, claims) && !(mode === 'worktree' && claim.mode === 'worktree' && isolatedOverlap && claim.isolated_overlap));
  if (conflict) throw new Error(`path claim collision: ${conflict.session_id} owns ${conflict.paths.join(', ')}`);
}

function registerClaim(root, session) {
  const current = readClaims(root);
  assertNoClaimCollision(root, session.session_id, session.claims, session.mode, session.isolated_overlap);
  const retained = current.claims.filter((claim) => claim.session_id !== session.session_id);
  retained.push({ session_id: session.session_id, task_id: session.task_id, paths: session.claims, mode: session.mode, isolated_overlap: Boolean(session.isolated_overlap), status: 'active', updated_at: nowIso() });
  writeClaims(root, { schema_version: SCHEMA_VERSION, claims: retained.sort((a, b) => a.session_id.localeCompare(b.session_id)) });
}

function removeClaim(root, sessionId) {
  const current = readClaims(root);
  writeClaims(root, { schema_version: SCHEMA_VERSION, claims: current.claims.filter((claim) => claim.session_id !== sessionId) });
}

export function beginSession({ root = process.cwd(), sessionId = null, taskId = null, name = null, hostSessionId = null, mode = 'worktree', ownedPaths = [], reads = [], leaseMs = DEFAULT_LEASE_MS, allowDirtyShared = false, isolatedOverlap = false } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root));
  const id = safeId(sessionId || `session-${Date.now()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`, 'session_id');
  if (!MODES.has(mode)) throw new Error(`invalid session mode: ${mode}`);
  if (isolatedOverlap && mode !== 'worktree') throw new Error('overlap isolation requires a private worktree');
  const claims = mode === 'shared-read' ? [] : (ownedPaths.length ? normalizeClaims(repoRoot, ownedPaths) : ['__workspace__']);
  return withLock(repoRoot, 'session-registry', () => {
    const existing = readJson(sessionFile(repoRoot, id));
    if (existing?.status === 'active') {
      if (existing.mode !== mode || Boolean(existing.isolated_overlap) !== isolatedOverlap || JSON.stringify(existing.claims) !== JSON.stringify(claims)) throw new Error(`session already active with different ownership: ${id}`);
      const resumed = typeof name === 'string' && name.trim() && !existing.name ? updateSession(repoRoot, existing, { name: name.trim() }) : existing;
      return { ...resumed, resumed: true, baseline_path: path.relative(repoRoot, baselineFile(repoRoot, id)).replaceAll('\\', '/') };
    }
    if (mode === 'shared-write' && !allowDirtyShared && currentStatus(repoRoot).length) throw new Error('shared-write requires a clean leader checkout; use worktree mode for dirty work');
    assertNoClaimCollision(repoRoot, id, claims, mode, isolatedOverlap);
    const baseRef = runGit(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
    let worktreePath = repoRoot; let branch = null; let worktreeCreated = false;
    if (mode === 'worktree') ({ branch, directory: worktreePath, created: worktreeCreated } = ensureWorktree(repoRoot, id, baseRef));
    const session = {
      schema_version: SCHEMA_VERSION, session_id: id, task_id: taskId || id, name: typeof name === 'string' && name.trim() ? name.trim() : null, mode, repo_root: repoRoot,
      host_session_id: hostSessionId, isolated_overlap: isolatedOverlap,
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

// Explicit user-approved continuation. Reuses the submitted worker worktree;
// it never allocates a second branch or discards the integration receipt.
export function resumeSession({ root = process.cwd(), sessionId, reason = 'explicit user-approved continuation', leaseMs = DEFAULT_LEASE_MS } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root));
  return withLock(repoRoot, 'session-registry', () => {
    const session = readSession(repoRoot, safeId(sessionId, 'session_id'));
    if (session.status === 'active') return { ...session, resumed: false };
    if (!['submitted', 'blocked', 'interrupted', 'paused'].includes(session.status)) throw new Error(`session cannot resume from ${session.status}: ${session.session_id}`);
    if (!fs.existsSync(session.worktree_path)) throw new Error(`session worktree is missing: ${session.worktree_path}`);
    assertNoClaimCollision(repoRoot, session.session_id, session.claims, session.mode, session.isolated_overlap);
    registerClaim(repoRoot, session);
    const at = nowIso();
    const lifecycleEvents = [...(session.lifecycle_events || []), { at, from: session.status, to: 'active', reason }];
    return updateSession(repoRoot, session, { status: 'active', lease_until: new Date(Date.now() + leaseMs).toISOString(), resumed_at: at, resume_reason: reason, resume_count: (session.resume_count || 0) + 1, lifecycle_events: lifecycleEvents });
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
  const repoRoot = repoRootFrom(path.resolve(root));
  return withLock(repoRoot, 'session-registry', () => {
    const session = readSession(repoRoot, safeId(sessionId, 'session_id')); const checked = checkSession({ root: repoRoot, sessionId });
    if (checked.status !== 'ready') throw new Error(`session ownership check failed: ${checked.outside_claim_paths.join(', ')}`);
    if (session.mode === 'worktree' && currentStatus(session.worktree_path).length) throw new Error('submit requires a clean worktree; commit the owned changes first');
    const head = runGit(session.worktree_path, ['rev-parse', 'HEAD']).stdout.trim();
    const changed = runGit(session.worktree_path, ['diff', '--name-only', `${session.base_ref}..HEAD`]).stdout.split(/\r?\n/).filter(Boolean).map((value) => normalizeClaimPath(repoRoot, value));
    const receipt = { schema_version: SCHEMA_VERSION, session_id: session.session_id, task_id: session.task_id, source_branch: session.branch, source_head: head, base_ref: session.base_ref, changed_paths: changed, created_at: nowIso(), status: 'pending-integration' };
    atomicWrite(receiptFile(repoRoot, session.session_id), receipt); updateSession(repoRoot, session, { status: 'submitted', receipt_path: path.relative(repoRoot, receiptFile(repoRoot, session.session_id)).replaceAll('\\', '/') });
    return receipt;
  });
}

function submittedReceipt(repoRoot, session) {
  if (session.mode !== 'worktree' || !session.branch) throw new Error('only worktree sessions can be integrated');
  if (session.status !== 'submitted') throw new Error('integration requires a submitted session; submit again after continuation');
  const checked = checkSession({ root: repoRoot, sessionId: session.session_id });
  if (checked.status !== 'ready') throw new Error(`integration ownership check failed: ${checked.outside_claim_paths.join(', ')}`);
  if (checked.dirty_paths.length) throw new Error('integration requires a clean worktree');
  const receipt = readJson(receiptFile(repoRoot, session.session_id));
  const branch = runGit(session.worktree_path, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  if (receipt?.status !== 'pending-integration' || receipt.session_id !== session.session_id || receipt.source_branch !== session.branch || branch !== session.branch || receipt.source_head !== checked.head) {
    throw new Error('integration receipt is missing or stale; submit the current checkpoint again');
  }
  return receipt;
}

export function planIntegration({ root = process.cwd(), sessionId } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root));
  return withLock(repoRoot, 'session-registry', () => {
    const receipt = submittedReceipt(repoRoot, readSession(repoRoot, safeId(sessionId, 'session_id')));
    return { ...receipt, target_branch: runGit(repoRoot, ['symbolic-ref', '--short', 'HEAD']).stdout.trim() };
  });
}

export function applyIntegration({ root = process.cwd(), sessionId } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root)); const id = safeId(sessionId, 'session_id');
  return withLock(repoRoot, 'leader-integration', () => withLock(repoRoot, 'session-registry', () => {
    const session = readSession(repoRoot, id); if (session.mode !== 'worktree' || !session.branch) throw new Error('only worktree sessions can be integrated');
    if (currentStatus(repoRoot).length) throw new Error('leader checkout is dirty; integration is blocked');
    const sourceHead = submittedReceipt(repoRoot, session).source_head;
    const merge = runGit(repoRoot, ['merge', '--no-ff', '--no-edit', sourceHead], { allowFailure: true });
    if (merge.status !== 0) {
      const conflicts = runGit(repoRoot, ['diff', '--name-only', '--diff-filter=U'], { allowFailure: true }).stdout.split(/\r?\n/).filter(Boolean);
      runGit(repoRoot, ['merge', '--abort'], { allowFailure: true });
      const blocked = { schema_version: SCHEMA_VERSION, session_id: id, source_branch: session.branch, source_head: sourceHead, status: 'blocked-conflict', conflicts, created_at: nowIso(), detail: (merge.stderr || merge.stdout || '').trim() };
      atomicWrite(receiptFile(repoRoot, id), blocked); updateSession(repoRoot, session, { status: 'blocked', integration_status: 'blocked-conflict' }); return blocked;
    }
    const targetHead = runGit(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
    const done = { schema_version: SCHEMA_VERSION, session_id: id, source_branch: session.branch, source_head: sourceHead, target_head: targetHead, status: 'integrated', created_at: nowIso() };
    atomicWrite(receiptFile(repoRoot, id), done); updateSession(repoRoot, session, { status: 'integrated', integration_status: 'integrated', integrated_head: targetHead }); removeClaim(repoRoot, id); return done;
  }));
}

export function continueAfterIntegration({ root = process.cwd(), sessionId, reason = 'continue the same plan after node delivery', leaseMs = DEFAULT_LEASE_MS } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root)); const id = safeId(sessionId, 'session_id');
  return withLock(repoRoot, 'leader-integration', () => withLock(repoRoot, 'session-registry', () => {
    const session = readSession(repoRoot, id);
    if (session.status !== 'integrated' || session.integration_status !== 'integrated') throw new Error('only an integrated session can continue after delivery');
    if (session.mode !== 'worktree' || !session.branch || !fs.existsSync(session.worktree_path)) throw new Error('integrated worktree is unavailable');
    if (currentStatus(repoRoot).length || currentStatus(session.worktree_path).length) throw new Error('continuation requires clean main and worker worktrees');
    assertNoClaimCollision(repoRoot, id, session.claims, session.mode, session.isolated_overlap);
    const mainBranch = runGit(repoRoot, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
    if (mainBranch !== 'main') throw new Error('continuation requires the main checkout');
    const mainHead = runGit(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
    const oldHead = runGit(session.worktree_path, ['rev-parse', 'HEAD']).stdout.trim();
    if (runGit(repoRoot, ['merge-base', '--is-ancestor', oldHead, mainHead], { allowFailure: true }).status !== 0) throw new Error('worker head is not an ancestor of delivered main; preserve the branch for review');
    const merged = runGit(session.worktree_path, ['merge', '--ff-only', mainHead], { allowFailure: true });
    if (merged.status !== 0) throw new Error('cannot advance worker worktree to delivered main: ' + (merged.stderr || merged.stdout).trim());
    const at = nowIso(); const lifecycleEvents = [...(session.lifecycle_events || []), { at, from: 'integrated', to: 'active', reason }];
    const baseline = { schema_version: SCHEMA_VERSION, session_id: id, base_ref: mainHead, worktree_path: session.worktree_path, paths: statusPaths(session.worktree_path), hashes: hashesForPaths(session.worktree_path, session.claims), created_at: at };
    atomicWrite(baselineFile(repoRoot, id), baseline);
    registerClaim(repoRoot, { ...session, status: 'active' });
    return updateSession(repoRoot, session, { status: 'active', base_ref: mainHead, integrated_head: mainHead, lease_until: new Date(Date.now() + leaseMs).toISOString(), continued_at: at, continue_reason: reason, lifecycle_events: lifecycleEvents });
  }));
}

const terminalHostStatuses = new Set(['complete','completed','failed','interrupted','aborted','cancelled','canceled','manual-attention-required','closed','expired']);
function observedHostStatus(root, session) {
  if (!session.host_session_id) return null;
  const state = readJson(path.join(root, '_work/current/farmer/state.json'), {});
  return state?.[session.host_session_id]?.status || null;
}
function hostFinished(root, session) {
  return !session.host_session_id || terminalHostStatuses.has(String(observedHostStatus(root, session) || '').toLowerCase());
}
function assertSafeWorktreeCleanup(root, session) {
  const worktree = path.resolve(session.worktree_path || '');
  const worktreesRoot = path.resolve(root, '_work/current/worktrees');
  const relative = path.relative(worktreesRoot, worktree);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('worktree cleanup target is outside the managed worktree root');
  if (!fs.existsSync(worktree)) {
    const listed = runGit(root, ['worktree','list','--porcelain']).stdout;
    if (listed.toLowerCase().includes('worktree ' + worktree.toLowerCase())) throw new Error('missing worktree still has a Git registration; preserve for recovery');
  } else {
    if (fs.lstatSync(worktree).isSymbolicLink()) throw new Error('worktree cleanup target is a link');
    const actualRoot = runGit(worktree, ['rev-parse','--show-toplevel']).stdout.trim();
    if (path.resolve(actualRoot).toLowerCase() !== worktree.toLowerCase()) throw new Error('worktree Git root does not match its recorded path');
    const actualBranch = runGit(worktree, ['symbolic-ref','--short','HEAD']).stdout.trim();
    if (actualBranch !== session.branch) throw new Error('worktree branch differs from its recorded branch');
    const status = runGit(worktree, ['status','--porcelain','--ignored=matching','--untracked-files=all']).stdout.trim();
    if (status) throw new Error('cannot clean a worktree with tracked, untracked or ignored content');
    const blocks = runGit(root, ['worktree','list','--porcelain']).stdout.split(/\r?\n\r?\n/);
    const canonical = value => { try { return fs.realpathSync(value).toLowerCase(); } catch { return path.resolve(value).toLowerCase(); } };
    const match = blocks.find(block => {
      const line = block.split(/\r?\n/).find(item => item.startsWith('worktree '));
      return line && canonical(line.slice('worktree '.length)) === canonical(worktree);
    });
    if (!match || !match.split(/\r?\n/).includes('branch refs/heads/' + session.branch)) throw new Error('Git worktree registration does not match the recorded path and branch');
    const head = runGit(worktree, ['rev-parse','HEAD']).stdout.trim();
    const rootBranch = runGit(root, ['symbolic-ref','--short','HEAD']).stdout.trim();
    if (rootBranch !== 'main') throw new Error('worktree cleanup requires the main checkout');
    const mainHead = runGit(root, ['rev-parse','HEAD']).stdout.trim();
    if (runGit(root, ['merge-base','--is-ancestor',head,mainHead], { allowFailure: true }).status !== 0) throw new Error('worker branch has commits absent from main; preserve it');
  }
  if (session.branch) {
    const exists = runGit(root, ['show-ref','--verify','--quiet','refs/heads/' + session.branch], { allowFailure: true }).status === 0;
    if (exists && runGit(root, ['merge-base','--is-ancestor',session.branch,'main'], { allowFailure: true }).status !== 0) throw new Error('worker branch is not merged into main; preserve it');
  }
}
function removeDeliveredWorktree(root, session) {
  if (session.worktree_created && fs.existsSync(session.worktree_path)) runGit(root, ['worktree','remove',session.worktree_path]);
  if (session.branch && runGit(root, ['show-ref','--verify','--quiet','refs/heads/' + session.branch], { allowFailure: true }).status === 0) runGit(root, ['branch','-d',session.branch]);
}

function relativeFile(value, label) {
  const file = String(value || '').replaceAll('\\', '/');
  if (!file || file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`invalid ${label}: ${value}`);
  return file;
}
function gitBlobSha256(root, revision, file) {
  const result = spawnSync('git', ['-C', root, 'show', `${revision}:${file}`], { encoding: null, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) return null;
  return crypto.createHash('sha256').update(result.stdout).digest('hex');
}
function fileSha256IfRegular(file, root, hash = true) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep)) throw new Error(`cleanup evidence is not a regular in-root file: ${file}`);
  return { bytes: stat.size, sha256: hash ? sha256File(file) : null };
}
function resolveProjectFile(root, relative, label) {
  const file = path.resolve(root, relativeFile(relative, label)); const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${label} escaped project root`);
  return file;
}
function sameDirectory(left, right) {
  const a = fs.statSync(left); const b = fs.statSync(right);
  return a.isDirectory() && b.isDirectory() && a.dev === b.dev && a.ino === b.ino;
}
function ignoredWorktreeFiles(worktree, entries) {
  const root = path.resolve(worktree); const rootReal = fs.realpathSync(root); const files = new Set();
  const visit = value => {
    const relative = String(value).replaceAll('\\', '/').replace(/\/+$/, '');
    if (!relative || relative.startsWith('/') || /^[A-Za-z]:/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`invalid ignored worktree path: ${value}`);
    const absolute = path.resolve(root, ...relative.split('/')); const within = path.relative(root, absolute);
    if (within.startsWith('..') || path.isAbsolute(within)) throw new Error(`ignored worktree path escaped its root: ${value}`);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`ignored worktree path is a link: ${relative}`);
    const real = fs.realpathSync(absolute); const realWithin = path.relative(rootReal, real);
    if (realWithin.startsWith('..') || path.isAbsolute(realWithin)) throw new Error(`ignored worktree path resolved outside its root: ${relative}`);
    if (stat.isDirectory()) { for (const name of fs.readdirSync(absolute).sort()) visit(`${relative}/${name}`); return; }
    if (!stat.isFile()) throw new Error(`ignored worktree path is not a regular file: ${relative}`);
    files.add(relative);
  };
  for (const entry of entries) visit(entry);
  return [...files].sort();
}

// Supersession is a separate gate from normal ancestor-only cleanup. Its receipt
// must prove every changed path, Drive hash, runtime disposition and finished host.
export function cleanupSupersededSession({ root = process.cwd(), sessionId, receiptPath } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root)); const id = safeId(sessionId, 'session_id');
  return withLock(repoRoot, 'session-registry', () => {
    const receiptFilePath = path.resolve(receiptPath || '');
    if (!receiptPath || !fs.existsSync(receiptFilePath) || fs.lstatSync(receiptFilePath).isSymbolicLink() || path.resolve(runGit(path.dirname(receiptFilePath), ['rev-parse','--show-toplevel']).stdout.trim()).toLowerCase() !== repoRoot.toLowerCase()) throw new Error('supersession receipt must be a regular file inside the project root');
    const receipt = readJson(receiptFilePath);
    if (receipt?.record_type !== 'superseded-worktree-cleanup' || receipt.status !== 'verified' || receipt.session_id !== id) throw new Error('verified supersession receipt is missing or does not match the session');
    const session = readSession(repoRoot, id);
    if (session.mode !== 'worktree' || !session.worktree_created || !String(session.branch || '').startsWith('codex/session/')) throw new Error('supersession cleanup requires a managed session worktree branch');
    if (!['active', 'closed', 'integrated', 'submitted'].includes(session.status)) throw new Error('session lifecycle is not eligible for supersession cleanup');
    if (receipt.branch !== session.branch || receipt.worktree_path && path.resolve(receipt.worktree_path).toLowerCase() !== path.resolve(session.worktree_path).toLowerCase()) throw new Error('receipt branch or worktree does not match the session registry');
    const hostProof = receipt.host_completion;
    const externalHostDone = hostProof?.host_session_id === session.host_session_id && ['complete','completed','failed','interrupted','aborted','cancelled','canceled','closed','expired'].includes(String(hostProof.status || '').toLowerCase()) && hostProof.verified_at && hostProof.source;
    const externalHostAbsent = session.status === 'closed' && hostProof?.host_session_id === session.host_session_id && hostProof.status === 'not-found' && hostProof.verified_at && hostProof.absence_checks?.active_lookup === 'not-found' && hostProof.absence_checks?.archived_lookup === 'not-found' && hostProof.absence_checks?.state_index === 'not-found' && hostProof.absence_checks?.turn_history === 'not-found';
    if (!hostFinished(repoRoot, session) && !externalHostDone && !externalHostAbsent) throw new Error('host completion is unknown; preserve the worktree');
    if (hostProof?.host_session_id && hostProof.host_session_id !== session.host_session_id) throw new Error('host completion proof belongs to another host session');
    if (receipt.process_check?.status !== 'clear' || !receipt.process_check.checked_at || !Array.isArray(receipt.process_check.process_ids) || receipt.process_check.process_ids.length) throw new Error('active process check is missing or not clear');
    if (currentStatus(repoRoot).length) throw new Error('supersession cleanup requires a clean main checkout');
    if (runGit(repoRoot, ['symbolic-ref','--short','HEAD']).stdout.trim() !== 'main') throw new Error('supersession cleanup requires the main checkout');
    if (runGit(repoRoot, ['merge-base','--is-ancestor',receipt.main_commit,'HEAD'], { allowFailure: true }).status !== 0) throw new Error('receipt main commit is not an ancestor of current main');
    const resultFile = path.join(repoRoot, '_work/current/publish-outbox/supersession-cleanup', `${id}.json`);
    if (!fs.existsSync(session.worktree_path)) {
      const interrupted = readJson(resultFile);
      if (!interrupted || interrupted.source_commit !== receipt.source_commit || !['worktree-removed','branch-removed'].includes(interrupted.status)) throw new Error('worktree is missing without a matching cleanup journal; preserve Git refs');
      const ref = 'refs/heads/' + session.branch;
      if (runGit(repoRoot, ['show-ref','--verify','--quiet',ref], { allowFailure:true }).status === 0) {
        if (runGit(repoRoot, ['rev-parse',ref]).stdout.trim() !== receipt.source_commit) throw new Error('branch moved after supersession cleanup began');
        runGit(repoRoot, ['update-ref','-d',ref,receipt.source_commit]);
        interrupted.status = 'branch-removed'; interrupted.branch_removed = true; atomicWrite(resultFile, interrupted);
      }
      removeClaim(repoRoot, id);
      const current = readSession(repoRoot, id);
      return updateSession(repoRoot, current, { status:'closed', cleanup:true, cleanup_pending:false, cleanup_completed:true, cleanup_completed_at:nowIso(), superseded_cleanup_receipt:path.relative(repoRoot,resultFile).replaceAll('\\','/') });
    }
    if (!fs.existsSync(session.worktree_path) || fs.lstatSync(session.worktree_path).isSymbolicLink()) throw new Error('registered worktree is missing or is a link');
    const worktree = path.resolve(session.worktree_path);
    const expectedWorktree = path.join(repoRoot, '_work/current/worktrees', id);
    const gitRoot = runGit(worktree, ['rev-parse','--show-toplevel']).stdout.trim();
    if (!sameDirectory(worktree, expectedWorktree) || !sameDirectory(worktree, gitRoot)) throw new Error('worktree identity or managed path check failed');
    if (runGit(worktree, ['symbolic-ref','--short','HEAD']).stdout.trim() !== session.branch) throw new Error('worktree branch differs from the session registry');
    if (currentStatus(worktree).length) throw new Error('worktree has uncommitted or untracked nonignored files');
    const sourceCommit = runGit(worktree, ['rev-parse','HEAD']).stdout.trim();
    if (receipt.source_commit !== sourceCommit) throw new Error('fixed source SHA changed after cleanup receipt preparation');
    const mergeBase = runGit(repoRoot, ['merge-base','main',sourceCommit]).stdout.trim();
    if (receipt.merge_base !== mergeBase) throw new Error('supersession receipt merge base does not match Git');
    const changed = runGit(repoRoot, ['diff','--no-renames','--name-only','-z',mergeBase,sourceCommit]).stdout.split('\0').filter(Boolean).sort();
    const mappings = Array.isArray(receipt.path_mappings) ? receipt.path_mappings : [];
    const mapped = mappings.map(item => relativeFile(item.source_path, 'source path')).sort();
    if (new Set(mapped).size !== mapped.length || JSON.stringify(mapped) !== JSON.stringify(changed)) throw new Error('path mappings do not cover the exact changed-path set');
    const driveReadbackFile = resolveProjectFile(repoRoot, receipt.drive_readback?.file, 'Drive readback');
    const driveFile = fileSha256IfRegular(driveReadbackFile, repoRoot);
    if (receipt.drive_readback.status !== 'verified' || driveFile.sha256 !== receipt.drive_readback.sha256) throw new Error('cloud Drive readback receipt hash or status is invalid');
    const driveReadback = readJson(driveReadbackFile);
    if (driveReadback?.status !== 'verified' || !Array.isArray(driveReadback.files)) throw new Error('cloud Drive file readback is incomplete');
    const driveFiles = new Map(driveReadback.files.map(item => [relativeFile(item.path, 'Drive file').toLowerCase(), item]));
    const publication = readJson(path.join(repoRoot, '00_project/config/publish-policy.json'));
    const gitee = receipt.gitee_readback;
    if (!publication?.remote || !publication.branch || gitee?.status !== 'verified' || gitee.remote !== publication.remote || gitee.branch !== publication.branch) throw new Error('clean Gitee clone evidence does not match the publication policy');
    const cloneRoot = resolveProjectFile(repoRoot, gitee.clone_path, 'Gitee clone');
    const cloneHead = runGit(cloneRoot, ['rev-parse','HEAD']).stdout.trim();
    if (runGit(cloneRoot, ['symbolic-ref','--short','HEAD']).stdout.trim() !== publication.branch || cloneHead !== gitee.commit || currentStatus(cloneRoot).length) throw new Error('Gitee recovery clone is not clean at its fixed main commit');
    const configuredRemote = runGit(repoRoot, ['remote','get-url',publication.remote], { allowFailure:true });
    const expectedRemoteUrl = configuredRemote.status === 0 ? configuredRemote.stdout.trim() : publication.remote;
    if (!expectedRemoteUrl || runGit(cloneRoot, ['remote','get-url','origin']).stdout.trim() !== expectedRemoteUrl) throw new Error('Gitee recovery clone has the wrong origin');
    const remoteHead = runGit(repoRoot, ['ls-remote',publication.remote,'refs/heads/' + publication.branch]).stdout.trim().split(/\s+/)[0];
    if (!remoteHead || remoteHead !== gitee.remote_head || runGit(repoRoot, ['merge-base','--is-ancestor',receipt.main_commit,remoteHead], { allowFailure:true }).status !== 0) throw new Error('Gitee main does not contain the verified cleanup baseline');
    const dispositionFile = resolveProjectFile(repoRoot, receipt.disposition_evidence?.file, 'disposition evidence');
    const dispositionSig = fileSha256IfRegular(dispositionFile, repoRoot);
    const dispositionDrive = driveFiles.get(relativeFile(receipt.disposition_evidence?.file, 'disposition evidence').toLowerCase());
    if (!dispositionDrive || dispositionSig.sha256 !== receipt.disposition_evidence.sha256 || dispositionDrive.sha256 !== dispositionSig.sha256) throw new Error('path disposition evidence is not hash-verified in Drive');
    for (const item of mappings) {
      const sourcePath = relativeFile(item.source_path, 'source path'); const deliveryPath = relativeFile(item.delivery_path, 'delivery path');
      const sourceHash = gitBlobSha256(repoRoot, sourceCommit, sourcePath) || gitBlobSha256(repoRoot, mergeBase, sourcePath);
      if (!sourceHash || sourceHash !== item.source_sha256) throw new Error(`source path hash changed: ${sourcePath}`);
      const delivered = path.join(repoRoot, ...deliveryPath.split('/'));
      if (!fs.existsSync(delivered) || fileSha256IfRegular(delivered, repoRoot).sha256 !== item.delivery_sha256) throw new Error(`main replacement hash mismatch: ${deliveryPath}`);
      const cloud = driveFiles.get(deliveryPath.toLowerCase());
      if (!cloud || cloud.sha256 !== item.delivery_sha256 || item.drive_sha256 !== item.delivery_sha256) throw new Error(`Drive replacement hash is unverified: ${deliveryPath}`);
      const cloneBlob = runGit(cloneRoot, ['rev-parse', `${cloneHead}:${deliveryPath}`], { allowFailure:true });
      const mainBlob = runGit(repoRoot, ['rev-parse', `HEAD:${deliveryPath}`], { allowFailure:true });
      if (cloneBlob.status !== 0 || mainBlob.status !== 0 || cloneBlob.stdout.trim() !== mainBlob.stdout.trim()) throw new Error(`Gitee clone replacement differs from main: ${deliveryPath}`);
      if (!String(item.disposition || '').trim() || item.disposition_ref !== receipt.disposition_evidence.file) throw new Error(`path disposition is missing or lacks its audit reference: ${sourcePath}`);
    }
    const quarantineFile = resolveProjectFile(repoRoot, receipt.quarantine_readback_file, 'quarantine readback');
    const quarantineReadback = readJson(quarantineFile);
    if (quarantineReadback?.status !== 'verified' || !Array.isArray(quarantineReadback.files)) throw new Error('quarantine cloud readback is missing or failed');
    const quarantineFiles = new Map(quarantineReadback.files.map(item => [relativeFile(item.path, 'quarantine path').toLowerCase(), item]));
    for (const item of quarantineFiles.values()) {
      const relative = relativeFile(item.path, 'quarantine path');
      if (!relative.startsWith('90_migration/quarantine/') || item.verified !== true) throw new Error(`quarantine readback has an unverified path: ${relative}`);
      const source = path.resolve(worktree, ...relative.split('/'));
      const actual = fileSha256IfRegular(source, worktree);
      if (actual.bytes !== item.bytes || actual.sha256 !== item.source_sha256 || actual.sha256 !== item.cloud_sha256) throw new Error(`quarantine source and cloud hashes differ: ${relative}`);
    }
    const rebuildable = Array.isArray(receipt.rebuildable_roots) ? receipt.rebuildable_roots : []; const rebuildableVerified = new Set();
    const preservationRoot = path.join(repoRoot, '_work/current/supersession-preserved', id);
    const preserved = []; const ignoredEntries = runGit(worktree, ['ls-files','--others','--ignored','--exclude-standard','--directory','-z']).stdout.split('\0').filter(Boolean); const ignoredPaths = ignoredWorktreeFiles(worktree, ignoredEntries);
    let ignoredBytes = 0;
    for (const relative of ignoredPaths) {
      const categoryPath = relative.replaceAll('\\','/'); const source = path.resolve(worktree, categoryPath);
      const disposition = [
        ...(receipt.preserve_roots || []).map(item => ({ ...item, kind:'preserve' })),
        ...rebuildable.map(item => ({ ...item, kind:'rebuildable' })),
      ].filter(item => categoryPath.startsWith(item.prefix)).sort((a,b) => b.prefix.length-a.prefix.length)[0];
      const sourceSig = fileSha256IfRegular(source, worktree, disposition?.kind === 'preserve' || categoryPath.startsWith('90_migration/quarantine/')); ignoredBytes += sourceSig.bytes;
      if (categoryPath.startsWith('90_migration/quarantine/')) {
        const cloud = quarantineFiles.get(categoryPath.toLowerCase());
        if (!cloud || cloud.verified !== true || cloud.bytes !== sourceSig.bytes || cloud.cloud_sha256 !== sourceSig.sha256 || cloud.source_sha256 !== sourceSig.sha256) throw new Error(`quarantine copy lacks exact Drive SHA readback: ${categoryPath}`);
      } else if (disposition?.kind === 'preserve') {
        if (disposition.mode === 'differences') {
          const current = path.join(repoRoot, ...categoryPath.split('/'));
          if (fs.existsSync(current) && fileSha256IfRegular(current, repoRoot).sha256 === sourceSig.sha256) continue;
        } else if (disposition.mode !== 'all') throw new Error(`unsupported preservation mode for ${categoryPath}`);
        const relative = disposition.archive_prefix ? `${disposition.archive_prefix.replace(/\/$/,'')}/${categoryPath.slice(disposition.prefix.length)}` : categoryPath;
        const target = path.resolve(preservationRoot, relative); const within = path.relative(preservationRoot, target);
        if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('preserved artifact escaped its archive root');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) { if (sha256File(target) !== sourceSig.sha256) throw new Error(`preserved artifact conflict: ${categoryPath}`); }
        else { fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); if (sha256File(target) !== sourceSig.sha256) throw new Error(`preserved artifact copy hash mismatch: ${categoryPath}`); }
        preserved.push({ source_path: categoryPath, archive_path: path.relative(repoRoot, target).replaceAll('\\','/'), bytes: sourceSig.bytes, sha256: sourceSig.sha256 });
      } else if (disposition?.kind === 'rebuildable') {
        if (!rebuildableVerified.has(disposition.prefix)) {
          const evidencePath = resolveProjectFile(repoRoot, disposition.evidence_file, 'runtime replacement evidence');
          const evidenceSig = fileSha256IfRegular(evidencePath, repoRoot); const evidence = readJson(evidencePath);
          const replacement = resolveProjectFile(repoRoot, disposition.replacement_path, 'runtime replacement');
          const proofMatches = evidence?.rebuildable_roots?.some(item => item.source_prefix === disposition.prefix && item.replacement_path === disposition.replacement_path);
          if (disposition.evidence_sha256 !== evidenceSig.sha256 || evidence?.status !== 'passed' || !proofMatches || !fs.existsSync(replacement)) throw new Error(`rebuildable runtime lacks verified replacement evidence: ${categoryPath}`);
          rebuildableVerified.add(disposition.prefix);
        }
      } else {
        throw new Error(`ignored worktree path has no safe disposition: ${categoryPath}`);
      }
    }
    const quarantinePaths = ignoredPaths.filter(item => item.replaceAll('\\','/').startsWith('90_migration/quarantine/')).map(item => item.replaceAll('\\','/')).sort();
    if (quarantinePaths.some(item => !quarantineFiles.has(item.toLowerCase()))) throw new Error('quarantine Drive receipt does not cover the exact ignored quarantine file set');
    const registration = runGit(repoRoot, ['worktree','list','--porcelain']).stdout.split(/\r?\n\r?\n/).find(block => {
      const entry = block.split(/\r?\n/).find(line => line.startsWith('worktree '));
      return entry && sameDirectory(entry.slice('worktree '.length), worktree);
    });
    if (!registration || !registration.split(/\r?\n/).includes('branch refs/heads/' + session.branch)) throw new Error('Git worktree registration does not match the cleanup target');
    const localReceipt = { schema_version:1, record_type:'superseded-worktree-cleanup-result', session_id:id, source_commit:sourceCommit, main_commit:runGit(repoRoot,['rev-parse','HEAD']).stdout.trim(), ignored_file_count:ignoredPaths.length, ignored_bytes:ignoredBytes, quarantine_file_count:quarantinePaths.length, preserved_file_count:preserved.length, local_archive_root:path.relative(repoRoot,preservationRoot).replaceAll('\\','/'), preserved, status:'verified', prepared_at:nowIso() };
    atomicWrite(resultFile, localReceipt);
    if (fs.existsSync(worktree)) runGit(repoRoot, ['worktree','remove','--force',worktree]);
    localReceipt.status = 'worktree-removed'; localReceipt.worktree_removed = true; atomicWrite(resultFile, localReceipt);
    const ref = 'refs/heads/' + session.branch;
    if (runGit(repoRoot, ['show-ref','--verify','--quiet',ref], { allowFailure:true }).status === 0) runGit(repoRoot, ['update-ref','-d',ref,sourceCommit]);
    localReceipt.status = 'branch-removed'; localReceipt.branch_removed = true; localReceipt.completed_at = nowIso(); atomicWrite(resultFile, localReceipt);
    removeClaim(repoRoot, id);
    const current = readSession(repoRoot, id);
    return updateSession(repoRoot, current, { status:'closed', cleanup:true, cleanup_pending:false, cleanup_completed:true, cleanup_completed_at:nowIso(), superseded_cleanup_receipt:path.relative(repoRoot,resultFile).replaceAll('\\','/') });
  });
}

export function cleanupClosedSession({ root = process.cwd(), sessionId } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root));
  return withLock(repoRoot, 'session-registry', () => {
    const session = readSession(repoRoot, safeId(sessionId, 'session_id'));
    if (session.status !== 'closed' || !session.cleanup_pending) return { ...session, cleanup_completed: false };
    if (!hostFinished(repoRoot, session)) return { ...session, cleanup_deferred: true, host_status: observedHostStatus(repoRoot, session) || 'unknown' };
    if (session.mode === 'worktree' && session.worktree_created) {
      assertSafeWorktreeCleanup(repoRoot, session);
      removeDeliveredWorktree(repoRoot, session);
    }
    removeClaim(repoRoot, session.session_id);
    return updateSession(repoRoot, session, { cleanup_pending: false, cleanup_completed: true, cleanup_completed_at: nowIso(), cleanup_deferred: false });
  });
}

export function closeSession({ root = process.cwd(), sessionId, token, cleanup = false } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root));
  const result = withLock(repoRoot, 'session-registry', () => {
    const session = readSession(repoRoot, safeId(sessionId, 'session_id'));
    if (token !== session.owner_token) throw new Error('session owner token mismatch');
    if (session.mode === 'worktree' && currentStatus(session.worktree_path).length) throw new Error('cannot close a dirty worktree; submit or preserve it first');
    if (cleanup && session.mode === 'worktree' && session.worktree_created) {
      if (session.status !== 'integrated' || session.integration_status !== 'integrated') throw new Error('cannot clean a worker branch before its fixed source SHA is integrated');
      assertSafeWorktreeCleanup(repoRoot, session);
    }
    removeClaim(repoRoot, session.session_id);
    const defer = Boolean(cleanup && session.mode === 'worktree' && session.worktree_created && !hostFinished(repoRoot, session));
    return updateSession(repoRoot, session, { status: 'closed', closed_at: nowIso(), cleanup, cleanup_pending: Boolean(cleanup && session.mode === 'worktree' && session.worktree_created), cleanup_deferred: defer, cleanup_deferred_reason: defer ? 'host-session-still-active' : null });
  });
  return cleanup && result.cleanup_pending ? cleanupClosedSession({ root: repoRoot, sessionId }) : result;
}

export function reapSession({ root = process.cwd(), sessionId, cleanup = true } = {}) {
  const repoRoot = repoRootFrom(path.resolve(root));
  return withLock(repoRoot, 'session-registry', () => {
    const session = readSession(repoRoot, safeId(sessionId, 'session_id'));
    if (session.status !== 'active') return { ...session, reaped: false };
    if (Date.parse(session.lease_until || '') > Date.now()) throw new Error('session lease is still active: ' + session.session_id);
    if (!hostFinished(repoRoot, session)) throw new Error('host session is still active or unknown; preserve its worktree');
    if (session.mode === 'worktree' && fs.existsSync(session.worktree_path) && currentStatus(session.worktree_path).length) throw new Error('stale session worktree is dirty; preserve it before reaping');
    if (cleanup && session.mode === 'worktree' && session.worktree_created) {
      if (session.status !== 'integrated' && runGit(repoRoot, ['merge-base','--is-ancestor',session.branch,'main'], { allowFailure: true }).status !== 0) throw new Error('stale worker branch is not integrated; preserve it before reaping');
      assertSafeWorktreeCleanup(repoRoot, session);
      removeDeliveredWorktree(repoRoot, session);
    }
    removeClaim(repoRoot, session.session_id);
    return updateSession(repoRoot, session, { status: 'abandoned', reaped: true, reaped_at: nowIso(), cleanup, cleanup_pending: false, cleanup_completed: Boolean(cleanup) });
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
    return 'Usage: node session-concurrency.mjs begin|resume|continue|check|heartbeat|submit|integrate|close|reap|cleanup-superseded|status --project-root PATH [options]\n' +
      'begin options: --session-id ID --task-id ID --mode worktree|shared-read|shared-write --owned-path PATH';
  }
  if (command === 'begin') return beginSession({ root, sessionId: args.session_id, taskId: args.task_id, name: args.name, mode: args.mode || 'worktree', ownedPaths: args.owned_path || [], reads: args.read || [], allowDirtyShared: Boolean(args.allow_dirty_shared) });
  if (command === 'resume') return resumeSession({ root, sessionId: args.session_id, reason: args.reason || 'explicit user-approved continuation', leaseMs: args.lease_ms ? Number(args.lease_ms) : DEFAULT_LEASE_MS });
  if (command === 'continue') return continueAfterIntegration({ root, sessionId: args.session_id, reason: args.reason || 'continue the same plan after node delivery' });
  if (command === 'heartbeat') return heartbeatSession({ root, sessionId: args.session_id, token: args.token });
  if (command === 'check') return checkSession({ root, sessionId: args.session_id });
  if (command === 'submit') return submitSession({ root, sessionId: args.session_id });
  if (command === 'integrate') return args.apply ? applyIntegration({ root, sessionId: args.session_id }) : planIntegration({ root, sessionId: args.session_id });
  if (command === 'close') return closeSession({ root, sessionId: args.session_id, token: args.token, cleanup: Boolean(args.cleanup) });
  if (command === 'reap') return reapSession({ root, sessionId: args.session_id, cleanup: args.cleanup !== false });
  if (command === 'cleanup-superseded') return cleanupSupersededSession({ root, sessionId: args.session_id, receiptPath: args.receipt });
  if (command === 'status') return { sessions: listSessions({ root }), claims: readClaims(repoRootFrom(root)).claims };
  throw new Error(`unknown session-concurrency command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(main(), null, 2)); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

export { claimOverlap, claimsOverlap, normalizeClaimPath, readClaims, readSession, runtimeRoot, withLock };
