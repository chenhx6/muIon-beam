import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';

export const alive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
export function canonicalRoot(cwd) {
  const result = spawnSync('git', ['-C', path.resolve(cwd), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('project supervisor requires a Git checkout');
  return path.dirname(result.stdout.trim());
}
export class RuntimeStore {
  constructor(root) { this.root = path.resolve(root); this.directory = path.join(this.root, '_work/current/project-supervisor'); }
  file(name) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('invalid runtime record name');
    return path.join(this.directory, name);
  }
  read(name, fallback = null) {
    try { return JSON.parse(fs.readFileSync(this.file(name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  write(name, value) {
    fs.mkdirSync(this.directory, { recursive: true });
    const file = this.file(name); const temp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temp, file);
  }
  event(type, detail) {
    fs.mkdirSync(this.directory, { recursive: true });
    fs.appendFileSync(this.file('events.jsonl'), JSON.stringify({ at: new Date().toISOString(), type, ...detail }) + '\n');
  }
  async acquire(name, timeoutMs = 5000) {
    fs.mkdirSync(this.directory, { recursive: true });
    const file = this.file(`${name}.lock`); const token = crypto.randomUUID(); const end = Date.now() + timeoutMs;
    while (true) {
      try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token, created_at: new Date().toISOString() }), { flag: 'wx' }); return { file, token }; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner; try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
        if (owner && !alive(owner.pid)) { try { fs.unlinkSync(file); } catch {} continue; }
        if (Date.now() >= end) throw new Error(`supervisor lock busy: ${name}`);
        await delay(50);
      }
    }
  }
  release(lock) {
    try { if (JSON.parse(fs.readFileSync(lock.file, 'utf8')).token === lock.token) fs.unlinkSync(lock.file); } catch {}
  }
  async exclusive(name, fn) { const lock = await this.acquire(name); try { return await fn(); } finally { this.release(lock); } }
}
