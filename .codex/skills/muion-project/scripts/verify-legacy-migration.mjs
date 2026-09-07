import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, jsonRead, sha256File, projectRootFromHere } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const manifestPath = path.resolve(args.manifest || path.join(root, '90_migration/from-D-muIon/migration-manifest.json'));
const manifest = jsonRead(manifestPath);
const errors = [];
let checked = 0;
for (const item of manifest.files || []) {
  checked += 1;
  if (!fs.existsSync(item.legacy_source_path)) { errors.push(`source missing: ${item.legacy_source_path}`); continue; }
  const sourceHash = sha256File(item.legacy_source_path);
  if (sourceHash !== item.legacy_source_sha256) errors.push(`source changed: ${item.legacy_source_path}`);
  const local = path.join(root, item.destination_path);
  if (!fs.existsSync(local)) errors.push(`destination missing: ${local}`);
  else if (sha256File(local) !== item.legacy_source_sha256) errors.push(`destination mismatch: ${local}`);
  if (item.drive_path && item.drive_status === 'verified') {
    if (!fs.existsSync(item.drive_path)) errors.push(`drive destination missing: ${item.drive_path}`);
    else if (sha256File(item.drive_path) !== item.legacy_source_sha256) errors.push(`drive mismatch: ${item.drive_path}`);
  }
}
const result = { manifest: manifestPath, checked, valid: errors.length === 0, errors, source_preserved: errors.every((error) => !error.startsWith('source changed')) };
console.log(JSON.stringify(result, null, 2));
process.exitCode = errors.length ? 1 : 0;
