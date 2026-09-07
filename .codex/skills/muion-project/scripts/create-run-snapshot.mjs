import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, projectRootFromHere, ensureDirectory, sha256File, jsonWrite, relativePath, nowIso } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const runDir = path.resolve(args.run_dir || path.join(root, '03_runs/formal/RUN-YYYYMMDD-NNN-snapshot'));
const sourceArgs = args.source ? (Array.isArray(args.source) ? args.source : [args.source]) : [];
if (!sourceArgs.length) throw new Error('provide one or more --source paths');
const snapshotDir = path.join(runDir, 'model-snapshot');
ensureDirectory(snapshotDir);
const records = [];
for (const sourceArg of sourceArgs) {
  const source = path.resolve(root, sourceArg);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`snapshot source is not a file: ${source}`);
  const name = path.basename(source);
  const destination = path.join(snapshotDir, name);
  if (fs.existsSync(destination) && sha256File(destination) !== sha256File(source)) throw new Error(`snapshot destination differs: ${destination}`);
  if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
  records.push({ source_path: relativePath(root, source), snapshot_path: relativePath(root, destination), source_sha256: sha256File(source), snapshot_sha256: sha256File(destination), size: fs.statSync(source).size });
}
const manifest = { manifest_id: `SNAPSHOT-${path.basename(runDir)}`, manifest_type: 'run-snapshot', schema_version: '1.0.0', created_at: nowIso(), run_dir: relativePath(root, runDir), files: records };
jsonWrite(path.join(snapshotDir, 'snapshot-manifest.json'), manifest);
console.log(JSON.stringify({ runDir, snapshotDir, files: records, valid: records.every((item) => item.source_sha256 === item.snapshot_sha256) }, null, 2));
