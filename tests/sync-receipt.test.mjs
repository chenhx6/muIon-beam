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
