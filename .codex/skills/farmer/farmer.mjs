import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDisabled, readControl, writeControl } from './farmer-control.mjs';

export const rootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const batchDelay = (attempt) => Math.min(2 + 2 * Math.floor((attempt - 1) / 10), 10) * 1000;
export const SAFE_MAX_ATTEMPTS = 3;
export const RECOVERY_LOCK_TTL_MS = 60_000;
export const inside = (child, root) => { const r = path.relative(path.resolve(root).toLowerCase(), path.resolve(child).toLowerCase()); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
export function classifyError(error, config) {
  if (!error) return null;
  const code = typeof error.codex_error_info === 'string' ? error.codex_error_info : error.code;
  const message = String(error.message || '');
  if (/auth|permission|cancel|context.*(length|window)|invalid.*(model|parameter)|unknown/i.test(`${code || ''} ${message}`)) return null;
  if (config.recoverable_codes.includes(code)) return code;
  return config.recoverable_patterns.some((p) => message.toLowerCase().includes(p.toLowerCase())) ? 'transient-message' : null;
}
export function validateConfig(config) {
  if (!config || (config.max_attempts !== null && (!Number.isInteger(config.max_attempts) || config.max_attempts < 1))) throw new Error('max_attempts must be null or a positive integer');
  if (config.watchdog_ms !== undefined && (!Number.isInteger(config.watchdog_ms) || config.watchdog_ms < 1)) throw new Error('watchdog_ms must be a positive integer');
  return config;
}
export function manualRetryLease(session, previous = {}) {
  if (!session?.id || !session.latest?.payload?.turn_id) throw new Error('manual retry requires session and failed turn');
  const event = session.latest;
  return { ...previous, session_id: session.id, retry_of: previous.event_key || null, event_key: `${session.id}:${event.payload.turn_id}:${event.timestamp}`, attempts: 0, pending: false, next_at: 0, status: 'manual-retry-requested', lifecycle: 'queue_attempted', manual_retry: true, breaker_cleared: true };
}
export function parseSessionEvents(lines, projectRoot) {
  let meta = null; let latest = null; let latestStarted = null; const userPrompts = [];
  const newer = (candidate, current) => {
    if (!current) return true;
    const candidateTime = Date.parse(candidate.timestamp || ''); const currentTime = Date.parse(current.timestamp || '');
    return !Number.isFinite(currentTime) || (Number.isFinite(candidateTime) && candidateTime >= currentTime);
  };
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.type === 'session_meta') meta = item.payload;
      if (item.type === 'response_item' && item.payload?.type === 'message' && item.payload.role === 'user') {
        const text = (item.payload.content || []).map(part => part.text || '').join('');
        const kinds = item.payload.internal_chat_message_metadata_passthrough?.content_item_kinds || [];
        if (text && (!kinds.length || kinds.includes('user.text'))) userPrompts.push({ text, timestamp: item.timestamp || null });
      }
      if (item.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(item.payload?.type)) {
        if (newer(item, latest)) latest = item; if (item.payload.type === 'task_started' && newer(item, latestStarted)) latestStarted = item;
      }
    } catch {}
  }
  if (!meta?.cwd || !inside(meta.cwd, projectRoot)) return null;
  return { id: meta.session_id || meta.id, cwd: meta.cwd, latest, latestStarted, userPrompts: userPrompts.slice(-12) };
}
function segment(file, start, length) { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(length); const n = fs.readSync(fd, b, 0, length, start); return b.subarray(0, n).toString('utf8'); } finally { fs.closeSync(fd); } }
function readSession(file, root) {
  const size = fs.statSync(file).size; const head = segment(file, 0, Math.min(size, 262144));
  const offset = Math.max(0, size - 1048576); const tail = segment(file, offset, size - offset);
  return parseSessionEvents([...head.split(/\r?\n/).slice(0, 1), ...tail.split(/\r?\n/).slice(offset ? 1 : 0)], root);
}
function walk(dir) { if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.jsonl') ? [path.join(dir, e.name)] : []); }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`); fs.renameSync(tmp, file); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function recoveryLockPath(root) { return path.join(root, '_work', 'current', 'farmer', 'recovery.lock'); }
export function acquireRecoveryLock(root, now = Date.now()) {
  const file = recoveryLockPath(root); fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = crypto.randomUUID();
    try {
      const fd = fs.openSync(file, 'wx'); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, acquired_at: new Date(now).toISOString() })); fs.closeSync(fd); return { file, token };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner = null; try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      const age = owner?.acquired_at ? now - Date.parse(owner.acquired_at) : Infinity;
      if (!owner || !alive(owner.pid) || age > RECOVERY_LOCK_TTL_MS) { try { fs.unlinkSync(file); } catch {} continue; }
      return null;
    }
  }
  return null;
}
export function releaseRecoveryLock(lock) {
  if (!lock) return;
  try { if (JSON.parse(fs.readFileSync(lock.file, 'utf8')).token === lock.token) fs.unlinkSync(lock.file); } catch {}
}
export function inspect(root, codexHome) {
  const result = new Map();
  for (const file of walk(path.join(codexHome, 'sessions'))) { try { const s = readSession(file, root); if (!s?.id || !s.latest) continue; const old = result.get(s.id); if (!old || s.latest.timestamp > old.latest.timestamp) result.set(s.id, s); } catch {} }
  return [...result.values()];
}
export function recoveryStep(session, previous, config, now, queue, options = {}) {
  validateConfig(config);
  if (options.disabled) return { ...previous, status: 'paused', lifecycle: 'paused', pending: false, next_at: 0, pause_reason: options.reason || 'farmer disabled' };
  const event = session.latest; const payload = event?.payload;
  if (!event) return previous;
  const eventKey = payload ? `${session.id}:${payload.turn_id}:${event.timestamp}` : null;
  const startedKey = session.latestStarted ? `${session.id}:${session.latestStarted.payload.turn_id}:${session.latestStarted.timestamp}` : previous?.last_started_event;
  const previousEventTimestamp = previous?.last_event_timestamp || (previous?.event_key ? previous.event_key.split(':').slice(2).join(':') : null);
  const eventTime = Date.parse(event.timestamp || ''); const previousTime = Date.parse(previousEventTimestamp || '');
  if (Number.isFinite(eventTime) && Number.isFinite(previousTime) && eventTime < previousTime) return { ...previous, stale_event_ignored: true };
  const recoveryText = String(options.recovery_message || config.recovery_message || '').trim();
  const automaticResume = Boolean(recoveryText && (session.userPrompts || []).some(prompt => String(prompt.text || '').trim() === recoveryText && (!previousEventTimestamp || Date.parse(prompt.timestamp || '') > Date.parse(previousEventTimestamp))));
  const manualUserPrompt = (session.userPrompts || []).some(prompt => !recoveryText || String(prompt.text || '').trim() !== recoveryText) && (session.userPrompts || []).some(prompt => !previousEventTimestamp || Date.parse(prompt.timestamp || '') > Date.parse(previousEventTimestamp));
  const sawNewStart = startedKey && startedKey !== previous?.last_started_event && previous?.event_key !== eventKey;
  const startAfterPreviousEvent = session.latestStarted && previousEventTimestamp && session.latestStarted.timestamp > previousEventTimestamp && session.latestStarted.payload.turn_id !== payload.turn_id;
  const manualNewStart = (sawNewStart || startAfterPreviousEvent) && !automaticResume && (manualUserPrompt || !previous?.recovery_chain_active);
  const reset = manualNewStart ? { ...previous, attempts: 0, pending: false, next_at: 0, last_started_event: startedKey, recovery_chain_active: false } : previous;
  const continuingRecovery = automaticResume || (Boolean(previous?.recovery_chain_active) && !manualUserPrompt);
  if (payload.type === 'task_started') return { ...reset, status: 'running', lifecycle: 'turn_started', event_key: eventKey, pending: false, attempts: continuingRecovery ? (previous?.attempts || 0) : 0, next_at: 0, last_started_event: eventKey, last_event_timestamp: event.timestamp, last_successful_activity: event.timestamp, recovery_chain_active: continuingRecovery, automatic_resume: automaticResume };
  if (payload.type === 'turn_aborted') return { ...previous, status: 'cancelled', lifecycle: 'cancelled', pending: false, last_event_timestamp: event.timestamp };
  if (!payload.error) return { ...reset, status: 'complete', lifecycle: 'succeeded', pending: false, recovery_chain_active: false, automatic_resume: false, last_event_timestamp: event.timestamp, last_successful_activity: event.timestamp };
  const errorClass = classifyError(payload.error, config);
  if (!errorClass) return { ...reset, status: 'manual-attention-required', lifecycle: 'failed', pending: false, last_event_timestamp: event.timestamp };
  const key = eventKey;
  const explicitRetry = previous?.manual_retry === true && previous.event_key === key;
  if (!explicitRetry && ['queue-stuck', 'manual-attention-required', 'blocked'].includes(previous?.status) && previous.event_key === key) return previous;
  let state = reset?.event_key === key ? { ...reset } : { event_key: key, attempts: (reset?.status === 'running' || reset?.recovery_chain_active) ? reset.attempts || 0 : 0, pending: false, next_at: 0, last_started_event: reset?.last_started_event, recovery_chain_active: Boolean(reset?.recovery_chain_active) };
  if (explicitRetry) state = { ...state, attempts: 0, pending: false, next_at: 0, manual_retry: false, breaker_cleared: false, status: 'retrying', lifecycle: 'queue_attempted' };
  state.error_class = errorClass;
  if (state.pending) {
    const pendingValue = state.queue_accepted_at || state.queue_reserved_at; const pendingAt = typeof pendingValue === 'number' ? pendingValue : Date.parse(pendingValue || '');
    if (pendingAt && now - pendingAt >= (config.watchdog_ms || 30000)) return { ...state, status: 'queue-stuck', lifecycle: 'queue_stuck', pending: false, next_at: now };
    return { ...state, status: 'recovery-pending', lifecycle: 'queued' };
  }
  const maxAttempts = config.max_attempts == null ? SAFE_MAX_ATTEMPTS : config.max_attempts;
  if (state.attempts >= maxAttempts) return { ...state, status: 'manual-attention-required', lifecycle: 'blocked', breaker_reason: 'max-attempts-reached' };
  if (now < state.next_at) return { ...state, status: 'waiting-retry' };
  const reservation = { reservation_id: crypto.randomUUID(), event_key: key, attempts: state.attempts + 1, reserved_at: now, reserved_at_iso: new Date(now).toISOString(), event_timestamp: event.timestamp };
  state.queue_reservation_id = reservation.reservation_id; state.queue_reserved_at = reservation.reserved_at;
  const result = queue(session.id, config.recovery_message, reservation);
  state.attempts += 1; state.last_exit_code = result.status; state.last_action_at = new Date(now).toISOString();
  state.queue_exit_code = result.status; state.queue_stdout = result.stdout ? String(result.stdout).slice(-2000) : null; state.queue_stderr = result.stderr ? String(result.stderr).slice(-2000) : null;
  state.pending = result.status === 0; state.lifecycle = state.pending ? 'queued' : 'queue_attempted'; state.status = state.pending ? 'recovery-pending' : 'waiting-retry';
  state.recovery_chain_active = true;
  state.queue_accepted_at = state.pending ? now : null;
  state.next_at = now + batchDelay(state.attempts);
  state.last_event_timestamp = event.timestamp;
  return state;
}
function argumentsOf(argv) { const a = { command: argv[0] || 'status' }; for (let i = 1; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } return a; }
async function main() {
  const args = argumentsOf(process.argv.slice(2));
  if (args.help || args.command === '--help') { console.log('farmer.mjs ensure|start|once|retry|status|stop|disable|enable|install [--project-root PATH] [--codex-home PATH] [--session ID] [--dry-run]'); return; }
  const root = path.resolve(args['project-root'] || rootDefault); const home = args['codex-home'] || process.env.CODEX_HOME || path.join(process.env.USERPROFILE || '', '.codex');
  const config = validateConfig(JSON.parse(fs.readFileSync(path.join(root, '00_project/config/farmer.json'), 'utf8')));
  const runtime = path.join(root, '_work/current/farmer'); const lock = path.join(runtime, 'lock.json'); const stateFile = path.join(runtime, 'state.json');
  const read = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
  const owner = read(lock, {});
  if (args.command === 'status') { console.log(JSON.stringify({ running: alive(owner.pid), owner, control: readControl(root), sessions: read(stateFile, {}) }, null, 2)); return; }
  if (args.command === 'disable') {
    const control = writeControl(root, { disabled: true, reason: args.reason || 'user-requested farmer pause', changed_by: 'farmer-control' });
    if (alive(owner.pid)) write(path.join(runtime, 'stop.json'), { pid: owner.pid, reason: 'disabled' });
    console.log(JSON.stringify({ status: 'disabled', control, stop_requested: owner.pid || null }, null, 2)); return;
  }
  if (args.command === 'enable') {
    const control = writeControl(root, { disabled: false, reason: null, changed_by: 'farmer-control' });
    console.log(JSON.stringify({ status: 'enabled', control }, null, 2)); return;
  }
  if (args.command === 'stop') { if (alive(owner.pid)) write(path.join(runtime, 'stop.json'), { pid: owner.pid }); console.log(JSON.stringify({ stop_requested: owner.pid || null })); return; }
  if (args.command === 'install') { console.log(JSON.stringify({ status: 'manual-install-required', command: `node "${fileURLToPath(import.meta.url)}" ensure`, note: 'Run this command from a user logon startup entry; no system task was installed.' }, null, 2)); return; }
  if (args.command === 'ensure') { if (isDisabled(root)) { console.log(JSON.stringify({ status: 'disabled', control: readControl(root), running: alive(owner.pid) })); return; } if (alive(owner.pid)) { console.log(JSON.stringify({ running: true, pid: owner.pid })); return; } if (args['dry-run']) { console.log(JSON.stringify({ would_start: true })); return; } fs.mkdirSync(runtime, { recursive: true }); const out = fs.openSync(path.join(runtime, 'daemon.log'), 'a'); const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'start', '--project-root', root, '--codex-home', home], { detached: true, stdio: ['ignore', out, out], windowsHide: true }); child.unref(); console.log(JSON.stringify({ started_pid: child.pid })); return; }
  const once = () => {
    if (isDisabled(root)) return { status: 'disabled', control: readControl(root), sessions: 0, states: read(stateFile, {}) };
    const recoveryLock = acquireRecoveryLock(root); if (!recoveryLock) return { status: 'busy', sessions: 0, states: read(stateFile, {}) };
    try {
      const states = read(stateFile, {}); const sessions = inspect(root, home); const now = Date.now();
      for (const session of sessions) {
        const before = states[session.id];
        const queue = (id, message, reservation) => {
          if (!args['dry-run']) {
            states[id] = { ...(states[id] || {}), event_key: reservation.event_key, attempts: reservation.attempts, pending: true, status: 'queue-attempting', lifecycle: 'queue_attempting', recovery_chain_active: true, queue_reservation_id: reservation.reservation_id, queue_reserved_at: reservation.reserved_at, queue_reserved_at_iso: reservation.reserved_at_iso, last_event_timestamp: reservation.event_timestamp };
            write(stateFile, states);
          }
          const queueExecutable = process.env.FARMER_CODEX_BIN || 'codex';
          const queueOptions = { encoding: 'utf8', windowsHide: true, timeout: 15000, shell: /\.(cmd|bat)$/i.test(queueExecutable) };
          return args['dry-run'] ? { status: 0 } : spawnSync(queueExecutable, ['queue', '--thread', id, '--message', message], queueOptions);
        };
        states[session.id] = recoveryStep(session, before, config, now, queue, { disabled: false });
      }
      if (!args['dry-run']) write(stateFile, states);
      return { sessions: sessions.length, states, dry_run: !!args['dry-run'] };
    } finally { releaseRecoveryLock(recoveryLock); }
  };
  if (args.command === 'retry') {
    if (isDisabled(root)) { console.log(JSON.stringify({ status: 'disabled', control: readControl(root), manual_retry: false }, null, 2)); return; }
    const recoveryLock = acquireRecoveryLock(root); if (!recoveryLock) { console.log(JSON.stringify({ status: 'busy', manual_retry: false }, null, 2)); return; }
    try {
      const sessions = inspect(root, home); const session = sessions.find((item) => item.id === args.session); if (!session) throw new Error(`project session not found: ${args.session || '(missing)'}`);
      const states = read(stateFile, {}); states[session.id] = manualRetryLease(session, states[session.id] || {}); if (!args['dry-run']) write(stateFile, states);
      console.log(JSON.stringify({ session_id: session.id, state: states[session.id], dry_run: !!args['dry-run'] }, null, 2));
    } finally { releaseRecoveryLock(recoveryLock); }
    return;
  }
  if (args.command === 'once') { console.log(JSON.stringify(once(), null, 2)); return; }
  if (args.command !== 'start') throw new Error('unknown command');
  if (isDisabled(root)) { console.log(JSON.stringify({ status: 'disabled', control: readControl(root) })); return; }
  if (alive(owner.pid)) throw new Error(`farmer already running: ${owner.pid}`);
  write(lock, { pid: process.pid, root, started_at: new Date().toISOString() });
  let busy = false; const tick = () => { if (busy) return; busy = true; try { const stop = read(path.join(runtime, 'stop.json'), {}); if (stop.pid === process.pid || isDisabled(root)) process.exit(0); const result = once(); write(path.join(runtime, 'health.json'), { pid: process.pid, checked_at: new Date().toISOString(), sessions: result.sessions }); } catch (e) { console.error(e.message); } finally { busy = false; } };
  process.on('exit', () => { if (read(lock, {}).pid === process.pid) fs.unlinkSync(lock); });
  try { fs.watch(path.join(home, 'sessions'), { recursive: true }, tick); } catch {}
  tick(); setInterval(tick, config.poll_interval_ms);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
