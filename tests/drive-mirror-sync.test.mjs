import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncDriveMirror } from '../.codex/skills/muion-project/scripts/drive-mirror-sync.mjs';

test('Drive mirror copies the local relative tree and verifies each file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-drive-sync-')); const drive = path.join(os.tmpdir(), `muion-drive-target-${path.basename(root)}`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(drive, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, '00_project'), { recursive: true }); fs.mkdirSync(path.join(root, '_work'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'rules\n'); fs.writeFileSync(path.join(root, '00_project/state.json'), '{}\n'); fs.writeFileSync(path.join(root, '_work/runtime.json'), '{}\n');
  const policy = { include_prefixes: [''], include_files: [], exclude_directory_names: ['.git', '_work'], exclude_extensions: [], cloud_status: 'unverified' };
  const first = syncDriveMirror(root, { driveRoot: drive, policy, now: '2026-09-22T00:00:00Z' });
  assert.equal(first.manifest.file_count, 2); assert.equal(first.manifest.copied_count, 2); assert.equal(first.manifest.cleanup_allowed, false);
  assert.equal(fs.readFileSync(path.join(drive, 'AGENTS.md'), 'utf8'), 'rules\n'); assert.equal(fs.existsSync(path.join(drive, '_work')), false);
  const second = syncDriveMirror(root, { driveRoot: drive, policy, now: '2026-09-22T00:01:00Z' });
  assert.equal(second.manifest.reused_count, 2); assert.equal(second.manifest.copied_count, 0);
});
