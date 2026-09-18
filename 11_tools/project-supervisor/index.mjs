import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RuntimeStore, canonicalRoot, alive } from './runtime-store.mjs';
import { ProjectSupervisor } from './project-supervisor.mjs';
import { launchNode } from './services.mjs';
import { parseArgs } from '../../.codex/skills/muion-project/scripts/project-utils.mjs';
import { isDisabled, readControl } from '../../.codex/skills/farmer/farmer-control.mjs';

const script = fileURLToPath(import.meta.url);
export async function ensureDaemon(root) {
  const store = new RuntimeStore(root);
  return store.exclusive('startup', async () => {
    const old = store.read('daemon.json');
    if (old && alive(old.pid)) return old;
    const child = await launchNode(script, ['watch', '--project-root', root], { cwd: root, log: store.file('daemon.log') });
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const owner = store.read('daemon.json');
      if (owner?.pid === child.pid) return owner;
      if (!alive(child.pid)) throw new Error('project supervisor exited during startup');
      await delay(100);
    }
    throw new Error('project supervisor startup timeout');
  });
}
async function main() {
  const args = parseArgs(process.argv.slice(2)); const root = canonicalRoot(args.project_root || process.cwd());
  const supervisor = new ProjectSupervisor(root); const store = supervisor.store; const command = args._[0] || 'ensure';
  if (command !== 'status' && command !== 'stop' && command !== 'watch' && isDisabled(root)) return { status: 'disabled', control: readControl(root), dashboard_policy: 'preserve-existing-only' };
  if (command === 'status') return { daemon: store.read('daemon.json'), services: await supervisor.processes.status() };
  if (command === 'stop') { const owner = store.read('daemon.json'); store.write('stop.json', { pid: owner?.pid }); return { stop_requested: owner?.pid }; }
  if (command === 'watch') {
    if (isDisabled(root)) return { status: 'disabled', control: readControl(root) };
    const lock = await store.acquire('daemon', 0);
    const owner = { pid: process.pid, root, started_at: new Date().toISOString() };
    store.write('daemon.json', owner);
    const cleanup = () => store.release(lock);
    process.once('exit', cleanup);
    try {
      while (store.read('stop.json')?.pid !== process.pid) {
        try { await supervisor.ensure(); supervisor.workers.tick(); } catch (error) { store.event('supervisor-error', { error: error.message }); }
        store.write('daemon.json', { ...owner, checked_at: new Date().toISOString() });
        await delay(5000);
      }
    } finally { cleanup(); }
    return { stopped: true };
  }
  await ensureDaemon(root);
  if (command === 'ensure') return { root, services: await supervisor.ensure() };
  if (command === 'enter') { const record = await supervisor.enter({ sessionId: args.session_id || process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID, intent: args.read_only ? 'read' : 'write', ownedPaths: args.owned_path ? [].concat(args.owned_path) : [] }); return { ...record, context: undefined }; }
  throw new Error(`unknown supervisor command: ${command}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
