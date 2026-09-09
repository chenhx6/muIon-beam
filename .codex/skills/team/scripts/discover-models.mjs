import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function discoverModels(file, now = Date.now(), ttl = 300000) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fetchedAt = data.fetched_at || data.updated_at || null;
  const timestamp = fetchedAt ? Date.parse(fetchedAt) : NaN;
  const stale = !Number.isFinite(timestamp) || now - timestamp > ttl;
  return {
    fetched_at: fetchedAt,
    stale,
    freshness: stale ? 'stale' : 'fresh',
    source: data.source || 'runtime-catalog',
    refresh_attempted: false,
    refresh_error: null,
    models: (data.models || []).filter((m) => m.visibility !== 'hide').map((m) => ({
      id: m.slug || m.id,
      description: m.description || '',
      provider: m.provider || m.backend || null,
      backend: m.backend || m.provider || null,
      available: m.available !== false && m.endpoint_available !== false,
      endpoint_available: m.endpoint_available !== false,
      priority: m.priority ?? 999,
      quality: m.quality ?? m.quality_score ?? 0,
      load: m.load ?? m.current_load ?? null,
      context_window: m.max_context_window || m.context_window || 0,
      efforts: (m.supported_reasoning_levels || m.reasoning_levels || []).map((e) => typeof e === 'string' ? e : e.effort),
      input_modalities: m.input_modalities || m.modalities || ['text'],
      tools: m.tools || m.experimental_supported_tools || [],
      capabilities: m.capabilities || [],
      permissions: m.permissions || m.permission_modes || [],
      permission_backends: m.permission_backends || [],
      family: m.family || m.model_family || null
    }))
  };
}
export function refreshCatalog(catalog, refresh) {
  const base = { ...catalog, refresh_attempted: true };
  if (typeof refresh !== 'function') return { ...base, refresh_error: 'no refresh function supplied', freshness: catalog.stale ? 'stale' : 'fresh' };
  try {
    const next = refresh(catalog);
    if (!next || !Array.isArray(next.models)) throw new Error('refresh returned an invalid catalog');
    return { ...next, stale: false, freshness: 'refreshed', refresh_attempted: true, refresh_error: null };
  } catch (error) {
    return { ...base, refresh_error: error.message, freshness: 'stale-refresh-failed' };
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const file = process.argv[2] || path.join(process.env.CODEX_HOME || path.join(process.env.USERPROFILE || '', '.codex'), 'models_cache.json'); console.log(JSON.stringify(discoverModels(file), null, 2)); }
