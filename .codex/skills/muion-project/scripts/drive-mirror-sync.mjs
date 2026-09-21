import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, jsonWrite, sha256File, isPathInside } from './project-utils.mjs';
import { buildDriveMirrorPlan, loadMirrorPolicy, mirrorManifestName, recoveryIndexRelativePath } from './drive-mirror-plan.mjs';
import { canonicalDriveMirrorRoot, assertMirrorDoesNotContainProject } from './drive-layout.mjs';

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
function safePath(root, file) {
  if (!isPathInside(file, root)) throw new Error('mirror path escaped destination');
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`mirror link boundary: ${current}`);
    if (current === path.dirname(current)) break;
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).nlink > 1) throw new Error(`mirror hardlink boundary: ${file}`);
}
function signature(file) {
  if (!fs.existsSync(file)) return null;
  if (!fs.lstatSync(file).isFile()) throw new Error(`expected regular mirror file: ${file}`);
  return { bytes: fs.statSync(file).size, sha256: sha256File(file) };
}
const matches = (actual, expected) => actual && expected && actual.bytes === expected.bytes && actual.sha256 === expected.sha256;
function atomicJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  jsonWrite(temp, value); fs.renameSync(temp, file);
}
function acquireLock(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'writer.lock'); const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' }); return () => { if (read(file)?.token === token) fs.unlinkSync(file); }; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const old = read(file); let alive = true;
      if (Number.isInteger(old?.pid) && old.pid > 0) { try { process.kill(old.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; } }
      if (alive || attempt) throw new Error('Drive mirror already has an active writer');
      fs.unlinkSync(file);
    }
  }
}

