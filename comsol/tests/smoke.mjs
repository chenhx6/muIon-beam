import assert from 'node:assert/strict';
import { parseYamlFile } from '../../.codex/skills/muion-project/scripts/yaml-lite.mjs';
import { runComsol } from '../index.mjs';
import { createHistorical100keVFixtureAdapter } from './fixtures/100kev-muon-adapter.mjs';

const task = parseYamlFile(new URL('./fixtures/100kev-muon-aperture-failure.yaml', import.meta.url));
const result = await runComsol(task, { adapter: createHistorical100keVFixtureAdapter() });
assert.equal(result.adapter.kind, 'documented-behavioural-fixture');
assert.ok(result.findings.some((finding) => finding.kind === 'physical'));
assert.ok(result.escalations.some((request) => request.candidate_causes.includes('geometry')));
assert.match(result.stopping_reason, /no_information_gain/);
assert.equal(result.exploration_history.at(-1).stage, 'stop');
console.log(JSON.stringify({
  pass: true,
  scenario: task.scenario_id,
  cases: result.cases.map((value) => value.case_id),
  stopping_reason: result.stopping_reason,
  escalation_count: result.escalations.length
}, null, 2));

