import { setTimeout as delay } from 'node:timers/promises';

export class ProcessSupervisor {
  constructor(store, services, { startTimeoutMs = 6000, pollMs = 100 } = {}) { Object.assign(this, { store, services, startTimeoutMs, pollMs }); }
  async status() { return Object.fromEntries(await Promise.all(this.services.map(async service => [service.name, await service.health()]))); }
  async restart(name) {
    const service = this.services.find(item => item.name === name);
    if (!service) throw new Error(`unknown managed service: ${name}`);
    await this.store.exclusive('processes', async () => {
      const state = await service.health();
      if (state.status === 'blocked' || state.status === 'starting') throw new Error(`cannot safely restart ${name}: ${state.status}`);
      if (state.status === 'healthy' || state.status === 'degraded') {
        const pid = Number(state.pid);
        if (!Number.isInteger(pid) || pid <= 0) throw new Error(`cannot safely restart ${name} without a verified process id`);
        try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        const deadline = Date.now() + this.startTimeoutMs;
        let stopped = await service.health();
        while (stopped.status !== 'stopped' && Date.now() < deadline) {
          if (stopped.status === 'blocked' || stopped.pid && Number(stopped.pid) !== pid) throw new Error(`service identity changed while stopping ${name}`);
          await delay(this.pollMs); stopped = await service.health();
        }
        if (stopped.status !== 'stopped') throw new Error(`managed service did not stop: ${name}`);
      } else if (state.status !== 'stopped' && state.status !== 'disabled') {
        throw new Error(`cannot safely restart ${name}: ${state.status || 'unknown'}`);
      }
    });
    return this.ensure();
  }
  async ensure() {
    return this.store.exclusive('processes', async () => {
      const previous = this.store.read('processes.json', { services: {} }); const current = {};
      for (const service of this.services) {
        let state;
        try {
          state = await service.health();
          if (state.status === 'disabled') { current[service.name] = state; continue; }
          if (state.status === 'stopped' || state.status === 'starting') {
            if (state.status === 'stopped') await service.start();
            const deadline = Date.now() + this.startTimeoutMs;
            do { await delay(this.pollMs); state = await service.health(); } while (['stopped','starting'].includes(state.status) && Date.now() < deadline);
            if (['stopped','starting'].includes(state.status)) state = { ...state, status: 'blocked', reason: 'service-start-timeout' };
          }
        } catch (error) { state = { status: 'blocked', reason: 'service-error', detail: error.message }; }
        current[service.name] = state;
        if (JSON.stringify(previous.services[service.name]) !== JSON.stringify(state)) this.store.event('process-health-changed', { service: service.name, state });
      }
      this.store.write('processes.json', { schema_version: 1, checked_at: new Date().toISOString(), services: current });
      return current;
    });
  }
}
