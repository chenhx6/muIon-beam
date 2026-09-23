import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ArtifactCatalog } from '../11_tools/project-supervisor/artifact-catalog.mjs';
import { aggregateProgress } from '../11_tools/project-supervisor/progress-aggregator.mjs';

test('ignored outputs remain discoverable with hashes and visible in total progress', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'muion-progress-'));
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('muion-progress-')); fs.rmSync(root,{recursive:true,force:true});});
  spawnSync('git',['init','-b','main'],{cwd:root});
  fs.writeFileSync(path.join(root,'.gitignore'),'*.mph\n_work/\n');
  fs.writeFileSync(path.join(root,'model.mph'),'important generated output');
  const session={session_id:'s',task_id:'t',branch:'codex/session/s',mode:'worktree',worktree_path:root,status:'abandoned',lease_until:'2000-01-01T00:00:00Z',owner_token:'never expose'};
  const dir=path.join(root,'_work/current/concurrency/sessions'); fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,'s.json'),JSON.stringify(session));
  const inventory=new ArtifactCatalog(root).inspect(session); const output=inventory.artifacts.find(item=>item.path==='model.mph');
  assert.equal(output.ignored_by_git,true); assert.match(output.sha256,/^[a-f0-9]{64}$/);
  const progress=aggregateProgress(root); assert.equal(progress.counts.blocked,0); assert.ok(progress.counts.unregistered_artifacts>=1);
  assert.equal(progress.sessions[0].status,'abandoned'); assert.doesNotMatch(JSON.stringify(progress),/never expose/);
  assert.equal(fs.readFileSync(path.join(root,'model.mph'),'utf8'),'important generated output');
});
