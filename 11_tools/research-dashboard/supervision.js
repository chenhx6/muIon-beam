const $ = (selector) => document.querySelector(selector);
const text = (node, value) => { if (node) node.textContent = value == null || value === '' ? '—' : String(value); };

function normalizeStatus(value) { return String(value || 'unknown').toLowerCase(); }
function statusLabel(value) {
  const labels = { active: '运行中', running: '运行中', blocked: '已阻塞', failed: '失败', error: '失败', done: '已完成', complete: '已完成', completed: '已完成', succeeded: '已完成', closed: '已关闭', stopped: '已停止', disabled: '已停用', pending: '等待', unknown: '未知' };
  return labels[normalizeStatus(value)] || value || '未知';
}
function statusClass(value) {
  const status = normalizeStatus(value);
  if (['active', 'running', 'succeeded', 'done', 'complete', 'completed'].includes(status)) return 'badge-good';
  if (['blocked', 'pending', 'stopped', 'disabled'].includes(status)) return 'badge-warn';
  if (['failed', 'error'].includes(status)) return 'badge-bad';
  return 'badge-muted';
}
function badge(value) { const node = document.createElement('span'); node.className = `badge ${statusClass(value)}`; node.textContent = statusLabel(value); return node; }
function formatTime(value) {
  const timestamp = Date.parse(value || ''); if (!Number.isFinite(timestamp)) return '未知';
  const age = Math.max(0, Date.now() - timestamp); if (age < 60_000) return '刚刚';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分钟前`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}
function readable(value) { return typeof value === 'string' && value.trim() ? value.trim() : '—'; }
function effectiveSessionStatus(session) {
  if (Array.isArray(session.blockers) && session.blockers.length) return 'blocked';
  if (session.integration && String(session.integration).startsWith('blocked')) return 'blocked';
  if (session.status === 'active') return session.host_status === 'failed' ? 'failed' : 'active';
  return session.status || session.host_status || 'unknown';
}
function meta(label, value) {
  const item = document.createElement('div'); item.className = 'meta-item';
  const name = document.createElement('span'); name.className = 'meta-label'; name.textContent = label;
  const content = document.createElement('span'); content.className = 'meta-value'; content.textContent = readable(value);
  item.append(name, content); return item;
}
function listItem(value, className = '') { const li = document.createElement('li'); li.className = className; li.textContent = value; return li; }

function renderSessions(data) {
  const root = $('#session-list'); if (!root) return; root.replaceChildren();
  const sessions = [...(data.supervision?.sessions || [])].sort((a, b) => {
    const rank = (s) => s.status === 'active' || normalizeStatus(s.host_status) === 'running' ? 0 : 1;
    return rank(a) - rank(b) || String(a.display_name || '').localeCompare(String(b.display_name || ''), 'zh-CN');
  });
  text($('#session-count'), `${sessions.length} 个`);
  if (!sessions.length) { root.append(listItem('当前没有登记的 session。', 'empty')); return; }
  const plans = new Map((data.supervision?.plans || []).map((plan) => [plan.task_id, plan]));
  for (const session of sessions) {
    const card = document.createElement('article'); card.className = 'session-card';
    const head = document.createElement('div'); head.className = 'session-card-head';
    const titleBox = document.createElement('div'); const title = document.createElement('div'); title.className = 'session-name'; title.textContent = session.display_name || '未命名 session';
    const plan = plans.get(session.task_id); const kind = document.createElement('div'); kind.className = 'session-kind';
    kind.textContent = [session.task_name, session.mode].filter(Boolean).join(' · ') || '未登记任务名称';
    titleBox.append(title, kind); head.append(titleBox, badge(effectiveSessionStatus(session))); card.append(head);
    const metadata = document.createElement('div'); metadata.className = 'session-meta';
    metadata.append(meta('阶段', plan?.current_phase || session.mode), meta('宿主状态', session.host_status), meta('最后记录', formatTime(session.updated_at || session.lease_until)));
    card.append(metadata);
    const next = document.createElement('div'); next.className = 'session-next'; const nextLabel = document.createElement('strong'); nextLabel.textContent = '下一步';
    next.append(nextLabel, document.createTextNode(plan?.next_action || (session.integration && String(session.integration).startsWith('blocked') ? '处理集成阻塞' : '待记录'))); card.append(next);
    if (session.blockers?.length || session.display_name_conflict) {
      const blockers = document.createElement('ul'); blockers.className = 'blocker-list';
      if (session.display_name_conflict) blockers.append(listItem('名称重复，已加序号显示'));
      for (const blocker of session.blockers || []) blockers.append(listItem(`${blocker.reason || '阻塞'}：${blocker.next_action || '待处理'}`));
      card.append(blockers);
    }
    root.append(card);
  }
}

function renderTask(data) {
  const state = data.research_state || {}; const current = data.display?.current || {}; const task = current.task || state.current_task || {};
  const values = [task.objective || task.task_id || '无活动任务', current.phase || state.current_phase, state.workflow_status || '—'];
  const details = $('#task-details'); if (details) { [...details.querySelectorAll('dd')].forEach((node, index) => text(node, values[index])); }
  text($('#next-action'), data.display?.next_action || state.next_action || '无');
  const chips = $('#stage-chips'); if (!chips) return; chips.replaceChildren();
  const add = (label, valuesList) => { for (const value of valuesList || []) { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = `${label}：${value}`; chips.append(chip); } };
  add('已完成', data.display?.completed); add('待处理', data.display?.pending); add('阻塞', data.display?.blocked);
}

function renderPlans(data) {
  const root = $('#plan-list'); if (!root) return; root.replaceChildren(); const plans = data.supervision?.plans || [];
  if (!plans.length) { root.append(listItem('暂无计划记录。', 'empty')); return; }
  for (const plan of plans) { const item = document.createElement('li'); item.textContent = `${plan.task_id || '未命名任务'} · ${plan.current_phase || plan.status || '未知'} · 下一步：${plan.next_action || '待记录'}`; root.append(item); }
}

function renderHealth(data) {
  const root = $('#health-list'); if (!root) return; root.replaceChildren(); const services = Object.entries(data.system_services?.services || {}); const agents = data.agents || {};
  if (!services.length && !agents.available) { root.append(listItem('暂无独立健康记录。', 'empty')); return; }
  for (const [name, service] of services) { const item = document.createElement('li'); item.append(document.createTextNode(`${name}：`), badge(service.status), document.createTextNode(service.reason ? ` ${service.reason}` : '')); root.append(item); }
  const agent = document.createElement('li'); agent.textContent = `agents：总数 ${agents.total || 0}，运行 ${agents.running || 0}，完成 ${agents.done || 0}，失败 ${agents.failed || 0}`; root.append(agent);
}

function renderWarnings(data) {
  const root = $('#warning-list'); if (!root) return; root.replaceChildren(); const warnings = [...(data.warnings || []), ...(data.supervision?.warnings || [])];
  for (const session of data.supervision?.sessions || []) {
    if (session.display_name_source === 'generated') warnings.push(`${session.display_name}：没有可读名称`);
    if (session.display_name_conflict) warnings.push(`${session.display_name}：名称重复，已加序号区分`);
  }
  if (!warnings.length) { root.append(listItem('暂无警告。')); return; }
  for (const warning of warnings) root.append(listItem(warning));
}

function render(data) {
  const state = data.research_state || {}; const counts = data.supervision?.counts || {};
  text($('#metric-active'), counts.active || 0); text($('#metric-blocked'), counts.blocked || 0); text($('#metric-total'), counts.sessions || 0); text($('#metric-artifacts'), counts.unregistered_artifacts || 0);
  text($('#revision'), `State revision ${state.state_revision ?? '—'}`); text($('#last-update'), `最后更新 ${formatTime(data.display?.last_update || state.updated_at)}`);
  const current = data.display?.current || {}; const task = current.task || state.current_task || {}; text($('#current-summary'), `${task.objective || task.task_id || '无活动任务'} · 阶段：${current.phase || state.current_phase || '未知'} · 工作流：${state.workflow_status || '未知'}`);
  const connection = $('#connection-status'); if (connection) { connection.className = `badge ${statusClass(state.task_status || 'unknown')}`; connection.textContent = `任务 ${statusLabel(state.task_status || 'unknown')}`; }
  const services = Object.entries(data.system_services?.services || {}).map(([name, value]) => `${name}：${statusLabel(value.status)}`); text($('#service-summary'), services.length ? services.join(' · ') : '服务状态未登记');
  renderSessions(data); renderTask(data); renderPlans(data); renderHealth(data); renderWarnings(data); text($('#raw-status'), JSON.stringify(data, null, 2));
}

function renderError(error) {
  const connection = $('#connection-status'); if (connection) { connection.className = 'badge badge-bad'; connection.textContent = '读取失败'; }
  text($('#service-summary'), error.message || '状态读取失败'); const root = $('#session-list'); if (root) { root.replaceChildren(listItem('无法读取 session 状态，请检查 dashboard 服务。', 'empty')); }
  text($('#raw-status'), error.stack || error.message || String(error));
}

let inFlight = false;
async function refresh() {
  if (inFlight) return; inFlight = true;
  try { const response = await fetch('/api/status', { cache: 'no-store' }); if (!response.ok) throw new Error(`状态接口返回 ${response.status}`); render(await response.json()); }
  catch (error) { renderError(error); }
  finally { inFlight = false; }
}
refresh(); setInterval(refresh, 3000);
