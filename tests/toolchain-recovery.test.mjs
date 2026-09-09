import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensurePackage, discoverPackage, writeRecovery } from '../.codex/skills/muion-project/scripts/ensure-toolchain.mjs';

test('toolchain recovery reuses an explicitly provided installed Python package', () => {
  const python = process.env.MUION_TEST_PYTHON;
  if (!python || !fs.existsSync(python)) return;
  const result = ensurePackage('PyYAML', { python, root: fs.mkdtempSync(path.join(os.tmpdir(), 'muion-toolchain-')) });
  assert.equal(result.status, 'available');
  assert.equal(result.selected.version, '6.0.3');
});

test('toolchain recovery rejects packages outside the allowlist', () => {
  assert.throws(() => discoverPackage('unknown-package'), /not allowlisted/);
});

test('toolchain recovery records user installation versus assistant verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-toolchain-record-'));
  const result = writeRecovery(root, { recovery_id: 'REC-test', package: 'PyYAML', performed_by: 'assistant-verified-user-installation', install_performed_by_assistant: false, retry_result: 'passed' });
  assert.equal(JSON.parse(fs.readFileSync(result.file, 'utf8')).install_performed_by_assistant, false);
});
