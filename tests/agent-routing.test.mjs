import test from 'node:test';
import assert from 'node:assert/strict';
import { selectModel } from '../.codex/skills/team/scripts/select-model.mjs';
import { selectModel as routeModel } from '../.codex/skills/team/scripts/model-router.mjs';
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

test('hard filters modalities and tools, then uses role capability fit', () => {
  const catalog = { fetched_at: new Date().toISOString(), stale: false, models: [
    { id: 'generic', priority: 1, context_window: 8000, efforts: ['xhigh'], input_modalities: ['text'], tools: ['shell'], capabilities: ['execution'], quality: 9 },
    { id: 'physics', priority: 20, context_window: 8000, efforts: ['xhigh'], input_modalities: ['text', 'image'], tools: ['shell', 'comsol'], capabilities: ['physics', 'review'], quality: 7 }
  ] };
  const choice = routeModel(catalog, { role: 'physics-reviewer', required_modalities: ['image'], required_tools: ['comsol'], reasoning: 'xhigh', permissions: { read: true } });
  assert.equal(choice.model_id, 'physics');
  assert.match(choice.selection_reason, /role physics-reviewer/);
  assert.equal(choice.candidates_considered.find((item) => item.model_id === 'generic').accepted, false);
});

test('unsupported reasoning has an explicit downgrade or required-reasoning failure', () => {
  const catalog = { fetched_at: new Date().toISOString(), stale: false, models: [{ id: 'm', context_window: 1000, efforts: ['high'], input_modalities: ['text'], tools: [] }] };
  assert.equal(routeModel(catalog, { reasoning: 'xhigh' }).reasoning_effort, 'high');
  assert.equal(routeModel(catalog, { reasoning: 'xhigh', required_reasoning: true }), null);
});

test('no compatible model returns blocked/null or explicit parent fallback', () => {
  const catalog = { fetched_at: new Date().toISOString(), stale: false, models: [{ id: 'text-only', context_window: 1000, efforts: ['high'], input_modalities: ['text'], tools: [] }] };
  assert.equal(routeModel(catalog, { required_modalities: ['image'] }), null);
  assert.equal(routeModel(catalog, { required_modalities: ['image'], parent_model: 'parent' }).fallback, 'parent-model');
});

test('stale catalog allows read-only work but blocks writes without refresh or parent fallback', () => {
  const stale = { fetched_at: '2020-01-01T00:00:00Z', stale: true, freshness: 'stale', models: [{ id: 'm', context_window: 1000, efforts: ['high'] }] };
  assert.equal(routeModel(stale, { permissions: { read: true } }).model_id, 'm');
  assert.equal(routeModel(stale, { permissions: { write: true } }), null);
  const fallback = routeModel(stale, { permissions: { write: true }, parent_model: 'parent', parent_effort: 'high' });
  assert.equal(fallback.fallback, 'parent-model');
  const refreshed = routeModel(stale, { permissions: { write: true }, refresh_catalog: () => ({ fetched_at: new Date().toISOString(), stale: false, models: [{ id: 'fresh', context_window: 1000, efforts: ['high'], permissions: ['read', 'write'] }] }) });
  assert.equal(refreshed.model_id, 'fresh');
});
