import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs, projectRootFromHere, runGit, ensureDirectory, sha256File, relativePath, jsonWrite, nowIso } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const localCommit = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
const snapshotId = args.snapshot_id || `SNAPSHOT-${localCommit.slice(0, 12)}`;
const drivePath = args.drive_path || `H:\\我的云端硬盘\\muIon_archive\\project-management\\project-snapshots\\${snapshotId}`;
const tracked = runGit(root, ['ls-files']).stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const extras = ['00_project/traceability/index.sqlite', '_work/cache/cache-index.sqlite'].filter((item) => fs.existsSync(path.join(root, item)));
const sourcePaths = [...new Set([...tracked, ...extras])].filter((item) => !item.startsWith('.git/') && !item.startsWith('_work/temporary-output/') && !item.startsWith('00_project/traceability/sync-states/'));
const copied = [];
const errors = [];
for (const relative of sourcePaths) {
  const source = path.join(root, relative);
  const target = path.join(drivePath, relative);
  try {
    ensureDirectory(path.dirname(target));
    if (fs.existsSync(target) && sha256File(target) !== sha256File(source)) throw new Error('existing Drive file differs');
    if (!fs.existsSync(target)) fs.copyFileSync(source, target);
    const sourceHash = sha256File(source);
    const targetHash = sha256File(target);
    copied.push({ path: relative.replaceAll('\\', '/'), size: fs.statSync(source).size, sha256: sourceHash, verified: sourceHash === targetHash });
    if (sourceHash !== targetHash) errors.push(`${relative}: SHA256 mismatch`);
  } catch (error) { errors.push(`${relative}: ${error.message}`); }
}
const remoteLine = runGit(root, ['ls-remote', 'origin', 'refs/heads/main'], { allowFailure: true });
const remoteCommit = remoteLine.status === 0 ? remoteLine.stdout.trim().split(/\s+/)[0] || null : null;
const tag = args.tag || null;
let tagCommit = null;
let tagVerified = tag === null;
if (tag) {
  const tagLine = runGit(root, ['ls-remote', 'origin', `refs/tags/${tag}^{}`], { allowFailure: true });
  tagCommit = tagLine.status === 0 ? tagLine.stdout.trim().split(/\s+/)[0] || null : null;
  tagVerified = Boolean(tagCommit) && (tagCommit === localCommit || runGit(root, ['merge-base', '--is-ancestor', tagCommit, localCommit], { allowFailure: true }).status === 0);
}
const fileListHash = crypto.createHash('sha256').update(JSON.stringify(copied)).digest('hex');
const status = errors.length ? 'pending-drive' : remoteCommit === localCommit && tagVerified ? 'three-way-verified' : 'pending-verification';
const state = { sync_id: `SYNC-${snapshotId}`, manifest_type: 'sync-state', schema_version: '1.0.0', created_at: nowIso(), task_id: args.task_id || null, run_id: null, snapshot_id: snapshotId, local_commit: localCommit, gitee_remote_commit: remoteCommit, gitee_tag: tag, gitee_tag_commit: tagCommit, drive_path: drivePath, manifest_sha256: fileListHash, status, pending_actions: status === 'three-way-verified' ? [] : ['verify-project-snapshot'], file_count: copied.length, files: copied, errors };
const stateDir = path.join(root, '00_project/traceability/sync-states');
ensureDirectory(stateDir);
const statePath = path.join(stateDir, `${state.sync_id}.json`);
jsonWrite(statePath, state);
if (status !== 'pending-drive' || fs.existsSync(drivePath)) {
  try { jsonWrite(path.join(drivePath, 'sync-state.json'), state); } catch (error) { state.errors.push(`sync-state: ${error.message}`); }
}
if (status !== 'three-way-verified') jsonWrite(path.join(root, '00_project/traceability/sync-outbox', `${state.sync_id}.json`), state);
console.log(JSON.stringify({ state: statePath, status, snapshot_id: snapshotId, local_commit: localCommit, gitee_remote_commit: remoteCommit, tag, drive_path: drivePath, file_count: copied.length, errors: state.errors }, null, 2));
process.exitCode = status === 'three-way-verified' ? 0 : 2;
