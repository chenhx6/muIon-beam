const $ = selector => document.querySelector(selector);

function timeAgo(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) return '最近活动时间未知';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (!minutes) return '刚刚更新';
  if (minutes < 60) return minutes + ' 分钟前更新';
  if (minutes < 1440) return Math.floor(minutes / 60) + ' 小时前更新';
  return Math.floor(minutes / 1440) + ' 天前更新';
}

function sessionCard(session) {
  const card = document.createElement('article');
  card.className = 'session';
  const head = document.createElement('div');
  head.className = 'session-head';
  const name = document.createElement('div');
  name.className = 'session-name';
  name.textContent = session.display_name || '未命名任务';
  const badge = document.createElement('span');
  badge.className = 'badge ' + (session.board_group === 'running' ? 'ok' : ['已中断', '已阻塞'].includes(session.board_label) ? 'bad' : 'warn');
  badge.textContent = session.board_label || '状态未知';
  head.append(name, badge);
  card.append(head);

  const metaParts = [timeAgo(session.last_observed_at), session.location_label].filter(Boolean);
  const meta = document.createElement('div');
  meta.className = 'session-meta';
  meta.textContent = metaParts.join(' · ');
  card.append(meta);

  if (session.current_step || session.plan_progress || session.waiting_for || session.running_subagents != null) {
    const detail = document.createElement('div');
    detail.className = 'session-detail';
    if (session.current_step) {
      const step = document.createElement('div');
      step.className = 'session-step';
      step.textContent = '当前步骤：' + session.current_step;
      detail.append(step);
    }
    if (session.plan_progress?.total) {
      const progress = document.createElement('div');
      progress.className = 'session-progress';
      const label = document.createElement('span');
      label.textContent = '计划进度：' + session.plan_progress.completed + '/' + session.plan_progress.total +
        '（' + session.plan_progress.percent + '%）';
      const meter = document.createElement('progress');
      meter.max = 100;
      meter.value = session.plan_progress.percent || 0;
      meter.setAttribute('aria-label', label.textContent);
      progress.append(label, meter);
      detail.append(progress);
    }
    if (session.waiting_for) {
      const waiting = document.createElement('div');
      waiting.className = 'session-wait';
      waiting.textContent = '等待：' + session.waiting_for;
      detail.append(waiting);
    }
    if (session.running_subagents != null) {
      const agents = document.createElement('div');
      agents.className = 'session-agents';
      agents.textContent = '运行中的子 agent：' + session.running_subagents;
      detail.append(agents);
    }
    card.append(detail);
  }

  const next = document.createElement('div');
  next.className = 'session-next';
  const action = document.createElement('span');
  action.textContent = session.next_action || session.board_reason || (session.board_group === 'running' ? '任务正在运行' : '检查后继续此任务');
  next.append(action);
  if (session.host_session_id) {
    const link = document.createElement('a');
    link.href = 'codex://threads/' + encodeURIComponent(session.host_session_id);
    link.textContent = session.board_group === 'running' ? '查看' : '继续';
    next.append(link);
  }
  card.append(next);
  return card;
}

function render(data) {
  const sessions = data.supervision?.sessions || [];
  const active = sessions.filter(session => session.board_group === 'running');
  const pending = sessions.filter(session => session.board_group === 'needs-attention');
  $('#active-count').textContent = active.length;
  $('#pending-count').textContent = pending.length;
  for (const [id, rows, emptyText] of [
    ['active-list', active, '当前没有正在工作的 session。'],
    ['pending-list', pending, '当前没有需要处理的 session。'],
  ]) {
    const list = $('#' + id);
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = emptyText;
      list.append(empty);
    } else {
      for (const session of rows) list.append(sessionCard(session));
    }
  }
  const services = data.system_services?.services || {};
  const serviceRoot = $('#services');
  serviceRoot.replaceChildren();
  for (const name of ['farmer', 'dashboard']) {
    const service = services[name];
    if (!service) continue;
    const item = document.createElement('span');
    item.className = 'service ' + (service.status === 'healthy' ? 'ok' : ['disabled', 'stopped'].includes(service.status) ? 'warn' : 'bad');
    const dot = document.createElement('i');
    dot.className = 'dot';
    const value = document.createElement('span');
    value.textContent = name + ' ' + (service.status === 'healthy' ? '正常' : service.status === 'disabled' ? '已暂停' : service.status);
    item.append(dot, value);
    serviceRoot.append(item);
  }
  const governance = data.supervision?.artifact_counts || {};
  const governanceGrid = $('#file-governance-grid');
  governanceGrid.replaceChildren();
  for (const [label, count] of [
    ['待登记项目文件', governance.durable_unregistered],
    ['阻塞输出', governance.blocked],
  ]) {
    const item = document.createElement('span');
    item.textContent = label;
    const value = document.createElement('strong');
    value.textContent = String(count || 0);
    item.append(value);
    governanceGrid.append(item);
  }
  const connection = $('#connection');
  connection.hidden = !(data.supervision?.warnings || []).length;
  connection.className = 'service ' + (connection.hidden ? 'ok' : 'warn');
  connection.replaceChildren();
  const dot = document.createElement('i');
  dot.className = 'dot';
  const status = document.createElement('span');
  status.textContent = connection.hidden ? '状态数据正常' : '部分 session 状态不可用';
  connection.append(dot, status);
  const observed = Date.parse(data.generated_at || '');
  $('#updated').textContent = Number.isFinite(observed)
    ? '更新于 ' + new Date(observed).toLocaleTimeString('zh-CN', { hour12: false }) + ' · 每 3 秒刷新'
    : '更新时间未知';
}

async function refresh() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('status ' + response.status);
    render(await response.json());
  } catch {
    const connection = $('#connection');
    connection.hidden = false;
    connection.className = 'service bad';
    connection.textContent = '看板连接中断';
    for (const id of ['active-count', 'pending-count']) $('#' + id).textContent = '—';
    for (const id of ['active-list', 'pending-list']) {
      const list = $('#' + id);
      list.replaceChildren();
      const item = document.createElement('div');
      item.className = 'empty';
      item.textContent = '暂时无法读取 session 状态。';
      list.append(item);
    }
    $('#file-governance-grid').replaceChildren();
  }
}

refresh();
setInterval(refresh, 3000);
