import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, walkFiles } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const outbox = path.resolve(args.outbox || path.join(root, '00_project/traceability/sync-outbox'));
const script = path.join(import.meta.dirname, 'sync-three-end.mjs');
const results = [];
for (const file of walkFiles(outbox, { ignoredDirectories: ['.git'] }).filter((item) => item.endsWith('.json'))) {
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { results.push({ file, status: 'invalid', error: error.message }); continue; }
  const runDir = path.join(root, '03_runs/formal', state.run_id || 'RUN-UNKNOWN');
  const commandArgs = [script, '--run-dir', runDir, '--run-id', state.run_id || path.basename(runDir), '--task-id', state.task_id || '', '--tag', state.gitee_tag || '', '--drive-path', state.drive_path || ''];
  const result = spawnSync(process.execPath, commandArgs, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const success = result.status === 0;
  if (success) fs.rmSync(file, { force: true });
  results.push({ file, status: success ? 'retried-and-cleared' : 'still-pending', output: result.stdout, error: result.stderr });
}
console.log(JSON.stringify({ outbox, results, retried: results.length, cleared: results.filter((item) => item.status === 'retried-and-cleared').length }, null, 2));
