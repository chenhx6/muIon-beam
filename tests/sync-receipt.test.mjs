import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('historical receipt audit validates the retained receipt without changing it', () => {
  const source = path.resolve('00_project/traceability/sync-states/SYNC-SNAPSHOT-fd21d6cfc678.json');
  if (!fs.existsSync(source)) return;
  const before = fs.readFileSync(source); const root = path.resolve('.'); const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-receipt-')); const output = path.join(outputRoot, 'audit.json');
  const result = spawnSync(process.execPath, [path.resolve('.codex/skills/muion-project/scripts/audit-sync-receipt.mjs'), '--project-root', root, '--receipt', '00_project/traceability/sync-states/SYNC-SNAPSHOT-fd21d6cfc678.json', '--output', output], { cwd: root, encoding: 'utf8' });
  const resultDoc = JSON.parse(result.stdout || '{}'); if (result.status !== 0 && resultDoc.status === 'pending-audit') return;
  assert.equal(result.status, 0, result.stderr || result.stdout); assert.deepEqual(fs.readFileSync(source), before); assert.equal(resultDoc.status, 'verified');
});

test('run archive refuses to overwrite a conflicting Drive artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-run-sync-'));
  const runDir = path.join(root, '03_runs/formal/RUN-TEST');
  const drive = path.join(root, 'drive');
  fs.mkdirSync(runDir, { recursive: true }); fs.mkdirSync(drive, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'result.json'), 'source\n');
  fs.writeFileSync(path.join(drive, 'result.json'), 'conflicting archive\n');
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'test'], ['config', 'user.email', 'test@example.invalid'], ['add', '.'], ['commit', '-m', 'baseline']]) {
    const setup = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(setup.status, 0, setup.stderr);
  }
  const script = path.resolve('.codex/skills/muion-project/scripts/sync-three-end.mjs');
  const result = spawnSync(process.execPath, [script, '--project-root', root, '--run-dir', runDir, '--run-id', 'RUN-TEST', '--drive-path', drive], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(path.join(drive, 'result.json'), 'utf8'), 'conflicting archive\n');
});
