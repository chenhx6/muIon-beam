import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, jsonWrite } from './project-utils.mjs';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const normalize = file => file.replaceAll('\\', '/');
const walk = (root, policy) => {
  const result = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!policy.exclude_directory_names.includes(entry.name)) visit(full); continue; }
      if (!entry.isFile() || policy.exclude_extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) continue;
      result.push(full);
    }
  };
  visit(root); return result;
};

export function buildDriveMirrorPlan(root, { driveRoot, policy = readJson(path.join(root, '00_project/config/drive-mirror-policy.json')) } = {}) {
  const sourceRoot = path.resolve(root); const targetRoot = path.resolve(driveRoot || policy.drive_root); const files = walk(sourceRoot, policy);
  const entries = files.filter(file => {
    const relative = normalize(path.relative(sourceRoot, file));
    return policy.include_files.includes(relative) || policy.include_prefixes.some(prefix => relative.startsWith(prefix));
  }).map(file => {
    const relative = normalize(path.relative(sourceRoot, file)); const bytes = fs.readFileSync(file);
    return { path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), source: file, target: path.join(targetRoot, relative), status: 'copy-candidate' };
  });
  return { schema_version: 1, record_type: 'drive-local-tree-mirror-plan', generated_at: new Date().toISOString(), source_root: sourceRoot, drive_root: targetRoot, layout: 'local-relative-tree', cloud_status: policy.cloud_status, file_count: entries.length, total_bytes: entries.reduce((sum, item) => sum + item.bytes, 0), entries, exclusions: { runtime: ['.git/', '_work/', 'node_modules/'], generated: policy.exclude_directory_names, temporary_extensions: policy.exclude_extensions }, cleanup: 'blocked-until-cloud-visible-and-copy-verified' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2)); const root = path.resolve(args.project_root || projectRootFromHere()); const plan = buildDriveMirrorPlan(root, { driveRoot: args.drive_root });
  if (args.output) jsonWrite(path.resolve(root, args.output), plan);
  console.log(JSON.stringify({ source_root: plan.source_root, drive_root: plan.drive_root, file_count: plan.file_count, total_bytes: plan.total_bytes, cloud_status: plan.cloud_status, cleanup: plan.cleanup }, null, 2));
}
