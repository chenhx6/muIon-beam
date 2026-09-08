import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ROOT = path.resolve(import.meta.dirname, '../..');

export function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2).replaceAll('-', '_');
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) result[key] = argv[++i];
    else result[key] = true;
  }
  return result;
}

export function asInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); return directory; }

export function writeJson(file, value, { overwrite = false } = {}) {
  ensureDir(path.dirname(file));
  if (fs.existsSync(file) && !overwrite) throw new Error(`Refusing to overwrite ${file}`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

export function nowId(prefix = 'g4') { return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`; }

export function isWindows() { return process.platform === 'win32'; }

export function toWslPath(value) {
  if (String(value).startsWith('/')) return String(value);
  const text = path.resolve(value);
  const match = text.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) return text.replaceAll('\\', '/');
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
}

function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }

export function commandExists(command, { backend = 'native', distribution = 'Ubuntu-20.04' } = {}) {
  if (backend === 'wsl') {
    const result = spawnSync('wsl.exe', ['-d', distribution, '--', 'bash', '-lc', `command -v ${shellQuote(command)}`], { encoding: 'utf8', timeout: 15000 });
    return result.status === 0 && Boolean(result.stdout.trim());
  }
  if (path.isAbsolute(command) && fs.existsSync(command)) return true;
  const probe = isWindows() ? 'where.exe' : 'sh';
  const args = isWindows() ? [command] : ['-c', 'command -v "$1"', 'geant4-probe', command];
  const result = spawnSync(probe, args, { encoding: 'utf8', timeout: 5000 });
  return result.status === 0;
}

export function runCommand(command, args = [], { cwd = ROOT, env = process.env, backend = 'native', distribution = 'Ubuntu-20.04', envScript = null, timeout = 300000 } = {}) {
  if (backend === 'wsl' && /^[A-Za-z]:[\\/]/.test(command)) command = toWslPath(command);
  const effectiveCwd = backend === 'wsl' ? toWslPath(cwd) : cwd;
  if (backend !== 'wsl') {
    const result = spawnSync(command, args.map(String), { cwd: effectiveCwd, env, encoding: 'utf8', timeout, maxBuffer: 20 * 1024 * 1024 });
    return { command, args: args.map(String), cwd: effectiveCwd, status: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message || null };
  }
  const source = envScript ? `source ${shellQuote(envScript)} && ` : '';
  const commandLine = `${source}cd ${shellQuote(effectiveCwd)} && exec ${[command, ...args.map(String)].map(shellQuote).join(' ')}`;
  const result = spawnSync('wsl.exe', ['-d', distribution, '--', 'bash', '-lc', commandLine], { cwd, encoding: 'utf8', timeout, maxBuffer: 20 * 1024 * 1024 });
  return { command: 'wsl.exe', args: ['-d', distribution, '--', 'bash', '-lc', commandLine], cwd: effectiveCwd, status: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message || null };
}

export function parseJsonFile(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

export function parseLastJson(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try { return JSON.parse(line); } catch {}
  }
  return null;
}

export function commandRecord(result) {
  return { command: result.command, args: result.args, cwd: result.cwd, exit_code: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error };
}

export function defaultBuildDir() { return path.join(ROOT, '_work/cache/geant4/mvp-smoke-build'); }
export function defaultSmokeDir() { return path.join(ROOT, `_work/cache/geant4/${nowId('smoke')}`); }
export function temporaryDirectory(prefix = 'g4-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
