import fs from 'node:fs';
import path from 'node:path';
import { listSessions, heartbeatSession, checkSession } from '../../.codex/skills/team/scripts/session-concurrency.mjs';
import { ArtifactCatalog } from './artifact-catalog.mjs';
import { buildPromotionPlan } from './artifact-promoter.mjs';

export class WorkerRuntime {
  constructor(root, store) { this.root = root; this.store = store; }
  tick() {
    const file = path.join(this.root, '_work/current/farmer/state.json');
    const hosts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const workers = []; const previous = this.store.read('workers.json', { workers: [] });
    for (const session of listSessions({ root: this.root })) {
      if (session.status !== 'active' || !session.host_session_id) continue;
      const host = hosts[session.host_session_id];
      const checked = checkSession({ root: this.root, sessionId: session.session_id });
      const old = previous.workers.find(item => item.session_id === session.session_id);
      if (host && host.status !== 'running' && old?.host_status !== host.status) {
        const record = new ArtifactCatalog(this.root).inspect(session);
        const plan = buildPromotionPlan(this.root, record);
        fs.writeFileSync(path.join(this.root, '_work/current/artifact-triage', `${session.session_id}.promotion-plan.json`), `${JSON.stringify(plan, null, 2)}\n`);
      }
      if (host?.status === 'running' && checked.status === 'ready') heartbeatSession({ root: this.root, sessionId: session.session_id, token: session.owner_token });
      workers.push({ session_id: session.session_id, host_status: host?.status || 'unobserved', ownership_status: checked.status, outside_claim_paths: checked.outside_claim_paths });
    }
    if (JSON.stringify(previous.workers) !== JSON.stringify(workers)) this.store.event('worker-health-changed', { workers });
    this.store.write('workers.json', { checked_at: new Date().toISOString(), workers });
    return workers;
  }
}
