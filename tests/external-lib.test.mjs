import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyPaths } from '../.codex/skills/muion-project/scripts/delivery-plan.mjs';

const project = path.resolve(import.meta.dirname, '..');
const script = path.join(project, '.codex/skills/muion-project/scripts/external-lib-sync.mjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-external-lib-'));
  const library = path.join(root, '06_external_lib', 'reference-book');
  const drive = path.join(root, 'drive');
  fs.mkdirSync(library, { recursive: true });
  fs.writeFileSync(path.join(library, 'README.md'), 'reference book\n');
  fs.writeFileSync(path.join(library, 'payload.txt'), 'payload\n');
  fs.writeFileSync(path.join(library, 'portable.exe'), 'binary\n');
  return { root, library, drive };
}

function run(f, args = []) {
  return spawnSync(process.execPath, [script, '--project-root', f.root, '--drive-root', f.drive, '--no-publish', '--allow-pending', ...args], { encoding: 'utf8', timeout: 30000 });
}

function output(result) {
  assert.equal(result.stdout.trim().length > 0, true, result.stderr);
  return JSON.parse(result.stdout);
}

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
}

test('external library sync archives all files and classifies binaries as Drive-only', () => {
  const f = fixture();
  const result = output(run(f, ['--event', 'test-bootstrap']));
  assert.equal(result.status, 'pending-gitee');
  assert.equal(result.drive[0].status, 'verified');
  assert.equal(result.drive[0].file_count, 3);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, '06_external_lib/library-manifest.json')));
  const library = manifest.libraries.find((item) => item.id === 'reference-book');
  assert.equal(library.file_count, 3);
  assert.equal(library.gitee_file_count, 2);
  assert.equal(library.drive_only_file_count, 1);
  const archiveManifest = JSON.parse(fs.readFileSync(path.join(f.drive, 'reference-book', library.content_sha256, 'archive-manifest.json')));
  assert.equal(archiveManifest.file_count, 3);
  assert.equal(archiveManifest.content_sha256, library.content_sha256);
  const checked = output(run(f, ['--check']));
  assert.equal(checked.changed, false);
});

test('external library sync reports file modifications and deletions', () => {
  const f = fixture();
  output(run(f, ['--event', 'test-bootstrap']));
  fs.appendFileSync(path.join(f.library, 'payload.txt'), 'changed\n');
  let checked = output(run(f, ['--check']));
  assert.ok(checked.changes.some((item) => item.type === 'file-modified' && item.path === 'payload.txt'));
  fs.rmSync(path.join(f.library, 'payload.txt'));
  checked = output(run(f, ['--check']));
  assert.ok(checked.changes.some((item) => item.type === 'file-deleted' && item.path === 'payload.txt'));
  fs.rmSync(f.library, { recursive: true, force: true });
  checked = output(run(f, ['--check']));
  assert.ok(checked.changes.some((item) => item.type === 'deleted' && item.library_id === 'reference-book'));
});

test('delivery policy admits external reference sources but excludes portable binaries', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(project, '00_project/config/delivery-policy.json')));
  assert.ok(policy.gitee.allow_prefixes.includes('06_external_lib/'));
  for (const extension of ['.exe', '.dll', '.pyd', '.pyc']) assert.ok(policy.gitee.deny_extensions.includes(extension));
  const plan = classifyPaths(project, policy, { paths: [] });
  assert.ok(plan.candidates.every((item) => !item.toLowerCase().endsWith('.exe')));
});

test('task begin keeps external library outside the generic baseline', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, 'README.md'), 'fixture\n');
  git(f.root, 'init', '-b', 'main');
  git(f.root, 'config', 'user.name', 'External Library Test');
  git(f.root, 'config', 'user.email', 'external-library@example.invalid');
  git(f.root, 'add', 'README.md');
  git(f.root, 'commit', '-m', 'fixture');
  const begin = spawnSync(process.execPath, [path.join(project, '.codex/skills/muion-project/scripts/begin-task.mjs'), f.root], { cwd: project, encoding: 'utf8', timeout: 30000, env: { ...process.env, MUION_EXTERNAL_LIB_DRIVE_ROOT: f.drive } });
  assert.equal(begin.status, 0, begin.stderr);
  const baseline = JSON.parse(fs.readFileSync(path.join(f.root, '00_project/state/task-baseline.json')));
  assert.ok(!baseline.paths.some((item) => item.startsWith('06_external_lib/')));
  assert.ok(baseline.external_library_sync);
});
