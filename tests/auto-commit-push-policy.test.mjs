import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { beginSession } from '../.codex/skills/team/scripts/session-concurrency.mjs';

const project = path.resolve(import.meta.dirname, '..');
const cli = path.join(project, '.codex/skills/muion-project/scripts/auto-commit-push.mjs');
function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout.trim();
}
function put(root, file, value) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), value);
}
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-auto-publish-'));
  const root = path.join(base, 'repo'); const remote = path.join(base, 'remote.git');
  fs.mkdirSync(root); fs.mkdirSync(remote);
  t.after(() => {
    assert.equal(path.dirname(path.resolve(base)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(base).startsWith('muion-auto-publish-'));
    fs.rmSync(base, { recursive: true, force: true });
  });
  git(root, 'init', '-b', 'main'); git(remote, 'init', '--bare', '-b', 'main');
  git(root, 'config', 'user.name', 'test'); git(root, 'config', 'user.email', 'test@example.invalid');
  for (const name of ['delivery-policy.json', 'publish-policy.json']) put(root, `00_project/config/${name}`, fs.readFileSync(path.join(project, '00_project/config', name)));
  put(root, '.gitignore', '_work/\n');
  put(root, 'tests/architecture-smoke.mjs', 'process.exit(0);\n');
  put(root, 'README.md', 'base\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'base'); git(root, 'remote', 'add', 'origin', remote); git(root, 'push', 'origin', 'main');
  const initial = git(root, 'rev-parse', 'HEAD');
  const run = (...args) => spawnSync(process.execPath, [cli, '--project-root', root, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  return { root, remote, initial, run };
}

test('worker checkpoints model sources without pushing main', t => {
  const f = fixture(t); const s = beginSession({ root: f.root, sessionId: 'writer', ownedPaths: ['02_models/'] });
  put(s.worktree_path, '02_models/model.py', 'print(1)\n');
  const r = f.run('--session-id', s.session_id);
  assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).status, 'session-checkpoint-created');
  assert.equal(git(f.remote, 'rev-parse', 'main'), f.initial);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.initial);
  assert.match(git(s.worktree_path, 'show', 'HEAD:02_models/model.py'), /print/);
});

test('worker refuses a mixed source and binary checkpoint before committing', t => {
  const f = fixture(t); const s = beginSession({ root: f.root, sessionId: 'writer', ownedPaths: ['02_models/'] });
  put(s.worktree_path, '02_models/model.py', 'print(1)\n'); put(s.worktree_path, '02_models/model.mph', 'binary');
  const r = f.run('--session-id', s.session_id);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /checkpoint rejected by delivery policy/);
  assert.equal(git(s.worktree_path, 'rev-parse', 'HEAD'), f.initial);
  assert.equal(fs.readFileSync(path.join(s.worktree_path, '02_models/model.mph'), 'utf8'), 'binary');
});

test('leader publishes eligible sources and preserves unrelated staged baseline content', t => {
  const f = fixture(t);
  put(f.root, 'README.md', 'user change\n'); git(f.root, 'add', 'README.md');
  put(f.root, '_work/baseline.json', JSON.stringify({ paths: ['README.md'] }));
  put(f.root, '02_models/model.java', 'class Model {}\n'); put(f.root, '02_models/model.root', 'payload');
  const r = f.run('--baseline', '_work/baseline.json');
  assert.equal(r.status, 0, r.stderr); const result = JSON.parse(r.stdout);
  assert.equal(result.status, 'committed-and-pushed'); assert.deepEqual(result.candidates, ['02_models/model.java']);
  assert.equal(git(f.root, 'show', 'HEAD:README.md'), 'base');
  assert.equal(git(f.root, 'show', ':README.md'), 'user change');
  assert.equal(git(f.remote, 'rev-parse', 'main'), result.commit);
  assert.equal(fs.readFileSync(path.join(f.root, '02_models/model.root'), 'utf8'), 'payload');
});
