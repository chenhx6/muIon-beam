// Read-only rendering of service health and all preserved branches.
const panel = document.createElement('section');
const title = document.createElement('h2'); title.textContent = '运行监督与并行任务'; panel.append(title);
const services = document.createElement('p'); panel.append(services);
const plans = document.createElement('pre'); panel.append(plans);
const table = document.createElement('table'); table.style.width = '100%'; table.style.textAlign = 'left'; panel.append(table);
const artifacts = document.createElement('p'); panel.append(artifacts);
document.querySelector('h1').after(panel);
async function refreshSupervision() {
  try {
    const response = await fetch('/api/status'); if (!response.ok) throw new Error('状态读取失败');
    const data = await response.json(); const health = data.system_services;
    const stale = !health || Date.now() - Date.parse(health.checked_at) > 30000;
    services.textContent = (stale ? '监督状态尚未更新；' : '') + Object.entries(health?.services || {}).map(([name, value]) => `${name}: ${value.status}${value.pid ? ` (PID ${value.pid})` : ''}${value.reason ? ` — ${value.reason}` : ''}`).join(' ｜ ');
    services.style.color = stale || Object.values(health?.services || {}).some(value => value.status !== 'healthy') ? '#a33a17' : '#206a41';
    const progress = data.supervision;
    plans.textContent = (progress?.plans || []).map(plan => `${plan.task_id}\n阶段：${plan.current_phase || plan.status}\n下一步：${plan.next_action || '待记录'}`).join('\n\n');
    table.replaceChildren();
    const header = table.insertRow(); for (const text of ['Session / 分支', '状态', '阻塞原因 / 下一步']) { const cell = document.createElement('th'); cell.textContent = text; header.append(cell); }
    for (const session of progress?.sessions || []) {
      const row = table.insertRow(); row.insertCell().textContent = `${session.session_id}\n${session.branch || session.mode}`;
      row.insertCell().textContent = `${session.status} / ${session.host_status}`;
      row.insertCell().textContent = session.blockers.map(item => `${item.reason}: ${item.next_action}`).join('\n') || '无已登记阻塞';
    }
    artifacts.textContent = `活动 session：${progress?.counts.active || 0}；有阻塞的 session：${progress?.counts.blocked || 0}；未登记输出：${progress?.counts.unregistered_artifacts || 0}`;
  } catch(error) { services.textContent = error.message; services.style.color = '#a33a17'; }
}
refreshSupervision(); setInterval(refreshSupervision, 3000);
