import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, jsonWrite } from './project-utils.mjs';
import { buildDriveMirrorPlan } from './drive-mirror-plan.mjs';

const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const normalize = file => file.replaceAll('\\', '/');
const inside = (root, candidate) => {
  const base = path.resolve(root); const target = path.resolve(candidate);
  return target === base || target.startsWith(`${base}${path.sep}`);
};

function assertSafeRoots(sourceRoot, driveRoot) {
  const source = path.resolve(sourceRoot); const drive = path.resolve(driveRoot);
  if (source === drive || inside(source, drive) || inside(drive, source)) throw new Error('source and Drive mirror roots must be separate');
}

/**
 * Copy the current local project tree to a mapped Drive root.
 *
 * The operation is intentionally copy-only: it never deletes files from the
 * mirror. Existing files are reused only after a size/hash match. A manifest
 * at the mirror root is written after every entry has been verified locally;
 * cloud visibility remains a separate audit result.
 */
export function syncDriveMirror(root, { driveRoot, policy, now = new Date().toISOString(), onProgress = () => {} } = {}) {
  const sourceRoot = path.resolve(root); const plan = buildDriveMirrorPlan(sourceRoot, { driveRoot, policy });
  const targetRoot = path.resolve(plan.drive_root); assertSafeRoots(sourceRoot, targetRoot);
  fs.mkdirSync(targetRoot, { recursive: true });
  const files = []; let copied = 0; let reused = 0;
  for (const entry of plan.entries) {
    if (!inside(targetRoot, entry.target)) throw new Error(`mirror path escaped Drive root: ${entry.path}`);
    fs.mkdirSync(path.dirname(entry.target), { recursive: true });
    const canReuse = fs.existsSync(entry.target) && fs.statSync(entry.target).isFile() && fs.statSync(entry.target).size === entry.bytes && sha256File(entry.target) === entry.sha256;
    if (canReuse) reused += 1;
    else {
      const temp = `${entry.target}.__muion_copying__${process.pid}`;
      fs.copyFileSync(entry.source, temp);
      if (fs.statSync(temp).size !== entry.bytes || sha256File(temp) !== entry.sha256) throw new Error(`source copy verification failed: ${entry.path}`);
      fs.copyFileSync(temp, entry.target);
      fs.rmSync(temp, { force: true });
      if (fs.statSync(entry.target).size !== entry.bytes || sha256File(entry.target) !== entry.sha256) throw new Error(`Drive mirror verification failed: ${entry.path}`);
      copied += 1;
    }
    files.push({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256, status: canReuse ? 'reused-verified' : 'copied-verified' });
    if (files.length % 200 === 0) onProgress({ verified: files.length, total: plan.entries.length });
  }
  const manifest = {
    schema_version: 1,
    record_type: 'drive-local-tree-mirror',
    generated_at: now,
    layout: 'local-relative-tree',
    source_root: sourceRoot,
    drive_root: targetRoot,
    cloud_status: 'pending-cloud-visibility-audit',
    file_count: files.length,
    total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    copied_count: copied,
    reused_count: reused,
    verification: 'mapped-drive-count-size-sha256-verified',
    cleanup_allowed: false,
    files
  };
  jsonWrite(path.join(targetRoot, 'drive-mirror-manifest.json'), manifest);
  return { manifest, manifest_path: path.join(targetRoot, 'drive-mirror-manifest.json'), plan };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (!args.drive_root) throw new Error('--drive-root is required');
    const result = syncDriveMirror(args.project_root || projectRootFromHere(), { driveRoot: args.drive_root, onProgress: value => console.error(JSON.stringify(value)) });
    if (args.output) jsonWrite(path.resolve(args.project_root || projectRootFromHere(), args.output), result.manifest);
    console.log(JSON.stringify({ manifest_path: result.manifest_path, file_count: result.manifest.file_count, total_bytes: result.manifest.total_bytes, copied_count: result.manifest.copied_count, reused_count: result.manifest.reused_count, cloud_status: result.manifest.cloud_status, cleanup_allowed: result.manifest.cleanup_allowed }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
