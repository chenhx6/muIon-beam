import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { beginSession } from '../.codex/skills/team/scripts/session-concurrency.mjs';
import { integratePrepared } from '../11_tools/project-supervisor/integration-coordinator.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-integration-')); t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr || r.stdout); };
  git('init', '-b', 'main'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.invalid'); fs.writeFileSync(path.join(root, '.gitignore'), '_work/\n'); fs.writeFileSync(path.join(root, 'a.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'base'); return { root, git };
}
test('clean worker is submitted and integrated under the leader gate', t => {
  const f = fixture(t); const session = beginSession({ root: f.root, sessionId: 'worker', ownedPaths: ['a.txt'] });
  fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'worker\n');
  f.git('-C', session.worktree_path, 'add', 'a.txt'); f.git('-C', session.worktree_path, 'commit', '-m', 'worker change');
  const result = integratePrepared({ root: f.root, sessionId: session.session_id });
  assert.equal(result.status, 'integrated'); assert.equal(fs.readFileSync(path.join(f.root, 'a.txt'), 'utf8').replaceAll('\r\n','\n'), 'worker\n');
});
test('leader conflict preserves the worker branch and records a blocked receipt', t => {
  const f = fixture(t); const session = beginSession({ root: f.root, sessionId: 'worker', ownedPaths: ['a.txt'] });
  fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'worker\n'); f.git('-C', session.worktree_path, 'add', 'a.txt'); f.git('-C', session.worktree_path, 'commit', '-m', 'worker change');
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'leader\n'); f.git('add', 'a.txt'); f.git('commit', '-m', 'leader change');
  const result = integratePrepared({ root: f.root, sessionId: session.session_id });
  assert.equal(result.status, 'blocked-conflict'); assert.ok(result.conflicts.includes('a.txt')); assert.equal(fs.readFileSync(path.join(session.worktree_path, 'a.txt'), 'utf8').replaceAll('\r\n','\n'), 'worker\n');
});
test('dirty leader is blocked before integration and worker remains untouched', t => {
  const f = fixture(t); const session = beginSession({ root: f.root, sessionId: 'worker', ownedPaths: ['a.txt'] });
  fs.writeFileSync(path.join(session.worktree_path, 'a.txt'), 'worker\n'); f.git('-C', session.worktree_path, 'add', 'a.txt'); f.git('-C', session.worktree_path, 'commit', '-m', 'worker change');
  fs.writeFileSync(path.join(f.root, 'leader-note.txt'), 'keep\n'); const result = integratePrepared({ root: f.root, sessionId: session.session_id });
  assert.equal(result.status, 'blocked-dirty-leader'); assert.equal(fs.readFileSync(path.join(session.worktree_path, 'a.txt'), 'utf8').replaceAll('\r\n','\n'), 'worker\n');
});
