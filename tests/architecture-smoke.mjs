import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseYamlFile } from '../.codex/skills/muion-project/scripts/yaml-lite.mjs';

const root = path.resolve(import.meta.dirname, '..');
const required = [
  'AGENTS.md',
  '00_project/config/delivery-policy.json',
  'README.md',
  '.gitignore',
  '.codex/skills/muion-project/SKILL.md',
  '.codex/skills/muion-project/agents/openai.yaml',
  '.codex/skills/farmer/SKILL.md',
  '.codex/skills/farmer/agents/openai.yaml',
  '.codex/skills/farmer/farmer.mjs',
  '.codex/skills/muion-project/scripts/base-content-verification.mjs',
  '.codex/skills/team/SKILL.md',
  '.codex/skills/team/agents/openai.yaml',
  '.codex/skills/evolution/SKILL.md',
  '.codex/skills/evolution/agents/openai.yaml',
  '.codex/skills/geant4/SKILL.md',
  '.codex/skills/geant4/agents/openai.yaml',
  '.codex/skills/3d/SKILL.md',
  '.codex/skills/3d/agents/openai.yaml',
  '3d/SKILL.md',
  '3d/index.mjs',
  '3d/create/SKILL.md',
  '3d/modify/SKILL.md',
  '3d/inspect/SKILL.md',
  '3d/export/SKILL.md',
  '3d/experience-candidates/candidate-template.yaml',
  '3d/regression/check.mjs',
  '3d/regression/registry.yaml',
  '3d/references/external-automation-guide.md',
  '3d/references/cad-studio-test.md',
  '3d/references/smoke-test.md',
  '3d/attribution/solidworks-automation-skill.md',
  '3d/attribution/EXTERNAL-LICENSE.txt',
  '3d/scripts/sw_connect.py',
  '3d/scripts/sw_session.py',
  '3d/scripts/sw_preflight.py',
  '3d/scripts/sw_part.py',
  '3d/scripts/sw_document_data.py',
  '3d/scripts/sw_entity_reference.py',
  '3d/scripts/cad_doctor.py',
  '3d/scripts/sw_review.py',
  '3d/scripts/sw_export.py',
  '3d/scripts/cad_installation.py',
  '3d/tests/index.test.mjs',
  'geant4/SKILL.md',
  'geant4/index.mjs',
  'geant4/scripts/preflight.mjs',
  'geant4/scripts/build.mjs',
  'geant4/scripts/smoke.mjs',
  'geant4/scripts/run.mjs',
  'geant4/scripts/validate.mjs',
  'geant4/scripts/summarize.mjs',
  'geant4/experience-candidates/candidate-template.yaml',
  'geant4/tests/fixtures/mvp-smoke/CMakeLists.txt',
  'geant4/tests/fixtures/mvp-smoke/main.cc',
  'geant4/tests/smoke.mjs',
  '00_project/traceability/capability-map.yaml',
  '00_project/traceability/variable-catalog.yaml',
  '00_project/schemas/milestone-manifest.schema.json',
  '.codex/skills/muion-project/scripts/task-close.mjs',
  '.codex/skills/muion-project/scripts/delivery-plan.mjs',
  '.codex/skills/muion-project/scripts/record-sync-metadata.mjs',
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
