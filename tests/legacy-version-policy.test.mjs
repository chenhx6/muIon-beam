import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyLegacyMigration } from '../.codex/skills/muion-project/scripts/verify-legacy-migration.mjs';
import { sha256File, isPathInside } from '../.codex/skills/muion-project/scripts/project-utils.mjs';

const project = path.resolve(import.meta.dirname, '..');
const scratch = path.join(project, '_work/scratch');
function fixture(callback) {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'legacy-policy-test-'));
  try {
    const source = path.join(root, 'source.txt');
    const target = path.join(root, 'retained.txt');
    const drive = path.join(root, 'archive.txt');
    for (const f of [source, target, drive]) fs.writeFileSync(f, 'baseline-A');
    const hash = sha256File(source);
    const manifestPath = path.join(root, 'migration.json');
    const manifest = { copy_only: true, preserve_source: true, files: [
      { legacy_source_path: source, destination_path: 'retained.txt', legacy_source_sha256: hash,
        drive_path: drive, drive_status: 'unavailable' }
    ] };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const decision = { decision_id: 'TEST-KEEP-BASELINE', decision: 'keep-original-migrated-version',
      overall_migration_status: 'awaiting-legacy-phase-completion', migration_manifest: 'migration.json',
      files: [{ destination_path: 'retained.txt', retained_sha256: hash }] };
    callback({ root, source, target, drive, hash, manifest, manifestPath, decision });
  } finally {
    assert.ok(isPathInside(root, scratch) && root !== scratch);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test('retained copies are checked even when Drive status is stale', () => fixture((f) => {
  const result = verifyLegacyMigration(f.root, f.manifestPath, f.decision);
  assert.equal(result.valid, true);
  assert.equal(result.drive_files_verified, 1);
  assert.equal(result.migration_complete, false);
}));
test('active source edits are reported without modifying or adopting the baseline', () => fixture((f) => {
  fs.writeFileSync(f.source, 'ongoing-source-B');
  const before = [f.source, f.target, f.drive, f.manifestPath].map(sha256File);
  const result = verifyLegacyMigration(f.root, f.manifestPath, f.decision);
  assert.equal(result.valid, true);
  assert.equal(result.source_changes[0].disposition, 'not-adopted');
  assert.equal(result.source_matches_migration_hash, false);
  assert.equal(result.overall_migration_status, 'awaiting-legacy-phase-completion');
  assert.deepEqual([f.source, f.target, f.drive, f.manifestPath].map(sha256File), before);
}));
test('keep decision never hides local or archived copy corruption', () => fixture((f) => {
  fs.writeFileSync(f.source, 'new source');
  fs.writeFileSync(f.target, 'corrupt local');
  fs.writeFileSync(f.drive, 'corrupt archive');
  const result = verifyLegacyMigration(f.root, f.manifestPath, f.decision);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((s) => s.startsWith('retained copy mismatch:')));
  assert.ok(result.errors.some((s) => s.startsWith('Drive copy mismatch:')));
}));
test('an unapproved or unrelated decision does not silently waive source drift', () => fixture((f) => {
  fs.writeFileSync(f.source, 'new source');
  assert.equal(verifyLegacyMigration(f.root, f.manifestPath).valid, false);
  assert.equal(verifyLegacyMigration(f.root, f.manifestPath, { ...f.decision, migration_manifest: 'other.json' }).valid, false);
}));
test('empty file lists never pass', () => fixture((f) => {
  fs.writeFileSync(f.manifestPath, JSON.stringify({ ...f.manifest, files: [] }));
  assert.equal(verifyLegacyMigration(f.root, f.manifestPath, f.decision).valid, false);
}));
test('paused migration, smoke regeneration and final sign-off make no changes', () => fixture((f) => {
  const decisions = path.join(f.root, '00_project/decisions');
  fs.mkdirSync(decisions, { recursive: true });
  fs.writeFileSync(path.join(decisions, 'legacy-source-change-decision.json'), JSON.stringify(f.decision));
  const tree = () => fs.readdirSync(f.root, { recursive: true }).filter((s) => fs.statSync(path.join(f.root, s)).isFile()).sort()
    .map((s) => [s, sha256File(path.join(f.root, s))]);
  const before = tree();
  for (const script of ['migrate-legacy-selected.mjs', 'legacy-smoke-test.mjs', 'finalize-legacy-acceptance.mjs']) {
    const result = spawnSync(process.execPath, [path.join(project, '.codex/skills/muion-project/scripts', script), '--project-root', f.root],
      { cwd: f.root, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'awaiting-legacy-phase-completion');
    assert.deepEqual(tree(), before);
  }
}));
test('help returns before mutation, including publish and sync commands', () => fixture((f) => {
  for (const script of ['migrate-legacy-selected.mjs', 'legacy-smoke-test.mjs', 'finalize-legacy-acceptance.mjs',
    'sync-project-snapshot.mjs', 'sync-three-end.mjs', 'publish-and-sync.mjs', 'build-index-sqlite.mjs', 'retry-sync-outbox.mjs']) {
    const result = spawnSync(process.execPath, [path.join(project, '.codex/skills/muion-project/scripts', script), '--help', '--project-root', f.root],
      { cwd: f.root, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
  }
  assert.equal(fs.existsSync(path.join(f.root, '00_project')), false);
}));
