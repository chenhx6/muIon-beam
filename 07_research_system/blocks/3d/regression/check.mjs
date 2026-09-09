import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlFile } from '../../../../.codex/skills/muion-project/scripts/yaml-lite.mjs';

export function checkRegistry(file = path.join(import.meta.dirname, 'registry.yaml')) {
  const registry = parseYamlFile(file);
  const cases = Array.isArray(registry.cases) ? registry.cases : [];
  const errors = [];
  for (const [index, item] of cases.entries()) {
    for (const key of ['case_id', 'trigger', 'expected', 'verification', 'status']) if (!item?.[key]) errors.push(`cases[${index}].${key} is required`);
  }
  return { status: errors.length ? 'invalid' : cases.length ? 'ready-for-cad-run' : 'not-yet-validated', cases: cases.length, errors, note: registry.note || null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(checkRegistry(process.argv[2] || undefined), null, 2));
