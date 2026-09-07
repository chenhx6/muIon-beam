import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, projectRootFromHere, runGit, sha256File } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const drivePath = args.drive_path;
if (!drivePath) throw new Error('provide --drive-path');
const localCommit = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
const remoteLine = runGit(root, ['ls-remote', 'origin', 'refs/heads/main'], { allowFailure: true });
const remoteCommit = remoteLine.status === 0 ? remoteLine.stdout.trim().split(/\s+/)[0] || null : null;
const tracked = runGit(root, ['ls-files']).stdout.split(/\r?\n/).map((item) => item.trim()).filter((item) => item && !item.startsWith('_work/temporary-output/'));
const errors = [];
for (const relative of tracked) {
  const local = path.join(root, relative);
  const remote = path.join(drivePath, relative);
  if (!fs.existsSync(remote)) errors.push(`${relative}: missing`);
  else if (sha256File(local) !== sha256File(remote)) errors.push(`${relative}: SHA256 mismatch`);
}
const statePath = path.join(drivePath, 'sync-state.json');
let stateValid = false;
if (fs.existsSync(statePath)) {
  try { const state = JSON.parse(fs.readFileSync(statePath, 'utf8')); stateValid = state.local_commit && runGit(root, ['merge-base', '--is-ancestor', state.local_commit, localCommit], { allowFailure: true }).status === 0; } catch { stateValid = false; }
}
const result = { read_only: true, drive_path: drivePath, local_commit: localCommit, gitee_remote_commit: remoteCommit, tracked_files_checked: tracked.length, mismatches: errors, drive_state_verified: stateValid, status: remoteCommit === localCommit && errors.length === 0 && stateValid ? 'three-way-verified' : 'drift-detected' };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === 'three-way-verified' ? 0 : 2;
