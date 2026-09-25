const $ = selector => document.querySelector(selector);
const label = value => String(value || 'unknown').toLowerCase();
const activeStates = new Set(['active', 'running']);
const closedStates = new Set(['closed', 'complete', 'completed', 'done', 'succeeded', 'success', 'archived', 'expired']);
const stateText = status => ({ active:'运行中', running:'运行中', interrupted:'已中断', failed:'失败', error:'失败', cancelled:'已取消', canceled:'已取消', abandoned:'已中断', blocked:'已阻塞', submitted:'等待集成', stale:'可能已中断', 'session-unavailable':'状态未知' }[label(status)] || '待处理');
const stateClass = status => activeStates.has(label(status)) ? 'ok' : ['failed','error'].includes(label(status)) ? 'bad' : 'warn';

function timeAgo(value) {
  const time = Date.parse(value || ''); if (!Number.isFinite(time)) return '最近活动时间未知';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (!minutes) return '刚刚更新';
  if (minutes < 60) return `${minutes} 分钟前更新`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前更新`;
  return `${Math.floor(minutes / 1440)} 天前更新`;
}

function sessionCard(session, plan) {
  const card = document.createElement('article'); card.className = 'session';
  const head = document.createElement('div'); head.className = 'session-head';
  const name = document.createElement('div'); name.className = 'session-name'; name.textContent = session.display_name || session.name || '任务名称未登记';
  const badge = document.createElement('span'); badge.className = `badge ${stateClass(session.stale ? 'stale' : session.status)}`; badge.textContent = session.stale ? stateText('stale') : stateText(session.status);
  head.append(name, badge); card.append(head);
  const meta = document.createElement('div'); meta.className = 'session-meta';
  const parts = [timeAgo(session.last_observed_at || session.updated_at), session.task_name && session.task_name !== (session.display_name || session.name) ? session.task_name : null].filter(Boolean);
  meta.textContent = parts.join(' · '); card.append(meta);
  const next = document.createElement('div'); next.className = 'session-next';
  const action = document.createElement('span');
  action.textContent = session.next_action || (session.stale ? plan?.next_action || '检查后继续此任务' : activeStates.has(label(session.status)) ? '任务正在运行' : plan?.next_action || session.blockers?.[0]?.next_action || (label(session.status) === 'submitted' ? '等待集成' : '需要继续此任务'));
  next.append(action);
  const id = session.host_session_id || session.session_id;
  if (id) { const link = document.createElement('a'); link.href = `codex://threads/${encodeURIComponent(id)}`; link.textContent = activeStates.has(label(session.status)) && !session.stale ? '查看' : '继续'; next.append(link); }
  card.append(next); return card;
}

function render(data) {
  const sessions = (data.supervision?.sessions || []).filter(session => !closedStates.has(label(session.status)));
  const active = sessions.filter(session => activeStates.has(label(session.status)) && !session.stale);
  const pending = sessions.filter(session => !active.includes(session));
  $('#active-count').textContent = active.length; $('#pending-count').textContent = pending.length;
  const plans = new Map((data.supervision?.plans || []).map(plan => [plan.task_id, plan]));
  for (const [id, rows, emptyText] of [['active-list',active,'当前没有正在工作的 session。'],['pending-list',pending,'当前没有中断或待处理的 session。']]) {
    const list = $(`#${id}`); list.replaceChildren();
    if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = emptyText; list.append(empty); continue; }
    for (const session of rows) list.append(sessionCard(session, plans.get(session.task_id)));
  }
  const services = data.system_services?.services || {}; const root = $('#services'); root.replaceChildren();
  for (const name of ['farmer']) {
    const service = services[name]; if (!service) continue;
    const item = document.createElement('span'); item.className = `service ${service.status === 'healthy' ? 'ok' : ['disabled','stopped'].includes(service.status) ? 'warn' : 'bad'}`;
    const dot = document.createElement('i'); dot.className = 'dot'; const value = document.createElement('span'); value.textContent = `${name === 'farmer' ? 'farmer' : 'dashboard'} ${service.status === 'healthy' ? '正常' : service.status === 'disabled' ? '已暂停' : service.status}`;
    item.append(dot,value); root.append(item);
  }
  const connection = $('#connection'); connection.hidden = !data.supervision?.warnings?.length; connection.className = `service ${data.supervision?.warnings?.length ? 'warn' : 'ok'}`;
  connection.replaceChildren(); const dot = document.createElement('i'); dot.className='dot'; const status = document.createElement('span'); status.textContent=data.supervision?.warnings?.length?'部分 session 状态不可用':'已连接'; connection.append(dot,status);
  const observed = Date.parse(data.generated_at || ''); $('#updated').textContent = Number.isFinite(observed) ? `更新于 ${new Date(observed).toLocaleTimeString('zh-CN',{hour12:false})} · 每 3 秒刷新` : '更新时间未知';
}

async function refresh() {
  try {
    const response = await fetch('/api/status',{cache:'no-store'}); if (!response.ok) throw new Error(`status ${response.status}`);
    render(await response.json());
  } catch {
    const connection=$('#connection'); connection.hidden=false; connection.className='service bad'; connection.textContent='看板连接中断';
    for (const id of ['active-count','pending-count']) $(`#${id}`).textContent='—';
    for (const id of ['active-list','pending-list']) { const list=$(`#${id}`); list.replaceChildren(); const item=document.createElement('div'); item.className='empty'; item.textContent='暂时无法读取 session 状态。'; list.append(item); }
  }
}

refresh(); setInterval(refresh,3000);
