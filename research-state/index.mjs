import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../.codex/skills/muion-project/scripts/yaml-lite.mjs';

const LOCK_WAIT_MS = 5000;
const LOCK_POLL_MS = 100;
const STALE_LOCK_MS = 10 * 60 * 1000;

function stateDir(root) { return path.join(root, 'research-state'); }
function stateFile(root) { return path.join(stateDir(root), 'state.yaml'); }
function nowIso() { return new Date().toISOString(); }
function hashText(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function hashFile(file) { return hashText(fs.readFileSync(file, 'utf8')); }

export function makeId(prefix, { now = new Date(), random = crypto.randomUUID() } = {}) {
  const stamp = now.toISOString().replace(/[-:TZ]/g, '').replace('.', '-').slice(0, 18);
  return `${prefix}-${stamp}-${String(random).replaceAll('-', '').slice(0, 8)}`;
}

function defaultState() {
  return {
    schema_version: '1.0.0', state_revision: 0, updated_at: null,
    context_id: null, entrypoint: null, context_kind: null, legacy_phase: 'idle',
    current_goal: null, current_question: null, current_task: null,
    current_phase: 'idle', task_status: 'IDLE', completed_stages: [],
    blocked_reason: null, next_action: 'deep-interview', active_contract: null,
    related_open_problems: [], last_result: null, last_validation: null
  };
}

function readStructured(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!text) return fallback;
  if (text.startsWith('{') || text.startsWith('[')) return JSON.parse(text);
  return parseYaml(text);
}

