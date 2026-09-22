import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const project = path.resolve(import.meta.dirname, '..');
const farmer = path.join(project, '.codex/skills/farmer/farmer.mjs');

function line(value) { return `${JSON.stringify(value)}\n`; }
function run(processPath, args, options) {
  return new Promise((resolve) => {
    const child = spawn(processPath, args, { ...options, windowsHide: true }); let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-farmer-process-')); const home = path.join(root, 'codex-home'); const bin = path.join(root, 'bin');
  const sessionDir = path.join(home, 'sessions', '2026', '01'); const sessionFile = path.join(sessionDir, 'rollout-canary.jsonl'); const queueLog = path.join(root, 'queue.log');
  fs.mkdirSync(path.join(root, '00_project', 'config'), { recursive: true }); fs.mkdirSync(sessionDir, { recursive: true }); fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(root, '00_project/config/farmer.json'), JSON.stringify({ schema_version: 1, poll_interval_ms: 10, watchdog_ms: 1000, max_attempts: 3, recovery_message: '[farmer resume]', recoverable_codes: ['server_overloaded'], recoverable_patterns: [] }, null, 2));
  const fake = path.join(root, 'fake-codex.mjs'); fs.writeFileSync(fake, `import fs from 'node:fs';\nfs.appendFileSync(process.env.FARMER_QUEUE_LOG, JSON.stringify({ args: process.argv.slice(2), at: Date.now() }) + '\\n');\nawait new Promise(resolve => setTimeout(resolve, 200));\n`);
  const wrapper = path.join(bin, 'codex.cmd'); fs.writeFileSync(wrapper, `@echo off\n"${process.execPath}" "${fake}" %*\n`);
  fs.writeFileSync(sessionFile, [
    { type: 'session_meta', payload: { session_id: 'canary-session', cwd: root } },
    { type: 'event_msg', timestamp: '2026-01-01T00:00:01Z', payload: { type: 'task_complete', turn_id: 'failed-turn', error: { codex_error_info: 'server_overloaded', message: 'capacity' } } }
  ].map(line).join(''));
  const pathValue = `${bin};${process.env.Path || process.env.PATH || ''}`;
  const env = { ...process.env, CODEX_HOME: home, FARMER_QUEUE_LOG: queueLog, FARMER_CODEX_BIN: wrapper }; delete env.PATH; delete env.Path; env.Path = pathValue;
  const once = () => run(process.execPath, [farmer, 'once', '--project-root', root, '--codex-home', home], { cwd: project, env });
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, sessionFile, queueLog, once };
}

function append(file, timestamp, payload) { fs.appendFileSync(file, line({ type: 'event_msg', timestamp, payload })); }
function queueCount(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).length : 0; }
function state(root) { return JSON.parse(fs.readFileSync(path.join(root, '_work/current/farmer/state.json'), 'utf8'))['canary-session']; }

test('farmer process canary sends once, then stays quiet after recovery success', async (t) => {
  const f = fixture(t); const results = await Promise.all([f.once(), f.once()]);
  assert.ok(results.every((result) => result.code === 0), results.map((result) => result.stderr).join('\n'));
  assert.equal(queueCount(f.queueLog), 1, results.map((result) => result.stdout).join('\n'));
  assert.equal(state(f.root).pending, true); assert.ok(state(f.root).queue_reservation_id);

  append(f.sessionFile, '2026-01-01T00:00:02Z', { type: 'task_started', turn_id: 'recovery-turn' }); await f.once();
  assert.equal(queueCount(f.queueLog), 1); assert.equal(state(f.root).status, 'running');

  append(f.sessionFile, '2026-01-01T00:00:03Z', { type: 'task_complete', turn_id: 'recovery-turn' }); await f.once();
  assert.equal(queueCount(f.queueLog), 1); assert.equal(state(f.root).status, 'complete'); assert.equal(state(f.root).recovery_chain_active, false);

  append(f.sessionFile, '2026-01-01T00:00:02Z', { type: 'task_complete', turn_id: 'stale-failure', error: { codex_error_info: 'server_overloaded', message: 'old event' } }); await f.once();
  assert.equal(queueCount(f.queueLog), 1); assert.equal(state(f.root).status, 'complete');
});
