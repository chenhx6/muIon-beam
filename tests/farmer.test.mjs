import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireRecoveryLock, batchDelay, classifyError, inside, manualRetryLease, parseSessionEvents, recoveryStep, releaseRecoveryLock, validateConfig, SAFE_MAX_ATTEMPTS } from '../.codex/skills/farmer/farmer.mjs';

const config = { max_attempts: 99, recoverable_codes: ['server_overloaded', 'rate_limit_exceeded', 'temporarily_unavailable'], recoverable_patterns: ['Selected model is at capacity', 'temporarily unavailable', 'service unavailable', 'rate limit', 'timed out', 'connection reset'], recovery_message: 'resume' };
test('farmer classifies transient and terminal errors', () => {
  assert.equal(classifyError({ message: 'Selected model is at capacity. Please try a different model.' }, config), 'transient-message');
  assert.equal(classifyError({ codex_error_info: 'server_overloaded', message: 'busy' }, config), 'server_overloaded');
  assert.equal(classifyError({ message: 'authentication failed' }, config), null);
});
test('farmer uses ten-at-a-time delays capped at ten seconds', () => {
  assert.equal(batchDelay(1), 2000);
  assert.equal(batchDelay(10), 2000);
  assert.equal(batchDelay(11), 4000);
  assert.equal(batchDelay(20), 4000);
  assert.equal(batchDelay(21), 6000);
  assert.equal(batchDelay(30), 6000);
  assert.equal(batchDelay(31), 8000);
  assert.equal(batchDelay(40), 8000);
  assert.equal(batchDelay(41), 10000);
  assert.equal(batchDelay(99), 10000);
});
test('farmer validates finite and unlimited attempt configuration', () => {
  assert.equal(validateConfig({ max_attempts: null }).max_attempts, null);
  assert.equal(validateConfig({ max_attempts: 99 }).max_attempts, 99);
  assert.throws(() => validateConfig({ max_attempts: 0 }), /positive integer/);
  assert.throws(() => validateConfig({ max_attempts: 1.5 }), /positive integer/);
  assert.equal(validateConfig({ max_attempts: null, watchdog_ms: 1000 }).watchdog_ms, 1000);
  assert.throws(() => validateConfig({ max_attempts: null, watchdog_ms: 0 }), /watchdog_ms/);
});
test('farmer scopes sessions to the project', () => {
  assert.equal(inside('D:/muIon-beam/03_runs', 'D:/muIon-beam'), true);
  assert.equal(inside('D:/other', 'D:/muIon-beam'), false);
});
test('farmer queues one recovery and does not duplicate pending requests', () => {
  let calls = 0;
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const first = recoveryStep(session, { event_key: 'old', attempts: 0 }, config, Date.now() + 4000, () => { calls += 1; return { status: 0 }; });
  const second = recoveryStep(session, first, config, Date.now() + 8000, () => { calls += 1; return { status: 0 }; });
  assert.equal(calls, 1);
  assert.equal(first.pending, true);
  assert.equal(second.pending, true);
});
test('task start resets the recovery streak', () => {
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:01Z', payload: { type: 'task_started', turn_id: 't2' } }, latestStarted: { timestamp: '2026-01-01T00:00:01Z', payload: { type: 'task_started', turn_id: 't2' } } };
  const state = recoveryStep(session, { attempts: 39, pending: true, next_at: Date.now() + 9999 }, config, Date.now(), () => ({ status: 0 }));
  assert.equal(state.attempts, 0);
  assert.equal(state.pending, false);
  assert.equal(state.next_at, 0);
});
test('a fast start followed by failure is not missed', () => {
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 's1', cwd: 'D:/muIon-beam' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:00:01Z', payload: { type: 'task_started', turn_id: 't2' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:00:02Z', payload: { type: 'task_complete', turn_id: 't2', error: { codex_error_info: 'server_overloaded', message: 'busy' } } })
  ];
  const parsed = parseSessionEvents(lines, 'D:/muIon-beam');
  const state = recoveryStep({ ...parsed }, { attempts: 39, status: 'waiting-retry', last_started_event: 's1:old:old' }, config, Date.now(), () => ({ status: 1 }));
  assert.equal(state.attempts, 1);
  assert.equal(state.next_at - Date.now() <= 2100, true);
});
test('event selection prefers the newest timestamp even when rollout lines arrive out of order', () => {
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 's1', cwd: 'D:/muIon-beam' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:00:03Z', payload: { type: 'task_complete', turn_id: 't2' } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:00:01Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } })
  ];
  const parsed = parseSessionEvents(lines, 'D:/muIon-beam'); assert.equal(parsed.latest.timestamp, '2026-01-01T00:00:03Z');
  assert.equal(recoveryStep(parsed, { recovery_chain_active: true }, config, Date.now(), () => { throw new Error('stale event queued'); }).status, 'complete');
});
test('accepted queue without a new turn becomes queue-stuck after watchdog', () => {
  let calls = 0;
  const cfg = { ...config, watchdog_ms: 1000 };
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const first = recoveryStep(session, { event_key: 'old', attempts: 0 }, cfg, 10000, () => { calls += 1; return { status: 0, stdout: 'accepted' }; });
  const stuck = recoveryStep(session, first, cfg, 12001, () => { calls += 1; return { status: 0 }; });
  assert.equal(calls, 1);
  assert.equal(stuck.status, 'queue-stuck');
  assert.equal(stuck.lifecycle, 'queue_stuck');
});
test('queue timeout becomes a breaker and requires explicit retry', () => {
  let calls = 0; const cfg = { ...config, watchdog_ms: 1000 };
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const timeout = Object.assign(new Error('queue timed out'), { code: 'ETIMEDOUT' });
  const stuck = recoveryStep(session, { event_key: 'old', attempts: 0 }, cfg, 10000, () => { calls += 1; throw timeout; });
  const still = recoveryStep(session, stuck, cfg, 20000, () => { calls += 1; return { status: 0 }; });
  assert.equal(calls, 1); assert.equal(stuck.status, 'queue-stuck'); assert.equal(stuck.queue_uncertain, true); assert.equal(still.status, 'queue-stuck');
  const retried = recoveryStep(session, manualRetryLease(session, stuck), cfg, 30000, () => { calls += 1; return { status: 0 }; });
  assert.equal(calls, 2); assert.equal(retried.pending, true);
});
test('rollout activity proves the session is still writing after queue acceptance', () => {
  let calls = 0; const cfg = { ...config, watchdog_ms: 1000 };
  const session = { id: 's1', rollout_mtime_ms: 11000, rollout_size: 120, latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const observing = recoveryStep(session, { event_key: 's1:t1:2026-01-01T00:00:00Z', attempts: 1, pending: true, queue_accepted_at: 10000, rollout_mtime_ms: 10000, last_event_timestamp: '2026-01-01T00:00:00Z' }, cfg, 12001, () => { calls += 1; return { status: 0 }; });
  assert.equal(calls, 0); assert.equal(observing.status, 'recovery-observing'); assert.equal(observing.process_health, 'writing'); assert.equal(observing.pending, true); assert.equal(observing.queue_accepted_at, 12001);
});
test('unconfirmed queue reservation also becomes queue-stuck after watchdog', () => {
  const cfg = { ...config, watchdog_ms: 1000 };
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const state = recoveryStep(session, { event_key: 's1:t1:2026-01-01T00:00:00Z', attempts: 1, pending: true, lifecycle: 'queue_attempting', queue_reserved_at: 10000 }, cfg, 12001, () => { throw new Error('reservation must not queue again'); });
  assert.equal(state.status, 'queue-stuck'); assert.equal(state.pending, false);
});
test('successful completion releases lease and never resumes same event', () => {
  let calls = 0;
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:03Z', payload: { type: 'task_complete', turn_id: 't2' } } };
  const first = recoveryStep(session, { status: 'running', event_key: 'old', attempts: 2 }, config, Date.now(), () => { calls += 1; return { status: 0 }; });
  const second = recoveryStep(session, first, config, Date.now() + 60000, () => { calls += 1; return { status: 0 }; });
  assert.equal(first.status, 'complete');
  assert.equal(first.lifecycle, 'succeeded');
  assert.equal(second.status, 'complete');
  assert.equal(calls, 0);
});
test('persisted queued lease survives daemon restart without duplicate queue', () => {
  let calls = 0;
  const cfg = { ...config, watchdog_ms: 30000 };
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const persisted = { event_key: 's1:t1:2026-01-01T00:00:00Z', attempts: 1, pending: true, status: 'recovery-pending', lifecycle: 'queued', queue_accepted_at: 10000, next_at: 12000 };
  const recovered = recoveryStep(session, persisted, cfg, 20000, () => { calls += 1; return { status: 0 }; });
  assert.equal(calls, 0);
  assert.equal(recovered.lifecycle, 'queued');
  assert.equal(recovered.pending, true);
});
test('manual retry is linked to the failed event and resets attempt counter', () => {
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:04Z', payload: { type: 'task_complete', turn_id: 't3', error: { message: 'busy' } } } };
  const r = manualRetryLease(session, { event_key: 's1:t2:old', attempts: 4, pending: true });
  assert.equal(r.manual_retry, true); assert.equal(r.retry_of, 's1:t2:old'); assert.equal(r.attempts, 0); assert.equal(r.pending, false);
});
test('disabled recovery is a durable paused state and never calls the queue adapter', () => {
  let calls = 0;
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const state = recoveryStep(session, { attempts: 99 }, config, Date.now(), () => { calls++; return { status: 0 }; }, { disabled: true, reason: 'operator pause' });
  assert.equal(calls, 0); assert.equal(state.status, 'paused'); assert.equal(state.lifecycle, 'paused');
});
test('null max_attempts uses a bounded safety fallback', () => {
  let calls = 0; const cfg = { ...config, max_attempts: null };
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  let state = { event_key: 'old', attempts: 0 };
  for (let i = 0; i < SAFE_MAX_ATTEMPTS + 1; i++) state = recoveryStep(session, state, cfg, Date.now() + i * 20000, () => { calls++; return { status: 1 }; });
  assert.equal(calls, SAFE_MAX_ATTEMPTS); assert.equal(state.status, 'manual-attention-required');
});
test('watchdog breaker does not queue the same failed event again until explicit retry', () => {
  let calls = 0; const cfg = { ...config, watchdog_ms: 1000 };
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const first = recoveryStep(session, { event_key: 'old', attempts: 0 }, cfg, 10000, () => { calls++; return { status: 0 }; });
  const stuck = recoveryStep(session, first, cfg, 12001, () => { calls++; return { status: 0 }; });
  const still = recoveryStep(session, stuck, cfg, 99999, () => { calls++; return { status: 0 }; });
  assert.equal(calls, 1); assert.equal(stuck.status, 'queue-stuck'); assert.equal(still.status, 'queue-stuck');
  const manual = manualRetryLease(session, stuck);
  const retried = recoveryStep(session, manual, cfg, 200000, () => { calls++; return { status: 1 }; });
  assert.equal(calls, 2); assert.equal(retried.status, 'waiting-retry');
});
test('automatic resume keeps the same recovery attempt budget across new turns', () => {
  let calls = 0; const cfg = { ...config, max_attempts: 3 };
  const oldSession = { id: 's1', latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const exhausted = recoveryStep(oldSession, { event_key: 'old', attempts: 2, recovery_chain_active: true, status: 'waiting-retry', last_event_timestamp: '2026-01-01T00:00:00Z' }, cfg, Date.now(), () => { calls++; return { status: 0 }; });
  const resumed = { id: 's1', latest: { timestamp: '2026-01-01T00:01:00Z', payload: { type: 'task_started', turn_id: 't2' } }, latestStarted: { timestamp: '2026-01-01T00:01:00Z', payload: { type: 'task_started', turn_id: 't2' } }, userPrompts: [{ timestamp: '2026-01-01T00:00:30Z', text: cfg.recovery_message }] };
  const started = recoveryStep(resumed, exhausted, cfg, Date.now(), () => { calls++; return { status: 0 }; });
  assert.equal(started.attempts, 3); assert.equal(started.automatic_resume, true);
  const failed = { ...resumed, latest: { timestamp: '2026-01-01T00:01:01Z', payload: { type: 'task_complete', turn_id: 't2', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const blocked = recoveryStep(failed, started, cfg, Date.now(), () => { calls++; return { status: 0 }; });
  assert.equal(calls, 1); assert.equal(blocked.status, 'manual-attention-required');
});
test('ordinary new user turn starts a new recovery chain', () => {
  const cfg = { ...config, max_attempts: 3 };
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:01:00Z', payload: { type: 'task_started', turn_id: 't2' } }, latestStarted: { timestamp: '2026-01-01T00:01:00Z', payload: { type: 'task_started', turn_id: 't2' } }, userPrompts: [{ timestamp: '2026-01-01T00:00:30Z', text: 'new user task' }] };
  const next = recoveryStep(session, { event_key: 's1:t1:2026-01-01T00:00:00Z', attempts: 2, status: 'waiting-retry', last_started_event: 's1:t1:old' }, cfg, Date.now(), () => ({ status: 0 }));
  assert.equal(next.attempts, 0); assert.equal(next.recovery_chain_active, false); assert.equal(next.automatic_resume, false);
});
test('synthetic AGENTS and environment messages do not reset an active recovery chain', () => {
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 's1', cwd: 'D:/muIon-beam' } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T00:01:00Z', payload: { type: 'message', role: 'user', content: [{ text: '# AGENTS.md instructions\n<INSTRUCTIONS>' }], internal_chat_message_metadata_passthrough: { content_item_kinds: ['agents_md.instructions'] } } }),
    JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T00:01:01Z', payload: { type: 'task_started', turn_id: 't2' } })
  ];
  const parsed = parseSessionEvents(lines, 'D:/muIon-beam');
  const next = recoveryStep({ ...parsed }, { event_key: 's1:t1:2026-01-01T00:00:00Z', attempts: 2, recovery_chain_active: true, status: 'waiting-retry', last_event_timestamp: '2026-01-01T00:00:00Z' }, config, Date.now(), () => ({ status: 0 }));
  assert.equal(next.attempts, 2); assert.equal(next.automatic_resume, false); assert.equal(next.recovery_chain_active, true);
});
test('recovery lock permits one queue evaluator at a time', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-farmer-lock-'));
  try {
    const first = acquireRecoveryLock(root); assert.ok(first);
    assert.equal(acquireRecoveryLock(root), null);
    releaseRecoveryLock(first);
    const second = acquireRecoveryLock(root); assert.ok(second); releaseRecoveryLock(second);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('successful recovery closes the chain and stale failures cannot queue again', () => {
  let calls = 0; const cfg = { ...config, max_attempts: 3 };
  const success = { id: 's1', latest: { timestamp: '2026-01-01T00:00:03Z', payload: { type: 'task_complete', turn_id: 't2' } } };
  const completed = recoveryStep(success, { status: 'running', event_key: 's1:t2:old', attempts: 2, recovery_chain_active: true, last_event_timestamp: '2026-01-01T00:00:02Z' }, cfg, Date.now(), () => { calls += 1; return { status: 0 }; });
  assert.equal(completed.status, 'complete'); assert.equal(completed.recovery_chain_active, false);
  const stale = { id: 's1', latest: { timestamp: '2026-01-01T00:00:02Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const after = recoveryStep(stale, completed, cfg, Date.now() + 60000, () => { calls += 1; return { status: 0 }; });
  assert.equal(calls, 0); assert.equal(after.status, 'complete'); assert.equal(after.stale_event_ignored, true);
});
test('queue reservation is supplied before the queue adapter runs', () => {
  let reservation = null;
  const session = { id: 's1', latest: { timestamp: '2026-01-01T00:00:00Z', payload: { type: 'task_complete', turn_id: 't1', error: { codex_error_info: 'server_overloaded', message: 'busy' } } } };
  const state = recoveryStep(session, { event_key: 'old', attempts: 0 }, config, Date.now(), (_id, _message, value) => { reservation = value; return { status: 0 }; });
  assert.equal(reservation.event_key, state.event_key); assert.equal(reservation.attempts, 1); assert.match(reservation.reservation_id, /^[0-9a-f-]{36}$/); assert.equal(state.pending, true);
});