function writeStructured(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function appendJsonLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try { fs.writeSync(fd, `${JSON.stringify(value)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function readEvents(root) {
  const file = path.join(stateDir(root), 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean); const events = [];
  for (const [index, line] of lines.entries()) {
    let value; try { value = JSON.parse(line); } catch { throw new Error(`research-state events.jsonl invalid JSON at line ${index + 1}`); }
    for (const field of ['event_id', 'transaction_id', 'event_phase', 'occurred_at']) if (!value[field]) throw new Error(`research-state event missing ${field} at line ${index + 1}`);
    events.push(value);
  }
  return events;
}

function recoverTransactions(root) {
  const events = readEvents(root); const byTx = new Map();
  for (const event of events) { if (!byTx.has(event.transaction_id)) byTx.set(event.transaction_id, []); byTx.get(event.transaction_id).push(event); }
  const state = readState(root, { auditEvents: false });
  for (const [transactionId, txEvents] of byTx) {
    const prepare = txEvents.find((event) => event.event_phase === 'prepare');
    const terminal = txEvents.some((event) => ['commit', 'abort', 'recovery'].includes(event.event_phase));
    if (!prepare || terminal) continue;
    const currentHash = hashFile(stateFile(root));
    if (state.state_revision === prepare.state_revision_after && currentHash === prepare.state_sha256) {
      appendEvent(root, { ...prepare, event_id: makeId('EVT'), event_phase: 'commit', occurred_at: nowIso(), actor: 'recovery' });
    } else if (state.state_revision === prepare.state_revision_before) {
      appendEvent(root, { ...prepare, event_id: makeId('EVT'), event_phase: 'abort', occurred_at: nowIso(), actor: 'recovery' });
    } else {
      const blocked = { ...state, state_revision: Number(state.state_revision || 0) + 1, updated_at: nowIso(), task_status: 'BLOCKED', current_phase: 'blocked', blocked_reason: `unrecoverable state transaction ${transactionId}`, next_action: 'state-audit' };
      writeStructured(stateFile(root), blocked); renderNow(root);
      appendEvent(root, { ...prepare, event_id: makeId('EVT'), event_phase: 'recovery', occurred_at: nowIso(), state_revision_after: blocked.state_revision, state_sha256: hashFile(stateFile(root)), actor: 'recovery' });
      throw new Error(`research-state transaction requires audit: ${transactionId}`);
    }
  }
}

function lockFile(root) { return path.join(root, '_work', 'current', 'research-state', 'state.lock'); }
function processAlive(pid) { try { process.kill(Number(pid), 0); return true; } catch { return false; } }

function acquireLock(root, operation, contextId = null) {
  const file = lockFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = makeId('LOCK');
  const started = Date.now();
  while (Date.now() - started <= LOCK_WAIT_MS) {
    try {
      const payload = { lock_token: token, operation, context_id: contextId, pid: process.pid, host: process.env.COMPUTERNAME || 'local', acquired_at: nowIso(), state_revision: readState(root).state_revision };
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, `${JSON.stringify(payload, null, 2)}\n`); fs.closeSync(fd);
      return { file, token, payload };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner = null; try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      const stale = owner && Date.now() - Date.parse(owner.acquired_at || 0) > STALE_LOCK_MS && !processAlive(owner.pid);
      if (stale) {
        const staleFile = `${file}.stale-${makeId('LOCK')}.json`;
        try { fs.renameSync(file, staleFile); appendJsonLine(path.join(stateDir(root), 'events.jsonl'), { schema_version: '1.0.0', event_id: makeId('EVT'), transaction_id: makeId('TX'), event_phase: 'recovery', occurred_at: nowIso(), context_id: contextId, operation: 'stale-lock-recovered', payload_refs: [path.relative(root, staleFile).replaceAll('\\', '/')], actor: 'recovery' }); } catch {}
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_MS);
    }
  }
  const error = new Error('research-state lock contention'); error.code = 'LOCK_CONTENTION'; throw error;
}

function releaseLock(lock) {
  if (!lock) return;
  try {
    const owner = JSON.parse(fs.readFileSync(lock.file, 'utf8'));
    if (owner.lock_token === lock.token) fs.unlinkSync(lock.file);
  } catch {}
}

export function readState(root, { auditEvents = true } = {}) {
  const state = readStructured(stateFile(root), defaultState());
  if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.state_revision !== 'number') throw new Error('research-state state.yaml is invalid');
  if (auditEvents && fs.existsSync(path.join(stateDir(root), 'events.jsonl'))) readEvents(root);
  return state;
}

export function ensureInitialized(root = process.cwd()) {
  fs.mkdirSync(stateDir(root), { recursive: true });
  const lock = acquireLock(root, 'ensure-initialized');
  try {
    if (!fs.existsSync(stateFile(root))) writeStructured(stateFile(root), defaultState());
    const now = path.join(stateDir(root), 'NOW.md'); if (!fs.existsSync(now)) fs.writeFileSync(now, '# MUON-ION NOW\n\nStatus: IDLE\n\nSource: state.yaml\n', 'utf8');
    const problems = path.join(stateDir(root), 'open-problems.yaml'); if (!fs.existsSync(problems)) writeStructured(problems, []);
    const decisions = path.join(stateDir(root), 'decision-log.md'); if (!fs.existsSync(decisions)) fs.writeFileSync(decisions, '# Decision Log\n\n', 'utf8');
    const events = path.join(stateDir(root), 'events.jsonl'); if (!fs.existsSync(events)) fs.writeFileSync(events, '', 'utf8');
    recoverTransactions(root);
  } finally { releaseLock(lock); }
  return readState(root);
}

function appendEvent(root, event) { appendJsonLine(path.join(stateDir(root), 'events.jsonl'), event); }

function renderNowContent(state, problems = []) {
  const task = state.current_task?.task_id || state.context_id || 'none';
  const problemLines = (state.related_open_problems || []).map((id) => `- ${id}`).join('\n') || '- none';
  return `# MUON-ION NOW\n\nState revision: ${state.state_revision}\n\n## Current Goal\n${state.current_goal?.statement || 'none'}\n\n## Current Task\n${task}\n\n## Current Phase\n${state.current_phase}\n\n## Progress\n${state.task_status}\n\n## Completed\n${(state.completed_stages || []).map((v) => `- ${v}`).join('\n') || '- none'}\n\n## Running\n${state.task_status === 'RUNNING' ? `- ${task}` : '- none'}\n\n## Blocked\n${state.blocked_reason || 'none'}\n\n## Open Problems\n${problemLines}\n\n## Next\n${state.next_action || 'none'}\n\nSource: state.yaml\n`;
}

export function renderNow(root = process.cwd()) {
  const state = readState(root); const problems = readStructured(path.join(stateDir(root), 'open-problems.yaml'), []);
  const file = path.join(stateDir(root), 'NOW.md'); const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, renderNowContent(state, problems), 'utf8'); fs.renameSync(temp, file); return file;
}

export function renderChatStatus(root = process.cwd()) {
  const state = readState(root); const id = state.current_task?.task_id || state.context_id || 'IDLE';
  return `[MUON-ION] ${id} │ ${state.task_status} │ ${state.current_phase} │ next: ${state.next_action || 'none'}`;
}

function mutate(root, operation, contextId, update, sideEffect = null) {
  ensureInitialized(root);
  const lock = acquireLock(root, operation, contextId);
  try {
    const before = readState(root); if (operation !== 'begin-context' && contextId && before.context_id && before.context_id !== contextId) throw new Error(`context ownership mismatch: ${before.context_id}`);
    const next = { ...before, ...update(before) };
    next.state_revision = Number(before.state_revision || 0) + 1; next.updated_at = nowIso();
    const tx = makeId('TX'); const prepare = { schema_version: '1.0.0', event_id: makeId('EVT'), transaction_id: tx, event_phase: 'prepare', occurred_at: nowIso(), context_id: contextId, entrypoint: next.entrypoint, operation, state_revision_before: before.state_revision, state_revision_after: next.state_revision, state_sha256: hashText(`${JSON.stringify(next, null, 2)}\n`), payload_refs: [], actor: 'codex' };
    appendEvent(root, prepare);
    if (sideEffect) sideEffect(next);
    writeStructured(stateFile(root), next); renderNow(root);
    appendEvent(root, { ...prepare, event_id: makeId('EVT'), event_phase: 'commit', occurred_at: nowIso(), state_sha256: hashFile(stateFile(root)) });
    return next;
  } finally { releaseLock(lock); }
}

export function beginContext(context = {}) {
  const root = context.root || process.cwd(); ensureInitialized(root); const current = readState(root);
  const contextId = context.context_id || makeId('CTX'); const taskId = context.task_id || makeId('TASK');
  if (current.context_id && current.context_id !== contextId) throw new Error(`foreground context already running: ${current.context_id}`);
  return mutate(root, 'begin-context', contextId, (before) => ({ context_id: contextId, entrypoint: context.entrypoint || 'research-workflow', context_kind: context.context_kind || 'workflow', current_goal: context.current_goal || null, current_question: context.current_question || context.objective || null, current_task: { task_id: taskId, module: context.module || null, objective: context.objective || null, external_task_id: context.external_task_id || null, status: 'RUNNING' }, current_phase: context.current_phase || 'intake', task_status: 'RUNNING', completed_stages: before.context_id === contextId ? before.completed_stages : [], blocked_reason: null, next_action: context.next_action || 'contract', active_contract: before.context_id === contextId ? before.active_contract : null, last_result: before.context_id === contextId ? before.last_result : null, last_validation: before.context_id === contextId ? before.last_validation : null }));
}

export function recordDispatch(contextId, dispatch, root = process.cwd()) {
  return mutate(root, 'dispatch', contextId, (before) => ({ current_phase: 'module-execution', task_status: 'RUNNING', active_contract: dispatch.contract || null, next_action: 'result-collection', current_task: before.current_task ? { ...before.current_task, attempt_id: dispatch.attempt_id || null } : before.current_task }));
}

export function recordModuleResult(contextId, result, root = process.cwd()) {
  return mutate(root, 'module-result', contextId, (before) => ({ current_phase: 'validation', task_status: result.status === 'BLOCKED' || result.status === 'FAILED' ? result.status : 'PARTIAL', last_result: result, next_action: 'validation', current_task: before.current_task ? { ...before.current_task, status: result.status } : before.current_task }));
}

export function recordValidation(contextId, validation, root = process.cwd()) {
  return mutate(root, 'validation', contextId, () => ({ current_phase: 'diagnosis', last_validation: validation, next_action: 'diagnosis' }));
}

export function recordDiagnosis(contextId, diagnosis, root = process.cwd()) {
  return mutate(root, 'diagnosis', contextId, () => ({ current_phase: 'decision', next_action: diagnosis.next_action || 'research-decision' }));
}

export function recordDecision(contextId, decision, root = process.cwd()) {
  return mutate(root, 'decision', contextId, () => ({ current_phase: 'decision', next_action: decision.next_action || 'close-context', related_open_problems: decision.related_open_problems || [] }), (next) => {
    fs.appendFileSync(path.join(stateDir(root), 'decision-log.md'), `\n## ${next.updated_at} ${contextId}\n\n${decision.summary || decision.statement || 'decision recorded'}\n`);
  });
}

export function closeContext(contextId, finalStatus = 'IDLE', root = process.cwd()) {
  return mutate(root, 'close-context', contextId, (before) => ({ context_id: null, entrypoint: null, context_kind: null, current_task: null, current_phase: 'idle', task_status: 'IDLE', blocked_reason: finalStatus === 'BLOCKED' ? (before.blocked_reason || 'context closed as blocked') : null, next_action: finalStatus === 'SUCCESS' ? 'idle' : 'new-research-decision', active_contract: null, completed_stages: [...(before.completed_stages || []), `${before.current_phase}:${finalStatus}`] }));
}

export function setWorkflowPhase(root = process.cwd(), phase = 'idle', activeGoalId = null) {
  const phaseMap = { idle: ['idle', 'IDLE'], interview: ['intake', 'PLANNED'], planned: ['contract', 'PLANNED'], approved: ['dispatch', 'PLANNED'], running: ['module-execution', 'RUNNING'], review: ['validation', 'RUNNING'], qa: ['validation', 'RUNNING'], archived: ['idle', 'IDLE'], published: ['idle', 'IDLE'], synced: ['idle', 'IDLE'], blocked: ['blocked', 'BLOCKED'] };
  const mapped = phaseMap[phase]; if (!mapped) throw new Error(`invalid workflow phase: ${phase}`);
  const current = readState(root); if (current.context_id && phase !== 'idle') throw new Error(`cannot change compatibility phase while context is active: ${current.context_id}`);
  return mutate(root, 'compat-workflow-phase', null, () => ({ legacy_phase: phase, current_phase: mapped[0], task_status: mapped[1], current_goal: activeGoalId ? { id: activeGoalId, statement: null } : null, blocked_reason: phase === 'blocked' ? 'legacy workflow phase blocked' : null }));
}

export function repairViews(root = process.cwd()) { ensureInitialized(root); return renderNow(root); }

function argValue(args, name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; }
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2); const root = path.resolve(argValue(args, '--root') || process.cwd()); const command = args[0];
  try {
    if (command === 'init') console.log(JSON.stringify(ensureInitialized(root), null, 2));
    else if (command === 'status') console.log(JSON.stringify({ state: readState(root), chat: renderChatStatus(root) }, null, 2));
    else if (command === 'repair') console.log(JSON.stringify({ now: repairViews(root) }, null, 2));
    else if (command === 'begin') console.log(JSON.stringify(beginContext({ root, entrypoint: argValue(args, '--entrypoint') || 'validation', context_kind: argValue(args, '--context-kind') || 'validation', task_id: argValue(args, '--task-id') || undefined, objective: argValue(args, '--objective') || null }), null, 2));
    else if (command === 'validation') console.log(JSON.stringify(recordValidation(argValue(args, '--context-id'), { status: argValue(args, '--status') || 'not-evaluated', reference: argValue(args, '--reference') || null }, root), null, 2));
    else if (command === 'diagnosis') console.log(JSON.stringify(recordDiagnosis(argValue(args, '--context-id'), { next_action: argValue(args, '--next') || 'research-decision', reference: argValue(args, '--reference') || null }, root), null, 2));
    else if (command === 'close') console.log(JSON.stringify(closeContext(argValue(args, '--context-id'), argValue(args, '--status') || 'PARTIAL', root), null, 2));
    else throw new Error('Usage: node research-state/index.mjs init|status|repair|begin|validation|diagnosis|close [--root path]');
  } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}
