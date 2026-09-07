import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseYamlFile } from '../.codex/skills/muion-project/scripts/yaml-lite.mjs';

const root = path.resolve(import.meta.dirname, '..');
const required = [
  'AGENTS.md',
  'README.md',
  '.gitignore',
  '.codex/skills/muion-project/SKILL.md',
  '.codex/skills/muion-project/agents/openai.yaml',
  '00_project/traceability/variable-catalog.yaml',
  '00_project/traceability/VARIABLE_CATALOG.md',
  '00_project/traceability/VARIABLE_CATALOG.csv',
  '00_project/templates/task-card.yaml',
  '00_project/templates/run-manifest.yaml',
  '03_runs/fast-track/README.md',
  '03_runs/formal/README.md',
  '90_migration/from-D-muIon/README.md'
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) throw new Error(`missing required files: ${missing.join(', ')}`);
const catalog = parseYamlFile(path.join(root, '00_project/traceability/variable-catalog.yaml'));
if (!Array.isArray(catalog.variables) || catalog.variables.length < 1) throw new Error('variable catalog has no variables');
const validation = spawnSync(process.execPath, ['.codex/skills/muion-project/scripts/validate-variable-catalog.mjs'], { cwd: root, encoding: 'utf8' });
if (validation.status !== 0) throw new Error(`variable catalog validation failed: ${validation.stdout}${validation.stderr}`);
const preflight = spawnSync(process.execPath, ['.codex/skills/muion-project/scripts/preflight.mjs', '.'], { cwd: root, encoding: 'utf8' });
if (preflight.status !== 0) throw new Error(`preflight failed: ${preflight.stdout}${preflight.stderr}`);
const migrationNote = fs.readFileSync(path.join(root, '90_migration/from-D-muIon/README.md'), 'utf8');
if (!migrationNote.includes('复制') || !migrationNote.includes('不删除')) throw new Error('legacy migration boundary is missing');
console.log(JSON.stringify({ valid: true, requiredFiles: required.length, variables: catalog.variables.length, legacyWorkspaceUntouched: true }, null, 2));
