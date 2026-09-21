import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, jsonWrite, sha256File } from './project-utils.mjs';
import { canonicalDriveMirrorRoot, assertMirrorDoesNotContainProject } from './drive-layout.mjs';

export const mirrorManifestName = 'drive-mirror-manifest.json';
export const recoveryIndexRelativePath = '00_project/traceability/recovery-index.json';
export function loadMirrorPolicy(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '00_project/config/drive-mirror-policy.json'), 'utf8'));
}

export function buildDriveMirrorPlan(root, { driveRoot, policy = loadMirrorPolicy(root) } = {}) {
  const sourceRoot = fs.realpathSync(path.resolve(root));
  const targetRoot = path.resolve(driveRoot || (process.env.MUION_DRIVE_ARCHIVE_ROOT ? canonicalDriveMirrorRoot() : policy.drive_root));
  assertMirrorDoesNotContainProject(targetRoot, sourceRoot);
  if (fs.existsSync(path.join(sourceRoot, '.git')) && fs.lstatSync(path.join(sourceRoot, '.git')).isFile()) {
    throw new Error('worker worktrees cannot publish the shared Drive mirror; integrate with the leader first');
  }
  const entries = []; const skippedLinks = [];
  const excludedNames = new Set(['.git', '_work', ...policy.exclude_directory_names].map(value => value.toLowerCase()));
  const excludedPaths = [mirrorManifestName, recoveryIndexRelativePath, ...(policy.exclude_paths || [])].map(value => value.toLowerCase());
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name); const relative = path.relative(sourceRoot, full).replaceAll('\\', '/');
      const lower = relative.toLowerCase();
      if (excludedNames.has(entry.name.toLowerCase()) || excludedPaths.some(value => lower === value.replace(/\/$/, '') || (value.endsWith('/') && lower.startsWith(value)))) continue;
      if (entry.isSymbolicLink()) { skippedLinks.push(relative); continue; }
      if (entry.isDirectory()) { visit(full); continue; }
      if (!entry.isFile() || policy.exclude_extensions.some(ext => lower.endsWith(ext.toLowerCase()))) continue;
      if (!policy.include_files.includes(relative) && !policy.include_prefixes.some(prefix => relative.startsWith(prefix))) continue;
      entries.push({ path: relative, bytes: fs.statSync(full).size, sha256: sha256File(full), source: full, target: path.join(targetRoot, relative) });
    }
  };
  visit(sourceRoot);
  return {
    schema_version: 1, record_type: 'drive-local-tree-mirror-plan', generated_at: new Date().toISOString(),
    source_root: sourceRoot, drive_root: targetRoot, layout: 'local-relative-tree', cloud_status: 'unverified',
    file_count: entries.length, total_bytes: entries.reduce((sum, item) => sum + item.bytes, 0), entries,
    skipped_links: skippedLinks, exclusions: { directories: [...excludedNames], paths: excludedPaths, extensions: policy.exclude_extensions },
    cleanup: 'blocked-until-cloud-visible-and-copy-verified'
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2)); const root = path.resolve(args.project_root || projectRootFromHere()); const plan = buildDriveMirrorPlan(root, { driveRoot: args.drive_root });
  if (args.output) jsonWrite(path.resolve(root, args.output), plan);
  console.log(JSON.stringify({ source_root: plan.source_root, drive_root: plan.drive_root, file_count: plan.file_count, total_bytes: plan.total_bytes, cloud_status: plan.cloud_status, cleanup: plan.cleanup }, null, 2));
}
