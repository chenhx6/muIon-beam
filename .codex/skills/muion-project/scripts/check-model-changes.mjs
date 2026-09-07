import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, projectRootFromHere, walkFiles, sha256File, jsonRead, jsonWrite, relativePath, nowIso } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const registryPath = path.resolve(args.registry || path.join(root, '02_models/model-fingerprints.json'));
const defaultPaths = walkFiles(path.join(root, '02_models'), { ignoredDirectories: ['.git'] }).filter((file) => ['.mph', '.sldasm', '.sldprt', '.slddrw', '.step', '.stp', '.x_t'].includes(path.extname(file).toLowerCase()));
const rawPaths = args.path ? (Array.isArray(args.path) ? args.path : [args.path]) : defaultPaths;
const paths = rawPaths.map((file) => path.resolve(root, file));
let registry = { schema_version: '1.0.0', models: [] };
if (fs.existsSync(registryPath)) registry = jsonRead(registryPath);
const byPath = new Map((registry.models || []).map((model) => [path.resolve(root, model.path).toLowerCase(), model]));
const changes = [];
const current = [];
for (const file of paths) {
  if (!fs.existsSync(file)) { changes.push({ path: relativePath(root, file), status: 'missing' }); continue; }
  const stat = fs.statSync(file);
  const fingerprint = { path: relativePath(root, file), absolute_path: file, size: stat.size, modified_at: stat.mtime.toISOString(), sha256: sha256File(file), extension: path.extname(file).toLowerCase(), geometry_summary: { size_bytes: stat.size } };
  current.push(fingerprint);
  const previous = byPath.get(file.toLowerCase());
  if (!previous) changes.push({ path: fingerprint.path, status: 'unregistered', previous: null, current: fingerprint });
  else if (previous.sha256 !== fingerprint.sha256 || previous.size !== fingerprint.size) changes.push({ path: fingerprint.path, status: 'changed', previous, current: fingerprint });
  else changes.push({ path: fingerprint.path, status: 'unchanged', previous, current: fingerprint });
}
const changed = changes.filter((item) => ['changed', 'unregistered', 'missing'].includes(item.status));
if (args.adopt) {
  const retained = (registry.models || []).filter((model) => !current.some((item) => item.path.toLowerCase() === model.path.toLowerCase()));
  jsonWrite(registryPath, { schema_version: '1.0.0', updated_at: nowIso(), models: retained.concat(current) });
}
const result = { registry: registryPath, checked: paths.map((file) => relativePath(root, file)), changes, requires_confirmation: changed.length > 0 && !args.adopt, adopted: Boolean(args.adopt), valid: changed.length === 0 || Boolean(args.adopt) };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.requires_confirmation ? 2 : 0;
