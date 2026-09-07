import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, projectRootFromHere, runGit, walkFiles, sha256File, ensureDirectory, relativePath, jsonWrite, nowIso } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const runDir = path.resolve(args.run_dir || path.join(root, '03_runs/formal', args.run_id || 'RUN-YYYYMMDD-NNN'));
const runId = args.run_id || path.basename(runDir);
const drivePath = args.drive_path || `H:\\我的云端硬盘\\muIon_archive\\simulation-runs\\${runId}`;
if (!fs.existsSync(runDir)) throw new Error(`run directory not found: ${runDir}`);
const sourceFiles = walkFiles(runDir, { ignoredDirectories: ['.git', 'node_modules'] }).filter((file) => !/(\.lock|\.recover|\.tmp|\.bak)$/i.test(file));
const copied = [];
const driveErrors = [];
for (const source of sourceFiles) {
  const relative = relativePath(runDir, source);
  const target = path.join(drivePath, relative);
  try {
    ensureDirectory(path.dirname(target));
    fs.copyFileSync(source, target);
    const sourceHash = sha256File(source);
    const targetHash = sha256File(target);
    copied.push({ relative_path: relative, size: fs.statSync(source).size, sha256: sourceHash, verified: sourceHash === targetHash });
    if (sourceHash !== targetHash) driveErrors.push(`${relative}: SHA256 mismatch`);
  } catch (error) { driveErrors.push(`${relative}: ${error.message}`); }
}
const localCommit = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
const remoteLine = runGit(root, ['ls-remote', 'origin', 'refs/heads/main'], { allowFailure: true });
const remoteCommit = remoteLine.status === 0 ? remoteLine.stdout.trim().split(/\s+/)[0] || null : null;
const tag = args.tag || null;
let tagVerified = tag === null;
let tagCommit = null;
if (tag) {
  const tagLine = runGit(root, ['ls-remote', 'origin', `refs/tags/${tag}^{}`], { allowFailure: true });
  const fallback = tagLine.status === 0 ? tagLine.stdout.trim().split(/\s+/)[0] || null : null;
  tagCommit = fallback;
  const ancestor = tagCommit ? runGit(root, ['merge-base', '--is-ancestor', tagCommit, localCommit], { allowFailure: true }).status === 0 : false;
  tagVerified = tagCommit === localCommit || ancestor;
}
const manifestFile = ['run-manifest.json', 'run-manifest.yaml', 'migration-manifest.json'].map((name) => path.join(runDir, name)).find((file) => fs.existsSync(file));
const manifestSha256 = manifestFile ? sha256File(manifestFile) : null;
const driveVerified = driveErrors.length === 0 && copied.length === sourceFiles.length;
const status = driveVerified && remoteCommit === localCommit && tagVerified ? 'three-way-verified' : !driveVerified ? 'pending-drive' : remoteCommit !== localCommit ? 'pending-gitee' : 'pending-verification';
const syncId = `SYNC-${runId}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const state = { sync_id: syncId, manifest_type: 'sync-state', schema_version: '1.0.0', created_at: nowIso(), task_id: args.task_id || null, run_id: runId, local_commit: localCommit, gitee_remote_commit: remoteCommit, gitee_tag: tag, gitee_tag_commit: tagCommit, drive_path: drivePath, manifest_sha256: manifestSha256, status, pending_actions: status === 'three-way-verified' ? [] : [!driveVerified ? 'verify-drive-archive' : null, remoteCommit !== localCommit ? 'publish-gitee-main' : null, !tagVerified ? 'publish-gitee-tag' : null].filter(Boolean), file_count: copied.length, files: copied, errors: driveErrors };
const stateDir = path.join(root, '00_project/traceability/sync-states');
ensureDirectory(stateDir);
const statePath = path.join(stateDir, `${syncId}.json`);
jsonWrite(statePath, state);
if (status !== 'three-way-verified') jsonWrite(path.join(root, '00_project/traceability/sync-outbox', `${syncId}.json`), state);
console.log(JSON.stringify({ state: statePath, status, local_commit: localCommit, gitee_remote_commit: remoteCommit, tag, drive_path: drivePath, file_count: copied.length, errors: driveErrors }, null, 2));
process.exitCode = status === 'three-way-verified' ? 0 : 2;
