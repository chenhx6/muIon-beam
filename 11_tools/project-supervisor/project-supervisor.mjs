import { RuntimeStore } from './runtime-store.mjs';
import { FarmerService, DashboardService } from './services.mjs';
import { ProcessSupervisor } from './process-supervisor.mjs';
import { loadProjectContext } from './project-context.mjs';
import { SessionBootstrapper } from './session-bootstrapper.mjs';
import { WorkerRuntime } from './worker-runtime.mjs';

// Composition root: no solver decisions, publication or scientific-state writes.
export class ProjectSupervisor {
  constructor(root, { store = new RuntimeStore(root), services, port = 4317 } = {}) {
    this.root = root; this.store = store;
    this.processes = new ProcessSupervisor(store, services || [new FarmerService(root), new DashboardService(root, store, port)]);
    this.sessions = new SessionBootstrapper(root, store);
    this.workers = new WorkerRuntime(root, store);
  }
  async ensure() { return this.processes.ensure(); }
  async enter({ sessionId, sessionName = null, source = 'agent-entry', intent = 'write', ownedPaths = [] } = {}) {
    const context = loadProjectContext(this.root); const services = await this.ensure();
    const session = sessionId ? await this.sessions.enter({ sessionId, sessionName, intent, ownedPaths }) : null;
    const record = { schema_version: 1, session_id: sessionId || null, source, entered_at: new Date().toISOString(), services, session, context_paths: context.map(item => item.path) };
    this.store.event('session-entered', record);
    return { ...record, ready: Object.values(services).every(service => service.status === 'healthy') && (!session || session.status === 'active'), context };
  }
}
