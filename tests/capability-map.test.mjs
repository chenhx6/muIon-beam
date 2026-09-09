import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseYamlFile } from '../.codex/skills/muion-project/scripts/yaml-lite.mjs';

test('capability map matches the team implementation and trigger policy', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const map = parseYamlFile(path.join(root, '00_project/traceability/capability-map.yaml'));
  const byId = new Map(map.capabilities.map((item) => [item.capability_id, item]));
  const team = byId.get('team');
  assert.equal(team.decision, 'extend');
  assert.equal(team.trigger_mode, 'automatic');
  assert.equal(team.execution_kind, 'skill');
  for (const file of ['.codex/skills/team/SKILL.md', '.codex/skills/team/scripts/discover-models.mjs', '.codex/skills/team/scripts/select-model.mjs']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, file);
  }
  assert.equal(byId.get('evolution').trigger_mode, 'manual');
  assert.equal(byId.get('research-workflow').execution_kind, 'control-layer');
});
