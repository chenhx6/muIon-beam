import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDriveMirrorPlan } from '../.codex/skills/muion-project/scripts/drive-mirror-plan.mjs';

test('Drive mirror plan follows local relative paths and excludes runtime data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-drive-mirror-')); const drive = path.join(os.tmpdir(), `muion-drive-plan-target-${path.basename(root)}`);
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(drive, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, '.codex'), { recursive: true }); fs.mkdirSync(path.join(root, '02_models'), { recursive: true }); fs.mkdirSync(path.join(root, '_work/cache'), { recursive: true }); fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'rules\n'); fs.writeFileSync(path.join(root, '.codex/hooks.json'), '{}\n'); fs.writeFileSync(path.join(root, '02_models/model.py'), 'print(1)\n'); fs.writeFileSync(path.join(root, '_work/cache/x.txt'), 'cache\n'); fs.writeFileSync(path.join(root, 'build/out.txt'), 'build\n');
  const plan = buildDriveMirrorPlan(root, { driveRoot: drive, policy: {
    include_prefixes: [''],
    include_files: [],
    exclude_directory_names: ['.git', '_work', 'node_modules', '__pycache__', '.pytest_cache', 'build', 'dist', 'cache', 'logs', 'outbox'],
    exclude_extensions: ['.tmp', '.lock', '.recover', '.autosave', '.bak'],
    cloud_status: 'unverified'
  } });
  assert.ok(plan.entries.some(item => item.path === 'AGENTS.md' && item.target === path.join(drive, 'AGENTS.md')));
  assert.ok(plan.entries.some(item => item.path === '02_models/model.py'));
  assert.equal(plan.entries.some(item => item.path.startsWith('_work/')), false); assert.equal(plan.entries.some(item => item.path.startsWith('build/')), false); assert.equal(plan.cleanup, 'blocked-until-cloud-visible-and-copy-verified');
});
