import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function discoverModels(file, now = Date.now(), ttl = 300000) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { fetched_at: data.fetched_at, stale: now - Date.parse(data.fetched_at) > ttl, models: (data.models || []).filter((m) => m.visibility !== 'hide').map((m) => ({ id: m.slug || m.id, description: m.description || '', priority: m.priority ?? 999, context_window: m.max_context_window || m.context_window || 0, efforts: (m.supported_reasoning_levels || []).map((e) => typeof e === 'string' ? e : e.effort), input_modalities: m.input_modalities || ['text'], tools: m.experimental_supported_tools || [] })) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const file = process.argv[2] || path.join(process.env.CODEX_HOME || path.join(process.env.USERPROFILE || '', '.codex'), 'models_cache.json'); console.log(JSON.stringify(discoverModels(file), null, 2)); }
