import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {archiveCommittedProject} from '../.codex/skills/muion-project/scripts/archive-committed-project.mjs';

test('commit snapshot excludes dirty work, verifies hashes and refuses conflicting copies', t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'muion-commit-archive-')); const root=path.join(base,'repo'), remote=path.join(base,'remote.git'), drive=path.join(base,'drive');
  t.after(()=>{assert.equal(path.dirname(base),path.resolve(os.tmpdir()));assert.ok(path.basename(base).startsWith('muion-commit-archive-'));fs.rmSync(base,{recursive:true,force:true});});
  fs.mkdirSync(root);fs.mkdirSync(remote);
  const git=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git(root,'init','-b','main');git(remote,'init','--bare','-b','main');git(root,'config','user.name','test');git(root,'config','user.email','test@example.invalid');
  fs.writeFileSync(path.join(root,'规范.txt'),'registered\n');git(root,'add','规范.txt');git(root,'commit','-m','base');git(root,'remote','add','origin',remote);git(root,'push','origin','main');
  fs.writeFileSync(path.join(root,'规范.txt'),'user modification');fs.writeFileSync(path.join(root,'private.txt'),'untracked');
  const receipt=archiveCommittedProject({root,driveRoot:drive});assert.equal(receipt.file_count,1);
  assert.equal(fs.readFileSync(path.join(receipt.drive_path,'规范.txt'),'utf8'),'registered\n');assert.equal(fs.existsSync(path.join(receipt.drive_path,'.git')),false);assert.equal(fs.existsSync(path.join(receipt.drive_path,'private.txt')),false);
  assert.equal(archiveCommittedProject({root,driveRoot:drive}).manifest_sha256,receipt.manifest_sha256);
  fs.writeFileSync(path.join(receipt.drive_path,'规范.txt'),'conflict');assert.throws(()=>archiveCommittedProject({root,driveRoot:drive}),/existing snapshot differs/);
  assert.equal(fs.readFileSync(path.join(root,'规范.txt'),'utf8'),'user modification');
  fs.writeFileSync(path.join(receipt.drive_path,'规范.txt'),'registered\n');fs.writeFileSync(path.join(receipt.drive_path,'unexpected.txt'),'preserve');
  assert.throws(()=>archiveCommittedProject({root,driveRoot:drive}),/unexpected files/);
});
