import fs from 'node:fs';
import path from 'node:path';
import { parseYamlFile } from './yaml-lite.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../../../..');
const required = ['manifest_id', 'manifest_type', 'schema_version', 'task_id', 'run_id', 'status', 'maturity_level', 'retention_level', 'physical_regions', 'model_references', 'files'];
const allowedStatus = new Set(['planned', 'running', 'complete', 'failed', 'archived', 'discarded']);
const allowedMaturity = new Set(['F0', 'F1', 'F2', 'F3']);
const allowedRetention = new Set(['P0', 'P1', 'P2', 'P3']);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.name === 'run-manifest.yaml') result.push(full);
  }
  return result;
}

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const files = requested.length ? requested.map((p) => path.resolve(p)) : walk(path.join(projectRoot, '03_runs', 'formal'));
const errors = [];
for (const file of files) {
  try {
    const doc = parseYamlFile(file);
    for (const field of required) if (!(field in doc)) errors.push(`${file}: missing ${field}`);
    if (doc.status && !allowedStatus.has(doc.status)) errors.push(`${file}: invalid status ${doc.status}`);
    if (doc.maturity_level && !allowedMaturity.has(doc.maturity_level)) errors.push(`${file}: invalid maturity_level ${doc.maturity_level}`);
    if (doc.retention_level && !allowedRetention.has(doc.retention_level)) errors.push(`${file}: invalid retention_level ${doc.retention_level}`);
    if (!Array.isArray(doc.physical_regions)) errors.push(`${file}: physical_regions must be a list`);
    if (!Array.isArray(doc.model_references)) errors.push(`${file}: model_references must be a list`);
    if (!Array.isArray(doc.files)) errors.push(`${file}: files must be a list`);
    for (const [index, artifact] of (doc.files || []).entries()) {
      for (const field of ['path', 'role', 'retention_level']) if (!(field in artifact)) errors.push(`${file}: files[${index}] missing ${field}`);
      if (artifact.retention_level && !allowedRetention.has(artifact.retention_level)) errors.push(`${file}: files[${index}] invalid retention_level`);
    }
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
  }
}

console.log(JSON.stringify({ checked: files, valid: errors.length === 0, errors }, null, 2));
process.exitCode = errors.length ? 1 : 0;
