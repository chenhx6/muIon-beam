import fs from 'node:fs';
import path from 'node:path';

const canonical = value => path.resolve(String(value).replace(/^\\\\\?\\/, '')).toLowerCase();
export const inside = (child, root) => {
  const relative = path.relative(canonical(root), canonical(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
const time = event => Date.parse(event?.timestamp || '');
const newer = (a, b) => Number.isFinite(time(a)) && (!b || time(a) > time(b));
const fresh = () => ({ meta: null, starts: new Map(), terminals: new Map(), activity: null, prompts: [], error: null });

function consume(state, line) {
  if (!line.trim()) return;
  let item;
  try { item = JSON.parse(line); } catch { state.error = 'invalid-rollout-json'; return; }
  const p = item.payload || item;
  if (item.type === 'session_meta') {
    state.meta = { id: p.session_id || p.id, cwd: p.cwd, source: p.source };
    return;
  }
  if (item.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(p.type)) {
    if (!p.turn_id || !Number.isFinite(time(item))) { state.error = 'invalid-lifecycle-event'; return; }
    // Retain lifecycle metadata only; never cache assistant output or tool bodies.
    const event = { timestamp: item.timestamp, payload: { type: p.type, turn_id: p.turn_id, error: p.error || null } };
    const events = p.type === 'task_started' ? state.starts : state.terminals;
    const previous = events.get(p.turn_id);
    if (newer(event, previous) || (!event.payload.error && time(event) === time(previous))) events.set(p.turn_id, event);
  }
  if (item.type === 'response_item' && p.type === 'message' && p.role === 'user') {
    const metadata = p.internal_chat_message_metadata_passthrough || {};
    const kinds = metadata.content_item_kinds || [];
    const text = (p.content || []).map(part => part.text || '').join('').trim();
    if (text && (!kinds.length || kinds.includes('user.text')) && !/^(?:# AGENTS\.md|<environment_context>|<recommended_plugins>)/.test(text)) {
      state.prompts.push({ text, timestamp: item.timestamp, turn_id: metadata.turn_id || null });
      state.prompts = state.prompts.sort((a, b) => time(a) - time(b)).slice(-12);
    }
  }
  const turnId = p.turn_id || p.internal_chat_message_metadata_passthrough?.turn_id;
  const actualActivity = item.type === 'token_usage_record' ||
    (item.type === 'event_msg' && ['item_started', 'item_completed'].includes(p.type) && p.item?.type !== 'UserMessage') ||
    (item.type === 'response_item' && (p.role === 'assistant' || /^(?:custom_tool_call|function_call)/.test(p.type)));
  if (actualActivity && turnId && (!p.thread_id || p.thread_id === state.meta?.id) && newer(item, state.activity)) {
    state.activity = { timestamp: item.timestamp, turn_id: turnId, type: p.type || item.type };
  }
}

function snapshot(state, root) {
  const meta = state.meta;
  if (!meta?.id || !meta.cwd || !inside(meta.cwd, root)) return null;
  // Internal reviewers/subagents are not independently recoverable Desktop tasks.
  if (JSON.stringify(meta.source || '').includes('subagent')) return null;
  const latestStarted = [...state.starts.values()].reduce((a, b) => newer(b, a) ? b : a, null);
  const terminal = latestStarted ? state.terminals.get(latestStarted.payload.turn_id) :
    [...state.terminals.values()].reduce((a, b) => newer(b, a) ? b : a, null);
  const latest = terminal && (!latestStarted || time(terminal) >= time(latestStarted)) ? terminal : latestStarted;
  return { id: meta.id, cwd: meta.cwd, latest, latestStarted, latestActivity: state.activity, userPrompts: state.prompts, observation_error: state.error };
}

export function parseSessionEvents(lines, root) {
  const state = fresh();
  for (const line of lines) consume(state, line);
  return snapshot(state, root);
}

// A rebuildable in-memory cursor. On restart scan all complete lines once, then
// read only appended bytes. A long tool output cannot evict a lifecycle event.
const cache = new Map();
export function readSession(file, root) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    let entry = cache.get(file);
    if (!entry || entry.ino !== stat.ino || entry.birth !== stat.birthtimeMs || stat.size < entry.offset ||
        (stat.size === entry.offset && stat.mtimeMs !== entry.mtime)) {
      entry = { ...fresh(), offset: 0, remainder: Buffer.alloc(0), ino: stat.ino, birth: stat.birthtimeMs };
    }
    const buffer = Buffer.alloc(256 * 1024);
    while (entry.offset < stat.size) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - entry.offset), entry.offset);
      if (!count) break;
      entry.offset += count;
      const bytes = Buffer.concat([entry.remainder, buffer.subarray(0, count)]);
      let start = 0, end;
      while ((end = bytes.indexOf(10, start)) !== -1) {
        consume(entry, bytes.subarray(start, end).toString('utf8'));
        start = end + 1;
      }
      entry.remainder = Buffer.from(bytes.subarray(start));
    }
    entry.mtime = stat.mtimeMs;
    cache.set(file, entry);
    const value = snapshot(entry, root);
    return value && { ...value, observation_error: value.observation_error || (entry.remainder.length ? 'rollout-write-in-progress' : null),
      rollout_file: file, rollout_mtime_ms: stat.mtimeMs, rollout_size: stat.size };
  } finally { fs.closeSync(fd); }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.jsonl') ? [path.join(dir, e.name)] : []);
}
export function inspect(root, home) {
  const sessions = new Map(); const errors = [];
  for (const file of walk(path.join(home, 'sessions'))) {
    try {
      const value = readSession(file, root);
      if (!value) continue;
      const old = sessions.get(value.id);
      const activityTime = s => Math.max(time(s.latest) || 0, time(s.latestActivity) || 0);
      if (!old || activityTime(value) > activityTime(old) ||
          (activityTime(value) === activityTime(old) && value.rollout_mtime_ms > old.rollout_mtime_ms)) sessions.set(value.id, value);
    } catch (error) { errors.push({ file: path.basename(file), code: error.code || 'read-error' }); }
  }
  const result = [...sessions.values()];
  result.errors = errors;
  return result;
}
