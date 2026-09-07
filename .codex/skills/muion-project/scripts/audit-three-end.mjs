import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, projectRootFromHere, runGit, walkFiles, sha256File, relativePath } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const runDir = path.resolve(args.run_dir || path.join(root, '03_runs/formal', args.run_id || 'RUN-YYYYMMDD-NNN'));
const drivePath = args.drive_path || `H:\\我的云端硬盘\\muIon_archive\\simulation-runs\\${path.basename(runDir)}`;
const localCommit = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
const remoteLine = runGit(root, ['ls-remote', 'origin', 'refs/heads/main'], { allowFailure: true });
const remoteCommit = remoteLine.status === 0 ? remoteLine.stdout.trim().split(/\s+/)[0] || null : null;
const files = fs.existsSync(runDir) ? walkFiles(runDir, { ignoredDirectories: ['.git', 'node_modules'] }).filter((file) => !/(\.lock|\.recover|\.tmp|\.bak)$/i.test(file)) : [];
const mismatches = [];
for (const local of files) {
  const relative = relativePath(runDir, local);
  const remote = path.join(drivePath, relative);
  if (!fs.existsSync(remote)) mismatches.push(`${relative}: missing in Drive`);
  else if (sha256File(local) !== sha256File(remote)) mismatches.push(`${relative}: SHA256 mismatch`);
}
let tagVerified = true;
let tagCommit = null;
if (args.tag) {
  const tagLine = runGit(root, ['ls-remote', 'origin', `refs/tags/${args.tag}^{}`], { allowFailure: true });
  tagCommit = tagLine.status === 0 ? tagLine.stdout.trim().split(/\s+/)[0] || null : null;
  const ancestor = tagCommit ? runGit(root, ['merge-base', '--is-ancestor', tagCommit, localCommit], { allowFailure: true }).status === 0 : false;
  tagVerified = tagCommit === localCommit || ancestor;
}
const result = { read_only: true, run_dir: runDir, drive_path: drivePath, local_commit: localCommit, gitee_remote_commit: remoteCommit, gitee_tag: args.tag || null, gitee_tag_commit: tagCommit, drive_files_checked: files.length, drive_mismatches: mismatches, tag_verified: tagVerified, status: remoteCommit === localCommit && mismatches.length === 0 && tagVerified ? 'three-way-verified' : 'drift-detected', action_required: remoteCommit !== localCommit || mismatches.length > 0 || !tagVerified };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.action_required ? 2 : 0;