// One current tree. Previously recorded hashes authorize updates; independent
// edits in Drive are retained and stop synchronization. No stale files are deleted.
export function syncDriveMirror(root, { driveRoot, policy = loadMirrorPolicy(root), now = new Date().toISOString(), onProgress = () => {} } = {}) {
  const sourceRoot = fs.realpathSync(path.resolve(root));
  const targetRoot = path.resolve(driveRoot || (process.env.MUION_DRIVE_ARCHIVE_ROOT ? canonicalDriveMirrorRoot() : policy.drive_root));
  assertMirrorDoesNotContainProject(targetRoot, sourceRoot); safePath(targetRoot, targetRoot);
  const id = crypto.createHash('sha256').update(targetRoot.toLowerCase()).digest('hex').slice(0, 16);
  const runtime = path.join(sourceRoot, '_work/current/drive-mirror', id);
  const release = acquireLock(runtime); const journalFile = path.join(runtime, 'pending.json');
  try {
    const plan = buildDriveMirrorPlan(sourceRoot, { driveRoot: targetRoot, policy });
    if (!plan.entries.length || plan.skipped_links.length) throw new Error('mirror plan is empty or contains unsupported source links');
    safePath(targetRoot, path.join(targetRoot, mirrorManifestName));
    const previous = read(path.join(targetRoot, mirrorManifestName));
    if (previous && (previous.record_type !== 'drive-local-tree-mirror' || !Array.isArray(previous.files))) throw new Error('invalid mirror manifest; preserve destination');
    const prior = new Map((previous?.files || []).map(file => [file.path, file]));
    const pending = read(journalFile);
    const recovered = pending?.drive_root === targetRoot ? pending.files || {} : {};
    for (const entry of plan.entries) {
      safePath(targetRoot, entry.target);
      const actual = signature(entry.target);
      if (actual && !matches(actual, entry) && !matches(actual, prior.get(entry.path)) && !matches(actual, recovered[entry.path])) {
        throw new Error(`independent Drive change retained: ${entry.path}`);
      }
    }
    fs.mkdirSync(targetRoot, { recursive: true });
    const journal = { drive_root: targetRoot, status: 'copying', started_at: now, files: recovered };
    atomicJson(journalFile, journal);
    let copied = 0; let reused = 0;
    for (const entry of plan.entries) {
      safePath(targetRoot, entry.target); safePath(sourceRoot, entry.source);
      if (!matches(signature(entry.source), entry)) throw new Error(`source changed during mirror: ${entry.path}`);
      const actual = signature(entry.target);
      if (matches(actual, entry)) { reused++; }
      else {
        if (actual && !matches(actual, prior.get(entry.path)) && !matches(actual, recovered[entry.path])) throw new Error(`Drive changed during mirror: ${entry.path}`);
        fs.mkdirSync(path.dirname(entry.target), { recursive: true });
        const temp = `${entry.target}.${crypto.randomUUID()}.tmp`;
        fs.copyFileSync(entry.source, temp, fs.constants.COPYFILE_EXCL);
        if (!matches(signature(temp), entry)) throw new Error(`copy verification failed: ${entry.path}`);
        journal.files[entry.path] = { bytes: entry.bytes, sha256: entry.sha256 };
        atomicJson(journalFile, journal);
        safePath(targetRoot, entry.target);
        if (!matches(signature(entry.target), actual) && (actual || fs.existsSync(entry.target))) throw new Error(`Drive changed before replace: ${entry.path}`);
        fs.renameSync(temp, entry.target);
        if (!matches(signature(entry.target), entry)) throw new Error(`Drive verification failed: ${entry.path}`);
        copied++;
      }
      if ((copied + reused) % 200 === 0) onProgress({ verified: copied + reused, total: plan.file_count });
    }
    // A task can continue editing while the copy runs. Do not label a changed
    // source set current; the persisted journal makes the next event retry safe.
    const finalPlan = buildDriveMirrorPlan(sourceRoot, { driveRoot: targetRoot, policy });
    const files = plan.entries.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
    if (JSON.stringify(files) !== JSON.stringify(finalPlan.entries.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })))) throw new Error('project changed during mirror; retry at next checkpoint');
    const expected = new Set(files.map(file => file.path)); const stale = [];
    const scan = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name); const relative = path.relative(targetRoot, full).replaceAll('\\', '/');
        safePath(targetRoot, full);
        if (entry.isDirectory()) scan(full);
        else if (![mirrorManifestName, recoveryIndexRelativePath].includes(relative) && !expected.has(relative)) stale.push(relative);
      }
    };
    scan(targetRoot); stale.sort();
    const manifest = { schema_version: 1, record_type: 'drive-local-tree-mirror', generated_at: now, layout: 'local-relative-tree',
      source_root: sourceRoot, drive_root: targetRoot, cloud_status: 'pending-cloud-visibility-audit',
      file_count: files.length, total_bytes: plan.total_bytes, copied_count: copied, reused_count: reused,
      stale_count: stale.length, stale_files: stale, exclusions: plan.exclusions,
      verification: 'mapped-drive-count-size-sha256-verified', cleanup_allowed: false, files };
    atomicJson(path.join(targetRoot, mirrorManifestName), manifest);
    atomicJson(journalFile, { drive_root: targetRoot, status: 'mapped-drive-verified', files: {} });
    return { manifest, manifest_path: path.join(targetRoot, mirrorManifestName), plan };
  } finally { release(); }
}

// Delivery remains published if Drive is offline. Save a retryable status instead
// of prompting the user to run another script or misreporting cloud completion.
export function syncMirrorOnDelivery(root, options = {}) {
  const statusFile = path.join(root, '_work/current/drive-mirror/status.json');
  try {
    const result = syncDriveMirror(root, options);
    const record = { status: 'mapped-drive-verified', cloud_status: result.manifest.cloud_status, manifest_path: result.manifest_path,
      file_count: result.manifest.file_count, total_bytes: result.manifest.total_bytes, stale_count: result.manifest.stale_count, recorded_at: new Date().toISOString() };
    jsonWrite(statusFile, record); return record;
  } catch (error) {
    const record = { status: 'pending-drive', error: error.message, next_action: 'retry through the next project delivery or sync event', recorded_at: new Date().toISOString() };
    jsonWrite(statusFile, record); return record;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2)); const root = path.resolve(args.project_root || projectRootFromHere());
  const result = syncMirrorOnDelivery(root, { driveRoot: args.drive_root, onProgress: value => console.error(JSON.stringify(value)) });
  console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'mapped-drive-verified' ? 0 : 2;
}
