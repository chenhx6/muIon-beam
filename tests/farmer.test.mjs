import test from 'node:test';
import assert from 'node:assert/strict';
import { batchDelay, classifyError, inside, recoveryStep } from '../.codex/skills/farmer/farmer.mjs';

const config = { max_attempts: 99, recoverable_codes: ['server_overloaded', 'rate_limit_exceeded', 'temporarily_unavailable'], recoverable_patterns: ['Selected model is at capacity', 'temporarily unavailable', 'service unavailable', 'rate limit', 'timed out', 'connection reset'], recovery_message: 'resume' };
test('farmer classifies transient and terminal errors', () => {
  assert.equal(classifyError({ message: 'Selected model is at capacity. Please try a different model.' }, config), 'transient-message');
  assert.equal(classifyError({ codex_error_info: 'server_overloaded', message: 'busy' }, config), 'server_overloaded');
  assert.equal(classifyError({ message: 'authentication failed' }, config), null);
});
test('farmer uses five-at-a-time escalating delays', () => {
  assert.equal(batchDelay(1), 3000);
  assert.equal(batchDelay(5), 3000);
  assert.equal(batchDelay(6), 5000);
  assert.equal(batchDelay(11), 7000);
  assert.equal(batchDelay(99), 41000);
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
