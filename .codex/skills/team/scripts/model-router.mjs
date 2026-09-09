import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverModels, refreshCatalog } from './discover-models.mjs';
import { parseYamlFile } from '../../muion-project/scripts/yaml-lite.mjs';

// Thin local router; no provider gateway or model-name inference.
const REASONING_LEVELS = ['xhigh', 'high', 'medium', 'low'];
function readRouting(file) { try { return parseYamlFile(file); } catch { return { selection: {}, roles: {} }; } }
function asArray(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function includesAll(values, required) { const actual = new Set(asArray(values).map(String)); return asArray(required).every((item) => actual.has(String(item))); }
function requiredPermissions(task) {
  const explicit = task.permissions && typeof task.permissions === 'object' ? Object.entries(task.permissions).filter(([, value]) => value === true).map(([key]) => key) : [];
  return [...new Set([...explicit, ...asArray(task.required_permissions)])];
}
function roleFit(model, roleConfig) {
  const required = asArray(roleConfig?.capabilities); if (!required.length) return { score: 0, matched: [], missing: [] };
  const capabilities = new Set(asArray(model.capabilities).map(String)); const matched = required.filter((value) => capabilities.has(String(value)));
  return { score: matched.length, matched, missing: required.filter((value) => !capabilities.has(String(value))) };
}
function staleRisk(task, routing) {
  const permissions = requiredPermissions(task);
  return task.risk === 'high' || task.high_risk === true || task.concurrency > 1 || permissions.some((p) => ['write', 'publish', 'spawn_child'].includes(p)) || task.fanout === true || routing.selection?.stale_write_requires_refresh && permissions.includes('write');
}
function makeFallback(task, catalog, reason) {
  if (!task.parent_model) return null;
  return { model_id: task.parent_model, reasoning_effort: task.parent_effort || 'high', catalog_timestamp: catalog.fetched_at || null, stale_model_catalog: Boolean(catalog.stale), catalog_freshness: catalog.freshness || (catalog.stale ? 'stale' : 'fresh'), candidates_considered: [], selection_reason: reason, fallback: 'parent-model' };
}
export function selectModel(inputCatalog, task = {}, options = {}) {
  const routing = options.routing || task.routing || readRouting(options.routingFile || task.routing_file || path.resolve(process.cwd(), '00_project/config/agent-routing.yaml'));
  let catalog = inputCatalog || { models: [], stale: true, freshness: 'stale' };
  if (catalog.stale && (options.refresh || task.refresh_catalog)) catalog = refreshCatalog(catalog, options.refresh || task.refresh_catalog);
  const selection = routing.selection || {}; const roleConfig = routing.roles?.[task.role] || {};
  const preferred = task.reasoning || roleConfig.reasoning || selection.preferred_reasoning || 'high';
  const requestedExtreme = ['max', 'ultra'].includes(preferred); const allowedExtreme = task.allow_extreme_reasoning === true || selection.allow_max_or_ultra === true;
  const requiredContext = task.required_context ?? task.context_tokens ?? 0; const requiredModalities = task.required_modalities || task.modalities || [];
  const requiredTools = task.required_tools || task.tools || []; const requiredBackend = task.required_backend || task.backend || null; const permissions = requiredPermissions(task);
  const requiresPermissionMetadata = task.require_permission_metadata === true || permissions.some((permission) => ['write', 'publish', 'spawn_child'].includes(permission));
  const staleBlocked = Boolean(catalog.stale && staleRisk(task, routing)); const considered = [];
  if (staleBlocked) return makeFallback(task, catalog, 'stale catalog could not be refreshed for a write/high-risk dispatch');
  for (const model of catalog.models || []) {
    const reasons = [];
    if (!model.id || model.available === false || model.endpoint_available === false) reasons.push('endpoint unavailable');
    if (requiredContext && (model.context_window || 0) < requiredContext) reasons.push('insufficient context');
    if (task.allowed_models && !task.allowed_models.includes(model.id)) reasons.push('not in allowed_models');
    if (requiredModalities.length && !includesAll(model.input_modalities, requiredModalities)) reasons.push('input modality incompatible');
    if (requiredTools.length && !includesAll(model.tools, requiredTools)) reasons.push('required tool unavailable');
    if (requiredBackend && (model.backend || model.provider) !== requiredBackend) reasons.push('backend incompatible');
    if (permissions.length && model.permissions?.length && !includesAll(model.permissions, permissions)) reasons.push('permission mode incompatible');
    if (permissions.length && !model.permissions?.length && requiresPermissionMetadata) reasons.push('permission metadata unavailable');
    const supportedEfforts = asArray(model.efforts);
    if (requestedExtreme && !allowedExtreme) reasons.push('max/ultra is disabled by policy');
    const effort = supportedEfforts.includes(preferred) && (!requestedExtreme || allowedExtreme) ? preferred : REASONING_LEVELS.find((level) => supportedEfforts.includes(level));
    if (!effort) reasons.push('reasoning level unsupported');
    if (task.required_reasoning && effort !== preferred) reasons.push('required reasoning cannot be downgraded');
    const fit = roleFit(model, roleConfig); considered.push({ model_id: model.id, accepted: reasons.length === 0, reasons, role_fit: fit });
  }
  const candidates = (catalog.models || []).filter((model) => considered.find((item) => item.model_id === model.id)?.accepted);
  candidates.sort((a, b) => { const af = roleFit(a, roleConfig); const bf = roleFit(b, roleConfig); return bf.score - af.score || (b.quality ?? 0) - (a.quality ?? 0) || (a.load ?? 0) - (b.load ?? 0) || (b.context_window ?? 0) - (a.context_window ?? 0) || (a.priority ?? 999) - (b.priority ?? 999); });
  if (!candidates.length) return makeFallback(task, catalog, 'no hard-compatible candidate; parent-model fallback');
  const model = candidates[0]; const fit = roleFit(model, roleConfig);
  const selectedEffort = asArray(model.efforts).includes(preferred) && (!requestedExtreme || allowedExtreme) ? preferred : REASONING_LEVELS.find((level) => asArray(model.efforts).includes(level)) || null;
  const downgraded = selectedEffort !== preferred;
  return {
    model_id: model.id, reasoning_effort: selectedEffort, provider: model.provider || null, backend: model.backend || null, role: task.role || null, role_fit: fit,
    catalog_timestamp: catalog.fetched_at || null, stale_model_catalog: Boolean(catalog.stale), catalog_freshness: catalog.freshness || (catalog.stale ? 'stale' : 'fresh'),
    candidates_considered: considered, fallback_candidates: candidates.slice(1).map((item) => item.id),
    selection_reason: ['hard compatibility filter passed', task.role ? 'role ' + task.role + ' fit ' + fit.score + '/' + asArray(roleConfig.capabilities).length : 'no role constraint', 'quality ' + (model.quality ?? 0), downgraded ? 'reasoning downgraded from ' + preferred + ' to ' + selectedEffort : 'reasoning ' + selectedEffort, catalog.stale ? 'last-known-good catalog (stale, low-risk read-only)' : 'fresh runtime catalog'].join('; ')
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const file = process.argv[2] || path.join(process.env.CODEX_HOME || path.join(process.env.USERPROFILE || '', '.codex'), 'models_cache.json'); console.log(JSON.stringify(selectModel(discoverModels(file)), null, 2)); }
