import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('WSL execution policy requires elevated first call and forbids sandbox probes', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, '00_project/config/wsl-runtime.json'), 'utf8'));
  assert.deepEqual(config.command_prefix, ['wsl.exe', '-d', 'Ubuntu-20.04']);
  assert.equal(config.execution_policy, 'require_escalated_first_call');
  assert.equal(config.sandboxed_probe_forbidden, true);
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /禁止先用默认 Windows sandbox/);
});
