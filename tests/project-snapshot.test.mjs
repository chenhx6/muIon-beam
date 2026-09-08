import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const project = path.resolve(import.meta.dirname, '..');
const scripts = path.join(project, '.codex/skills/muion-project/scripts');
const scratch = path.join(project, '_work/scratch');
fs.mkdirSync(scratch, { recursive: true });
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture() {
  const base = fs.mkdtempSync(path.join(scratch, 'snapshot-test-'));
  const root = path.join(base, 'project');
  const remote = path.join(base, 'remote.git');
  const drive = path.join(base, 'drive');
  fs.mkdirSync(root); fs.mkdirSync(remote);
  git(remote, 'init', '--bare'); git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Snapshot Test');
  git(root, 'config', 'user.email', 'snapshot@example.invalid');
  fs.writeFileSync(path.join(root, '中文说明.md'), 'fixture only\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '*.sqlite\n00_project/traceability/sync-states/\n00_project/traceability/sync-outbox/\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture');
  git(root, 'tag', '-a', 'r1-test', '-m', 'fixture release');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', 'origin', 'main', 'r1-test');
  fs.mkdirSync(path.join(root, '00_project/traceability'), { recursive: true });
  fs.writeFileSync(path.join(root, '00_project/traceability/index.sqlite'), 'stand-in for hash checks');
  return { root, drive, commit: git(root, 'rev-parse', 'HEAD') };
}
function command(f, script, args = []) {
  return spawnSync(process.execPath, [path.join(scripts, script), '--project-root', f.root, ...args], { encoding: 'utf8', timeout: 30000 });
}
function sync(f, extra = []) {
  return command(f, 'sync-project-snapshot.mjs', ['--snapshot-id', 'SNAPSHOT-test', '--tag', 'r1-test', '--drive-path', f.drive, ...extra]);
}
function audit(f) { return command(f, 'audit-project-snapshot.mjs', ['--drive-path', f.drive]); }

test('snapshot requires explicit tag and committed content before any Drive copy', () => {
  const f = fixture();
  assert.notEqual(command(f, 'sync-project-snapshot.mjs', ['--drive-path', f.drive]).status, 0);
  assert.equal(fs.existsSync(f.drive), false);
  fs.appendFileSync(path.join(f.root, '中文说明.md'), 'dirty\n');
  assert.notEqual(sync(f).status, 0);
  assert.equal(fs.existsSync(f.drive), false);
});

test('verified snapshot includes Unicode paths, SQLite hash, timestamp and remote tag', () => {
  const f = fixture();
  const result = sync(f);
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(f.drive, 'sync-state.json')));
  assert.equal(state.local_commit, f.commit);
  assert.equal(state.gitee_remote_commit, f.commit);
  assert.ok(state.verified_at);
  assert.ok(state.files.some((file) => file.path === '中文说明.md'));
  assert.ok(state.files.some((file) => file.path.endsWith('index.sqlite')));
  assert.equal(fs.existsSync(path.join(f.drive, '.git')), false);
  assert.equal(audit(f).status, 0);
  fs.appendFileSync(path.join(f.drive, '00_project/traceability/index.sqlite'), 'corrupt');
  const failure = audit(f);
  assert.equal(failure.status, 2);
  assert.match(failure.stdout, /index.sqlite: Drive differs/);
});

test('Drive receipt failure stays pending, correct project retry preserves files and clears outbox', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.drive, 'sync-state.json'), { recursive: true });
  const failure = sync(f);
  assert.equal(failure.status, 2, failure.stderr);
  const outbox = path.join(f.root, '00_project/traceability/sync-outbox/SYNC-SNAPSHOT-test.json');
  const state = JSON.parse(fs.readFileSync(outbox));
  assert.equal(state.status, 'pending-drive');
  assert.equal(state.verified_at, null);
  const originalTime = fs.statSync(path.join(f.drive, '中文说明.md')).mtimeMs;
  // Remove only the empty artificial obstruction inside this isolated fixture.
  fs.rmdirSync(path.join(f.drive, 'sync-state.json'));
  const retried = command(f, 'retry-sync-outbox.mjs');
  assert.equal(retried.status, 0, retried.stdout + retried.stderr);
  assert.equal(fs.existsSync(outbox), false);
  assert.equal(fs.statSync(path.join(f.drive, '中文说明.md')).mtimeMs, originalTime);
  assert.equal(audit(f).status, 0);
});

test('retry refuses to put a new commit into an older snapshot', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.drive, 'sync-state.json'), { recursive: true });
  assert.equal(sync(f).status, 2);
  fs.appendFileSync(path.join(f.root, '中文说明.md'), 'new revision');
  git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'new revision');
  const retry = command(f, 'retry-sync-outbox.mjs');
  assert.equal(retry.status, 2);
  assert.match(retry.stdout, /snapshot commit differs/);
  assert.equal(fs.readFileSync(path.join(f.drive, '中文说明.md'), 'utf8'), 'fixture only\n');
});

test('read-only audit rejects forged receipt hashes and missing verification timestamps', () => {
  const f = fixture();
  assert.equal(sync(f).status, 0);
  const receipt = path.join(f.drive, 'sync-state.json');
  const state = JSON.parse(fs.readFileSync(receipt));
  const altered = { ...state, file_count: state.file_count + 1 };
  fs.writeFileSync(receipt, JSON.stringify(altered));
  assert.equal(audit(f).status, 2);
  delete state.verified_at;
  fs.writeFileSync(receipt, JSON.stringify(state));
  const result = audit(f);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /snapshot state is not verified/);
});
