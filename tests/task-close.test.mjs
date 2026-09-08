import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, '.codex/skills/muion-project/scripts/task-close.mjs');

test('task-close status is read-only and reports no request when none exists', () => {
  const result = spawnSync(process.execPath, [script, '--project-root', root, 'status'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.request ?? null, null);
});

test('task-close rejects missing explicit close request', () => {
  const result = spawnSync(process.execPath, [script, '--project-root', root], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /close_requested=true/);
});
