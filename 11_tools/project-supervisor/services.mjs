import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { alive } from './runtime-store.mjs';

export function launchNode(script, args, { cwd, log, env = {} }) {
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'a');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, ...env }, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve({ pid: child.pid }); });
  });
}

export class FarmerService {
  name = 'farmer';
  constructor(root) { this.root = root; }
  async health() {
    const runtime = path.join(this.root, '_work/current/farmer');
    let owner; try { owner = JSON.parse(fs.readFileSync(path.join(runtime, 'lock.json'), 'utf8')); } catch { return { status: 'stopped' }; }
    if (!alive(owner.pid)) return { status: 'stopped' };
    let heartbeat; try { heartbeat = JSON.parse(fs.readFileSync(path.join(runtime, 'health.json'), 'utf8')); } catch {}
    const fresh = heartbeat?.pid === owner.pid && Date.now() - Date.parse(heartbeat.checked_at) < 30000;
    return { status: fresh ? 'healthy' : 'degraded', pid: owner.pid, detail: fresh ? null : 'running process has no recent supervision heartbeat' };
  }
  async start() {
    const result = spawnSync(process.execPath, [path.join(this.root, '.codex/skills/farmer/farmer.mjs'), 'ensure', '--project-root', this.root], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (result.status !== 0) throw new Error(result.stderr || 'farmer ensure failed');
    const value = JSON.parse(result.stdout); return { pid: value.started_pid || value.pid };
  }
}

export class DashboardService {
  name = 'dashboard';
  constructor(root, store, port = 4317) { this.root = root; this.store = store; this.port = port; }
  async health() {
    const url = `http://127.0.0.1:${this.port}/api/health`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      const data = await response.json();
      if (!response.ok || data.service !== 'muion-research-dashboard' || path.resolve(data.project_root || '').toLowerCase() !== path.resolve(this.root).toLowerCase()) {
        return { status: 'blocked', reason: 'dashboard-port-owned-by-another-service', url };
      }
      // A healthy listener must also serve the actual status view.
      const status = await fetch(`http://127.0.0.1:${this.port}/api/status`, { signal: AbortSignal.timeout(2000) });
      if (!status.ok || !(await status.json()).display) return { status: 'degraded', pid: data.pid, url, detail: 'dashboard status unavailable' };
      return { status: 'healthy', pid: data.pid, url };
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') return { status: 'stopped', url };
      return { status: 'blocked', reason: 'dashboard-health-unavailable', detail: error.message, url };
    }
  }
  start() {
    return launchNode(path.join(this.root, '11_tools/research-dashboard/server.mjs'), [], { cwd: this.root, log: this.store.file('dashboard.log'), env: { RESEARCH_DASHBOARD_PORT: String(this.port) } });
  }
}
