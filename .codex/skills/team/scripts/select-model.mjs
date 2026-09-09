import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverModels } from './discover-models.mjs';
import { selectModel as routeModel } from './model-router.mjs';
// Legacy compatibility entrypoint. New dispatches use model-router.mjs, which
// adds role fit, hard compatibility filters and stale-catalog policy.
function legacySelectModel(catalog, task = {}) {
  const candidates = catalog.models.filter((m) => (!task.context_tokens || m.context_window >= task.context_tokens) && (!task.allowed_models || task.allowed_models.includes(m.id)));
  candidates.sort((a, b) => a.priority - b.priority || b.context_window - a.context_window);
  if (!candidates.length) return task.parent_model ? { model_id: task.parent_model, reasoning_effort: task.parent_effort || 'high', stale_model_catalog: true, selection_reason: 'parent-model fallback' } : null;
  const model = candidates[0]; const preferred = task.reasoning || 'xhigh'; const levels = ['xhigh', 'high', 'medium', 'low'];
  const effort = model.efforts.includes(preferred) && !['max', 'ultra'].includes(preferred) ? preferred : levels.find((e) => model.efforts.includes(e));
  return { model_id: model.id, reasoning_effort: effort || null, catalog_timestamp: catalog.fetched_at, stale_model_catalog: catalog.stale, selection_reason: 'runtime capability/priority, context fit, supported reasoning; cost is not primary', fallback_candidates: candidates.slice(1).map((m) => m.id) };
}
// Keep the historical module path stable while routing all callers through the
// capability-aware selector. The legacy implementation above remains useful
// when comparing old decisions during audit.
export const selectModel = routeModel;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const file = process.argv[2] || path.join(process.env.CODEX_HOME || path.join(process.env.USERPROFILE || '', '.codex'), 'models_cache.json'); console.log(JSON.stringify(selectModel(discoverModels(file)), null, 2)); }
