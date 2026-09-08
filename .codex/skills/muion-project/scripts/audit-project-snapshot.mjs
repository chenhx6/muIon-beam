import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs, projectRootFromHere, runGit, sha256File, isPathInside } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const drivePath = args.drive_path;
if (!drivePath) throw new Error('provide --drive-path');
const localCommit = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
const remoteLine = runGit(root, ['ls-remote', 'origin', 'refs/heads/main'], { allowFailure: true });
const remoteCommit = remoteLine.status === 0 ? remoteLine.stdout.trim().split(/\s+/)[0] || null : null;
const tracked = runGit(root, ['ls-files', '-z']).stdout.split('\0').filter((item) => item && !item.startsWith('_work/temporary-output/') && !item.startsWith('00_project/traceability/sync-states/') && !item.startsWith('00_project/traceability/sync-outbox/'));
const errors = [];
const statePath = path.join(drivePath, 'sync-state.json');
let stateValid = false;
let fileCount = 0;
let driveStateRecord = null;
try {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  driveStateRecord = state;
  const files = state.files;
  if (!Array.isArray(files) || !files.length || files.length !== state.file_count) throw new Error('invalid snapshot file list/count');
  if (crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex') !== state.manifest_sha256) throw new Error('snapshot manifest SHA256 mismatch');
  if (state.status !== 'three-way-verified' || !state.verified_at || state.errors?.length || state.pending_actions?.length) throw new Error('snapshot state is not verified');
  if (!state.local_commit || state.gitee_remote_commit !== state.local_commit || runGit(root, ['merge-base', '--is-ancestor', state.local_commit, localCommit], { allowFailure: true }).status !== 0) throw new Error('snapshot commit is not verified history');
  const snapshotCommit = state.snapshot_commit || state.local_commit;
  if (snapshotCommit !== state.local_commit) throw new Error('snapshot_commit does not match sync-state local_commit');
  if (state.metadata_commit && runGit(root, ['merge-base', '--is-ancestor', state.metadata_commit, localCommit], { allowFailure: true }).status !== 0) throw new Error('metadata commit is not verified history');
  if (state.gitee_tag) {
    const tagResult = runGit(root, ['ls-remote', 'origin', `refs/tags/${state.gitee_tag}^{}`], { allowFailure: true });
    const tagCommit = tagResult.status === 0 ? tagResult.stdout.trim().split(/\s+/)[0] : null;
    if (!tagCommit || tagCommit !== state.gitee_tag_commit || runGit(root, ['merge-base', '--is-ancestor', tagCommit, state.local_commit], { allowFailure: true }).status !== 0) throw new Error('snapshot tag verification failed');
  }
  const seen = new Set();
  for (const file of files) {
    if (!file.path || path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes('..') || !isPathInside(path.join(root, file.path), root) || !isPathInside(path.join(drivePath, file.path), drivePath) || seen.has(file.path)) throw new Error('invalid or duplicate snapshot path');
    seen.add(file.path);
    const local = path.join(root, file.path);
    const archived = path.join(drivePath, file.path);
    try {
      if (fs.statSync(local).size !== file.size || sha256File(local) !== file.sha256) errors.push(`${file.path}: local differs from snapshot`);
      if (fs.statSync(archived).size !== file.size || sha256File(archived) !== file.sha256) errors.push(`${file.path}: Drive differs from snapshot`);
    } catch (error) { errors.push(`${file.path}: ${error.code || error.message}`); }
    fileCount += 1;
  }
  for (const file of tracked) if (!seen.has(file)) errors.push(`${file}: missing from snapshot manifest`);
  stateValid = true;
} catch (error) {
  errors.push(`sync-state: ${error.code || error.message}`);
}
const reference = (() => { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')).gitee_tag ? 'tag' : 'branch'; } catch { return null; } })();
const localSyncFiles = fs.existsSync(path.join(root, '00_project/traceability/sync-states')) ? fs.readdirSync(path.join(root, '00_project/traceability/sync-states')).filter((name) => name.endsWith('.json')) : [];
let metadataRecord = null;
for (const name of localSyncFiles) {
  try {
    const candidate = JSON.parse(fs.readFileSync(path.join(root, '00_project/traceability/sync-states', name), 'utf8'));
    if (candidate.snapshot_id && candidate.snapshot_id === driveStateRecord?.snapshot_id && candidate.metadata_commit) metadataRecord = candidate;
  } catch {}
}
if (metadataRecord?.metadata_commit && runGit(root, ['merge-base', '--is-ancestor', metadataRecord.metadata_commit, localCommit], { allowFailure: true }).status !== 0) errors.push('metadata commit is not verified history');
const result = { read_only: true, drive_path: drivePath, local_commit: localCommit, gitee_remote_commit: remoteCommit, snapshot_commit: driveStateRecord?.snapshot_commit || driveStateRecord?.local_commit || null, metadata_commit: metadataRecord?.metadata_commit || driveStateRecord?.metadata_commit || null, tracked_files_checked: tracked.length, snapshot_files_checked: fileCount, mismatches: errors, drive_state_verified: stateValid, reference, status: remoteCommit === localCommit && errors.length === 0 && stateValid ? 'three-way-verified' : 'drift-detected' };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === 'three-way-verified' ? 0 : 2;
