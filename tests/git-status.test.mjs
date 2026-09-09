import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitStatusEntries } from '../.codex/skills/muion-project/scripts/project-utils.mjs';

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('Git status parser returns the destination path for a rename', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-git-status-'));
  fs.writeFileSync(path.join(root, 'old.txt'), 'content\n');
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  git(root, 'mv', 'old.txt', 'new.txt');
  const [entry] = gitStatusEntries(root);
  assert.match(entry.status, /R/);
  assert.equal(entry.path, 'new.txt');
  assert.equal(entry.old_path, 'old.txt');
});
