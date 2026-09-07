import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseYamlFile } from './yaml-lite.mjs';
import { projectRootFromHere, walkFiles, sha256File, relativePath, parseArgs } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args._[0] || args.root || projectRootFromHere());
const database = path.resolve(args.database || path.join(root, '00_project/traceability/index.sqlite'));
const schema = path.resolve(args.schema || path.join(root, '00_project/schemas/index.schema.sql'));
const files = walkFiles(root, { ignoredDirectories: ['.git', 'node_modules', '_work'] }).filter((file) => /\.(ya?ml|json)$/i.test(file));
const items = [];
const parseErrors = [];
for (const file of files) {
  const relative = relativePath(root, file);
  if (/^(00_project\/traceability\/(VARIABLE_CATALOG|PROJECT_INDEX|TASK_INDEX|MODEL_INDEX|RESULTS_INDEX|REFERENCE_INDEX)\.(md|csv)|package-lock\.json)$/i.test(relative)) continue;
  try {
    const doc = file.toLowerCase().endsWith('.json') ? JSON.parse(fs.readFileSync(file, 'utf8')) : parseYamlFile(file);
    const isManifest = doc && typeof doc === 'object' && (doc.manifest_id || doc.migration_id || doc.publication_id || doc.sync_id || doc.figures || doc.analyses || doc.variables);
    if (isManifest) items.push({ source_path: relative, content_sha256: sha256File(file), doc });
  } catch (error) { parseErrors.push({ file: relative, error: error.message }); }
}
const python = process.env.MUION_PYTHON || 'C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
const script = path.join(import.meta.dirname, 'build-index-sqlite.py');
const inputFile = path.join(root, '_work', 'temporary-output', `index-input-${process.pid}.json`);
fs.mkdirSync(path.dirname(inputFile), { recursive: true });
fs.writeFileSync(inputFile, JSON.stringify(items), 'utf8');
const result = spawnSync(python, [script, '--database', database, '--schema', schema, '--input-file', inputFile], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
try { fs.rmSync(inputFile, { force: true }); } catch { /* best-effort cleanup */ }
if (result.status !== 0) { console.error(result.stderr || result.stdout); process.exitCode = result.status || 1; }
else console.log(JSON.stringify({ root, database, manifests: items.length, parseErrors, sqlite: JSON.parse(result.stdout) }, null, 2));
