import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { RuntimeStore } from '../11_tools/project-supervisor/runtime-store.mjs';
import { ProcessSupervisor } from '../11_tools/project-supervisor/process-supervisor.mjs';
import { DashboardService } from '../11_tools/project-supervisor/services.mjs';
import { handleHook } from '../11_tools/project-supervisor/hooks.mjs';
import { start } from '../11_tools/research-dashboard/server.mjs';

function storeFor(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-supervisor-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('muion-supervisor-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return new RuntimeStore(root);
}
test('concurrent ensure starts one service and recovers after process exit', async t => {
  const store = storeFor(t); let state = 'stopped'; let starts = 0;
  const service = { name: 'example', health: async () => ({ status: state }), start: async () => { starts++; state = 'healthy'; } };
  const a = new ProcessSupervisor(store, [service]); const b = new ProcessSupervisor(store, [service]);
  await Promise.all([a.ensure(), b.ensure()]);
  assert.equal(starts, 1); state = 'stopped'; await b.ensure(); assert.equal(starts, 2);
  assert.equal(store.read('processes.json').services.example.status, 'healthy');
});
test('foreign listeners and degraded services are reported without duplicate starts', async t => {
  const store = storeFor(t); let starts = 0;
  const services = ['blocked', 'degraded'].map(status => ({ name: status, health: async () => ({ status }), start: async () => { starts++; } }));
  const supervisor = new ProcessSupervisor(store, services);
  await supervisor.ensure(); assert.equal(starts, 0);
  assert.equal(store.read('processes.json').services.blocked.status, 'blocked');
});
test('entry waits for a starting service first heartbeat without launching a duplicate', async t => {
  const store = storeFor(t); let checks=0, starts=0;
  const service={name:'farmer',health:async()=>({status:++checks<3?'starting':'healthy'}),start:async()=>{starts++;}};
  const result=await new ProcessSupervisor(store,[service],{pollMs:1}).ensure();
  assert.equal(result.farmer.status,'healthy'); assert.equal(starts,0);
});
test('service failure does not suppress independent service health or erase evidence', async t => {
  const store = storeFor(t);
  const supervisor = new ProcessSupervisor(store, [
    { name: 'broken', health: async () => { throw new Error('health failed'); } },
    { name: 'healthy', health: async () => ({ status: 'healthy' }) }
  ]);
  const status = await supervisor.ensure();
  assert.equal(status.broken.status, 'blocked'); assert.equal(status.healthy.status, 'healthy');
  assert.match(fs.readFileSync(store.file('events.jsonl'), 'utf8'), /health failed/);
});
test('dashboard health verifies service identity and actual status on loopback', async t => {
  const store = storeFor(t); const server = await start({ port: 0 });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const root = path.resolve(import.meta.dirname, '..');
  const service = new DashboardService(root, store, server.address().port);
  assert.equal((await service.health()).status, 'healthy');
  const other = new DashboardService(store.root, store, server.address().port);
  assert.equal((await other.health()).status, 'blocked');
});
test('foreign HTTP service cannot be adopted as dashboard', async t => {
  const store = storeFor(t); const server = http.createServer((req, res) => res.end('{}'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  assert.equal((await new DashboardService(store.root, store, server.address().port).health()).status, 'blocked');
});
test('session hook carries context without persisting user prompt or changing the model', async t => {
  const hookRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-hook-'));
  t.after(() => { assert.equal(path.dirname(hookRoot), path.resolve(os.tmpdir())); fs.rmSync(hookRoot, { recursive: true, force: true }); });
  let entered; const event = { hook_event_name: 'SessionStart', session_id: 's1', cwd: '.', model: 'unchanged', prompt: 'not stored' };
  const supervisor = { enter: async args => {
    entered = args; return { ready: true, services: { farmer: { status: 'healthy' } }, context: [{ path: 'AGENTS.md', content: 'project context' }] };
  } };
  const output = await handleHook(event, { root: hookRoot, supervisor, ensure: async () => {} });
  assert.deepEqual(entered, { sessionId: 's1', source: 'SessionStart' });
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.hookSpecificOutput.additionalContext, /project context/);
  assert.doesNotMatch(JSON.stringify(output), /not stored/);
  await assert.rejects(handleHook({ ...event, hook_event_name: 'Unknown' }, { root: hookRoot, supervisor, ensure: async () => {} }), /unsupported/);
});
