import fs from 'node:fs';
import path from 'node:path';
import { parseYamlFile } from './yaml-lite.mjs';

const file = path.resolve(process.argv[2] || '00_project/traceability/variable-catalog.yaml');
const required = ['canonical_name', 'display_name_zh', 'definition_zh', 'unit', 'dimension', 'data_type', 'value_type', 'physical_region', 'model_layer', 'input_or_output'];
const errors = [];
try {
  const doc = parseYamlFile(file);
  if (!Array.isArray(doc.variables)) errors.push('variables must be a list');
  const names = new Set();
  for (const [index, variable] of (doc.variables || []).entries()) {
    for (const field of required) if (!(field in variable)) errors.push(`variables[${index}] missing ${field}`);
    if (variable.canonical_name) {
      if (names.has(variable.canonical_name)) errors.push(`duplicate canonical_name ${variable.canonical_name}`);
      names.add(variable.canonical_name);
      if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(variable.canonical_name)) errors.push(`invalid canonical_name ${variable.canonical_name}`);
    }
    if (variable.allowed_alias && !Array.isArray(variable.allowed_alias)) errors.push(`variables[${index}] allowed_alias must be a list`);
  }
} catch (error) {
  errors.push(error.message);
}
console.log(JSON.stringify({ file, valid: errors.length === 0, errors }, null, 2));
process.exitCode = errors.length ? 1 : 0;
