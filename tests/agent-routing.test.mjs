import test from 'node:test';
import assert from 'node:assert/strict';
import { selectModel } from '../.codex/skills/team/scripts/select-model.mjs';
import { discoverModels } from '../.codex/skills/team/scripts/discover-models.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('model routing selects the best compatible discovered model', () => {
  const catalog = { fetched_at: new Date().toISOString(), stale: false, models: [
    { id: 'small', priority: 20, context_window: 1000, efforts: ['high'] },
    { id: 'strong', priority: 2, context_window: 10000, efforts: ['high', 'xhigh'] }
  ] };
  const choice = selectModel(catalog, { context_tokens: 500, reasoning: 'xhigh' });
  assert.equal(choice.model_id, 'strong');
  assert.equal(choice.reasoning_effort, 'xhigh');
});
test('model discovery reads a runtime catalog and marks stale data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-models-'));
  const file = path.join(dir, 'models.json');
  fs.writeFileSync(file, JSON.stringify({ fetched_at: '2020-01-01T00:00:00Z', models: [{ slug: 'runtime-model', priority: 1, context_window: 1000, supported_reasoning_levels: [{ effort: 'xhigh' }] }] }));
  const catalog = discoverModels(file, Date.parse('2020-01-01T00:10:00Z'), 300000);
  assert.equal(catalog.stale, true);
  assert.equal(catalog.models[0].id, 'runtime-model');
});
