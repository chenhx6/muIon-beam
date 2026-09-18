import { setTimeout as delay } from 'node:timers/promises';

export class ProcessSupervisor {
  constructor(store, services, { startTimeoutMs = 6000, pollMs = 100 } = {}) { Object.assign(this, { store, services, startTimeoutMs, pollMs }); }
  async status() { return Object.fromEntries(await Promise.all(this.services.map(async service => [service.name, await service.health()]))); }
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
