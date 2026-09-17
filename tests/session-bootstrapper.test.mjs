import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SessionBootstrapper } from '../11_tools/project-supervisor/session-bootstrapper.mjs';
import { RuntimeStore } from '../11_tools/project-supervisor/runtime-store.mjs';
import { WorkerRuntime } from '../11_tools/project-supervisor/worker-runtime.mjs';
import { checkSession, listSessions } from '../.codex/skills/team/scripts/session-concurrency.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-bootstrap-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('muion-bootstrap-')); fs.rmSync(root, { recursive: true, force: true }); });
  for (const args of [['init','-b','main'],['config','user.name','test'],['config','user.email','test@example.invalid']]) assert.equal(spawnSync('git', args, {cwd:root}).status,0);
  fs.writeFileSync(path.join(root, '.gitignore'), '_work/\n'); fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
  spawnSync('git', ['add','.'], {cwd:root}); spawnSync('git', ['commit','-m','base'], {cwd:root});
  const store = new RuntimeStore(root); return { root, store, bootstrap: new SessionBootstrapper(root,store) };
}
test('unknown independent sessions automatically receive separate worktrees and resume idempotently', async t => {
  const { root, bootstrap } = fixture(t);
  const a = await bootstrap.enter({sessionId:'host-a'}); const b = await bootstrap.enter({sessionId:'host-b'});
  assert.notEqual(a.worktree_path,b.worktree_path); assert.notEqual(a.worktree_path,root);
  fs.writeFileSync(path.join(a.worktree_path,'a.txt'),'first\n'); fs.writeFileSync(path.join(b.worktree_path,'a.txt'),'second\n');
  assert.equal(fs.readFileSync(path.join(root,'a.txt'),'utf8'),'base\n');
  assert.equal((await bootstrap.enter({sessionId:'host-a'})).session_id,a.session_id);
  assert.equal(listSessions({root}).length,2);
});
test('explicit overlapping claims still refuse admission and preserve the first worker', async t => {
  const {root,bootstrap}=fixture(t);
  const a=await bootstrap.enter({sessionId:'a',ownedPaths:['a.txt']});
  await assert.rejects(bootstrap.enter({sessionId:'b',ownedPaths:['A.TXT']}),/claim collision/);
  assert.equal(fs.existsSync(a.worktree_path),true); assert.equal(listSessions({root}).length,1);
});
test('UTF-8 and spaced paths can be claimed without porcelain quoting errors', async t => {
  const {root,bootstrap}=fixture(t); const name='参数 file.txt';
  const a=await bootstrap.enter({sessionId:'a',ownedPaths:[name]});
  fs.writeFileSync(path.join(a.worktree_path,name),'value\n');
  assert.equal(checkSession({root,sessionId:a.session_id}).status,'ready');
});
test('worker runtime renews active host lease but reports ownership violations without reaping files', async t => {
  const {root,store,bootstrap}=fixture(t); const a=await bootstrap.enter({sessionId:'a',ownedPaths:['a.txt']});
  const farmer=path.join(root,'_work/current/farmer'); fs.mkdirSync(farmer,{recursive:true});
  fs.writeFileSync(path.join(farmer,'state.json'),JSON.stringify({a:{status:'running'}}));
  const workers=new WorkerRuntime(root,store); assert.equal(workers.tick()[0].ownership_status,'ready');
  fs.writeFileSync(path.join(a.worktree_path,'outside.txt'),'keep');
  assert.equal(workers.tick()[0].ownership_status,'blocked');
  assert.equal(fs.readFileSync(path.join(a.worktree_path,'outside.txt'),'utf8'),'keep');
});
