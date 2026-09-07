import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, projectRootFromHere, walkFiles, relativePath } from './project-utils.mjs';
import { parseYamlFile } from './yaml-lite.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const files = walkFiles(root, { ignoredDirectories: ['.git', 'node_modules', '_work'] }).filter((file) => /(?:manifest|catalog|analysis)\.(json|ya?ml)$/i.test(file));
const errors = [];
const checked = [];
for (const file of files) {
  const relative = relativePath(root, file);
  let doc;
  try { doc = file.toLowerCase().endsWith('.json') ? JSON.parse(fs.readFileSync(file, 'utf8')) : parseYamlFile(file); }
  catch (error) { errors.push(`${relative}: parse error: ${error.message}`); continue; }
  checked.push(relative);
  const type = doc.manifest_type || (doc.migration_id ? 'migration' : doc.publication_id ? 'publication' : doc.sync_id ? 'sync-state' : null);
  if (!type && !doc.variables) continue;
  if (type === 'migration') {
    for (const field of ['manifest_id', 'source_workspace', 'destination_workspace', 'copy_only', 'preserve_source', 'files']) if (!(field in doc)) errors.push(`${relative}: missing ${field}`);
    if (doc.copy_only !== true || doc.preserve_source !== true) errors.push(`${relative}: migration must be copy-only and preserve source`);
  } else if (type === 'run') {
    for (const field of ['manifest_id', 'task_id', 'run_id', 'status', 'maturity_level', 'retention_level', 'physical_regions', 'model_references', 'files']) if (!(field in doc)) errors.push(`${relative}: missing ${field}`);
  } else if (type === 'task') {
    for (const field of ['manifest_id', 'task_id', 'task_name', 'source_type', 'objective_zh']) if (!(field in doc)) errors.push(`${relative}: missing ${field}`);
  } else if (type === 'model') {
    for (const field of ['manifest_id', 'model_id', 'model_name', 'revision', 'files']) if (!(field in doc)) errors.push(`${relative}: missing ${field}`);
  } else if (type === 'figure-manifest') {
    if (!Array.isArray(doc.figures)) errors.push(`${relative}: figures must be a list`);
  } else if (type === 'behavior-analysis') {
    if (!Array.isArray(doc.analyses)) errors.push(`${relative}: analyses must be a list`);
  } else if (type === 'sync-state') {
    for (const field of ['sync_id', 'local_commit', 'status']) if (!(field in doc)) errors.push(`${relative}: missing ${field}`);
  }
  if (doc.variables && !Array.isArray(doc.variables)) errors.push(`${relative}: variables must be a list`);
}
console.log(JSON.stringify({ root, checked, valid: errors.length === 0, errors }, null, 2));
process.exitCode = errors.length ? 1 : 0;
