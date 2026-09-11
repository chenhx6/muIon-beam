export function summarizeHealth(items = [], now = Date.now()) {
  return items.map((item) => {
    const ts = item.last_successful_activity || item.last_event_timestamp || item.end_time || item.updated_at || item.started_at || null;
    const age_ms = ts ? Math.max(0, now - Date.parse(ts)) : null;
    const status = String(item.status || item.lifecycle_state || item.lifecycle || 'unknown').toLowerCase();
    return { session_id: item.session_id || item.run_id || item.task_id || null, status, age_ms, stale: age_ms != null && age_ms > 120000, source: item.source || 'agent-run' };
  });
}
