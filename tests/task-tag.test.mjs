import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTaskTag } from '../.codex/skills/muion-project/scripts/create-task-tag.mjs';

function fixture(t, { failedTagPushes = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-task-tag-'));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return result.stdout.trim();
  };
  git('init', '-b', 'main'); git('config', 'user.name', 'Task Tag Test'); git('config', 'user.email', 'tag-test@example.invalid');
  fs.mkdirSync(path.join(root, '00_project/config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), '_work/\n');
  fs.writeFileSync(path.join(root, '00_project/config/publish-policy.json'), JSON.stringify({ remote: 'origin', branch: 'main' }));
  fs.writeFileSync(path.join(root, 'README.md'), 'first\n');
  git('add', '.'); git('commit', '-m', 'initial');
  let remoteMain = git('rev-parse', 'HEAD'); const remoteTags = new Map();
  const gitRunner = (cwd, args, options = {}) => {
    if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'ls-remote') {
      const ref = args.at(-1);
      if (ref === 'refs/heads/main') return { status: 0, stdout: remoteMain + '\t' + ref, stderr: '' };
      const peeled = ref.endsWith('^{}'); const tagRef = peeled ? ref.slice(0, -3) : ref; const tag = tagRef.slice('refs/tags/'.length);
      const known = remoteTags.get(tag);
      if (!known) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: (peeled ? known.commit : known.object) + '\t' + ref, stderr: '' };
    }
    if (args[0] === 'push' && String(args.at(-1)).startsWith('refs/tags/')) {
      if (failedTagPushes > 0) { failedTagPushes--; throw new Error('simulated network failure'); }
      const tag = String(args.at(-1)).slice('refs/tags/'.length);
      remoteTags.set(tag, { object: git('rev-parse', 'refs/tags/' + tag), commit: git('rev-parse', tag + '^{}') });
      return { status: 0, stdout: '', stderr: '' };
    }
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
    if (!options.allowFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const create = args => createTaskTag({ root, ...args }, { gitRunner });
  const advanceRemote = () => { remoteMain = git('rev-parse', 'HEAD'); };
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('muion-task-tag-')); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, git, create, advanceRemote, remoteTags };
}

test('plan task tag retry is idempotent without creating a test remote tag', t => {
  const f = fixture(t, { failedTagPushes: 1 }); const commit = f.git('rev-parse', 'HEAD');
  const args = { task: 'plan-dashboard-v3', node: 'N1', commit, tag: 't-plan-dashboard-v3-n1-test', message: 'Delivery path repaired', validation: ['node --test tests/task-tag.test.mjs'], evidence: ['10_plans/active/plan_v3.json'] };
  assert.throws(() => f.create(args), /simulated network failure/);
  assert.equal(f.git('rev-parse', args.tag + '^{}'), commit); assert.equal(f.remoteTags.size, 0);
  const retry = f.create(args); const repeat = f.create(args);
  assert.equal(retry.status, 'task-tagged'); assert.equal(repeat.status, 'task-tagged-idempotent');
  assert.equal(retry.remote_tag, commit); assert.equal(f.remoteTags.size, 1);
  assert.equal(f.git('cat-file', '-t', 'refs/tags/' + args.tag), 'tag');
  assert.match(f.git('cat-file', 'tag', args.tag), /计划节点：N1/);
  assert.match(f.git('cat-file', 'tag', args.tag), /验证：node --test tests\/task-tag.test.mjs/);
});

test('an existing task tag pointing at another commit is never moved', t => {
  const f = fixture(t); const firstCommit = f.git('rev-parse', 'HEAD');
  const args = { task: 'plan-dashboard-v3', node: 'N1', commit: firstCommit, tag: 't-plan-dashboard-v3-n1-conflict' };
  f.create(args);
  fs.writeFileSync(path.join(f.root, 'README.md'), 'second\n'); f.git('add', 'README.md'); f.git('commit', '-m', 'second');
  const secondCommit = f.git('rev-parse', 'HEAD'); f.advanceRemote();
  assert.throws(() => f.create({ ...args, commit: secondCommit }), /different commit|refusing to move/i);
  assert.equal(f.git('rev-parse', args.tag + '^{}'), firstCommit); assert.equal(f.remoteTags.get(args.tag).commit, firstCommit);
});
