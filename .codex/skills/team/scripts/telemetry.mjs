import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function ledgerDirectory(root) { return path.join(root, '00_project', 'traceability', 'agent-runs'); }
function increment(map, key) { const name = key || 'unknown'; map[name] = (map[name] || 0) + 1; }

export function readAgentRuns(root) {
  const dir = ledgerDirectory(root); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith('.json') && file !== 'telemetry.json' && !file.endsWith('.tmp')).map((file) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { return null; }
  }).filter(Boolean);
}

export function summarizeAgentRuns(root, { since = null, now = new Date() } = {}) {
  const all = readAgentRuns(root); const cutoff = since ? new Date(since).getTime() : null;
  const runs = all.filter((run) => !cutoff || Date.parse(run.start_time || run.events?.[0]?.at || 0) >= cutoff);
  const byRole = {}; const byModel = {}; const byFamily = {}; const byState = {}; const failuresByModel = {}; const recentFailures = [];
  let staleCatalogUses = 0; let parentFallbacks = 0; let retries = 0; let correlatedReviewRisk = 0; let unknownReviewFamily = 0;
  for (const run of runs) {
    increment(byRole, run.role); increment(byModel, run.selected_model); increment(byFamily, run.model_family);
    increment(byState, run.lifecycle_state);
    if (run.stale_model_catalog || ['stale', 'stale-refresh-failed'].includes(run.catalog_freshness)) staleCatalogUses += 1;
    if (run.fallback === 'parent-model' || String(run.selection_reason || '').includes('parent-model fallback')) parentFallbacks += 1;
    retries += run.retry?.count || 0;
    if (run.lifecycle_state === 'failed' || run.failure_reason) {
      increment(failuresByModel, run.selected_model); recentFailures.push({ run_id: run.run_id, task_id: run.task_id, model: run.selected_model, role: run.role, reason: run.failure_reason || 'failed', at: run.end_time || null });
    }
    if (run.correlated_review_risk === true) correlatedReviewRisk += 1;
    if (['critic', 'physics-reviewer', 'qa'].includes(run.role) && !run.model_family) unknownReviewFamily += 1;
  }
  const providerCapacity = runs.map((run) => run.runtime_capacity).filter(Boolean);
  return {
    schema_version: 1,
    telemetry_id: `TEAM-TELEMETRY-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`,
    generated_at: now.toISOString(),
    source: 'local-agent-run-ledger',
    window: { since: since || null, run_count: runs.length },
    by_role: byRole,
    by_model: byModel,
    by_model_family: byFamily,
    by_lifecycle_state: byState,
    failures_by_model: failuresByModel,
    recent_failures: recentFailures.slice(-50),
    stale_catalog_uses: staleCatalogUses,
    parent_fallbacks: parentFallbacks,
    retries,
    correlated_review_risk_count: correlatedReviewRisk,
    unknown_review_family_count: unknownReviewFamily,
    provider_capacity: providerCapacity.length ? providerCapacity : 'unknown',
    provider_capacity_source: providerCapacity.length ? 'runtime-ledger-observation' : 'unavailable; no provider slot telemetry is inferred',
    limitations: ['local ledger is observational', 'provider slots/load/cost/latency are unknown unless runtime records them', 'model family is unknown when runtime metadata omits it']
  };
}

export function writeTelemetry(root, summary) {
  const dir = ledgerDirectory(root); fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, 'telemetry.json'); fs.writeFileSync(file, JSON.stringify(summary, null, 2) + '\n'); return file;
}
