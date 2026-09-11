import test from 'node:test';
import assert from 'node:assert/strict';
import { batchDelay, classifyError, inside, manualRetryLease, parseSessionEvents, recoveryStep, validateConfig } from '../.codex/skills/farmer/farmer.mjs';

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
