import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, runGit } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
for (const required of ['tag', 'base_tag', 'message_file', 'run_dir', 'drive_path']) if (!args[required]) throw new Error(`publish-and-sync requires --${required.replaceAll('_', '-')}`);
const publishScript = path.join(import.meta.dirname, 'publish-gitee.mjs');
const syncScript = path.join(import.meta.dirname, 'sync-three-end.mjs');
const publishArgs = [publishScript, '--tag', args.tag, '--base-tag', args.base_tag, '--message-file', path.resolve(args.message_file), '--push'];
if (args.allow_dirty) publishArgs.push('--allow-dirty');
const published = spawnSync(process.execPath, publishArgs, { cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
if (published.status !== 0) throw new Error(`publish failed: ${published.stderr || published.stdout}`);
const synced = spawnSync(process.execPath, [syncScript, '--run-dir', path.resolve(args.run_dir), '--run-id', args.run_id || path.basename(path.resolve(args.run_dir)), '--task-id', args.task_id || '', '--tag', args.tag, '--drive-path', args.drive_path], { cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
if (synced.status !== 0 && synced.status !== 2) throw new Error(`sync failed: ${synced.stderr || synced.stdout}`);
const status = runGit(root, ['status', '--porcelain']).stdout.trim();
if (status) {
  runGit(root, ['add', '00_project/traceability/sync-states', '00_project/traceability/sync-outbox']);
  const commit = runGit(root, ['-c', 'user.name=Codex', '-c', 'user.email=codex@local', 'commit', '-m', `记录三端同步 ${args.tag}`], { allowFailure: true });
  if (commit.status !== 0 && !/nothing to commit/i.test(commit.stdout || '')) throw new Error(`sync-state commit failed: ${commit.stderr || commit.stdout}`);
  runGit(root, ['push', 'origin', 'HEAD:main'], { timeout: 120000 });
}
console.log(JSON.stringify({ published: JSON.parse(published.stdout), synced: synced.stdout ? JSON.parse(synced.stdout) : null, sync_commit_pushed: Boolean(status) }, null, 2));
