import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, walkFiles, runGit, jsonWrite, nowIso } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const outbox = path.resolve(args.outbox || path.join(root, '00_project/traceability/sync-outbox'));
const script = path.join(import.meta.dirname, 'sync-three-end.mjs');
const stateDir = path.join(root, '00_project/traceability/sync-states');
const results = [];
for (const file of walkFiles(outbox, { ignoredDirectories: ['.git'] }).filter((item) => item.endsWith('.json'))) {
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { results.push({ file, status: 'invalid', error: error.message }); continue; }
  // A failed project snapshot is superseded when a newer verified snapshot
  // contains a descendant commit. Preserve the failed state in sync-states,
  // then clear only the stale outbox entry.
  if (state.snapshot_id) {
    const newer = walkFiles(stateDir, { ignoredDirectories: ['.git'] })
      .filter((item) => item.endsWith('.json'))
      .map((item) => { try { return { file: item, state: JSON.parse(fs.readFileSync(item, 'utf8')) }; } catch { return null; } })
      .filter((item) => item && item.state.status === 'three-way-verified' && item.state.snapshot_id && item.state.snapshot_id !== state.snapshot_id && item.state.local_commit)
      .find((item) => runGit(root, ['merge-base', '--is-ancestor', state.local_commit, item.state.local_commit], { allowFailure: true }).status === 0);
    if (newer) {
      const superseded = { ...state, status: 'superseded', superseded_by: newer.state.sync_id, superseded_at: nowIso(), pending_actions: [] };
      jsonWrite(path.join(stateDir, path.basename(file)), superseded);
      fs.rmSync(file, { force: true });
      results.push({ file, status: 'superseded', superseded_by: newer.state.sync_id });
      continue;
    }
  }
  const runDir = path.join(root, '03_runs/formal', state.run_id || 'RUN-UNKNOWN');
  const commandArgs = [script, '--run-dir', runDir, '--run-id', state.run_id || path.basename(runDir), '--task-id', state.task_id || '', '--tag', state.gitee_tag || '', '--drive-path', state.drive_path || ''];
  const result = spawnSync(process.execPath, commandArgs, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const success = result.status === 0;
  if (success) fs.rmSync(file, { force: true });
  results.push({ file, status: success ? 'retried-and-cleared' : 'still-pending', output: result.stdout, error: result.stderr });
}
console.log(JSON.stringify({ outbox, results, retried: results.length, cleared: results.filter((item) => item.status === 'retried-and-cleared').length }, null, 2));
