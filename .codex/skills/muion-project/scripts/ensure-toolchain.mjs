import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, ensureDirectory, jsonWrite, nowIso } from './project-utils.mjs';

const localRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'muion-tools');
const recoveryDir = '00_project/traceability/toolchain-recoveries';
const allowlist = { PyYAML: { module: 'yaml', version: '6.0.3' } };

function candidates() {
  const result = []; const add = (value) => { const item = String(value || '').trim(); if (item && !result.includes(item)) result.push(item); };
  if (process.env.MUION_PYTHON) add(process.env.MUION_PYTHON);
  for (const command of ['py', 'where.exe']) {
    const output = spawnSync(command, command === 'py' ? ['-0p'] : ['python'], { encoding: 'utf8', windowsHide: true });
    for (const line of String(output.stdout || '').split(/\r?\n/)) { const match = line.match(/([A-Za-z]:\\[^\r\n]*python(?:\.exe)?)/i); if (match) add(match[1]); }
  }
  const localPython = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Python');
  try { for (const folder of fs.readdirSync(localPython, { withFileTypes: true })) { const candidate = path.join(localPython, folder.name, 'python.exe'); if (folder.isDirectory() && fs.existsSync(candidate)) add(candidate); } } catch {}
  return result;
}

function inspectInterpreter(interpreter, packageName) {
  const allowed = allowlist[packageName]; if (!allowed) throw new Error(`package is not allowlisted for automatic recovery: ${packageName}`);
  const code = `import sys, json\ntry:\n import ${allowed.module} as m\n print(json.dumps({'available': True, 'executable': sys.executable, 'python': sys.version, 'package': '${packageName}', 'version': getattr(m, '__version__', None), 'path': getattr(m, '__file__', None)}))\nexcept Exception as e:\n print(json.dumps({'available': False, 'executable': sys.executable, 'python': sys.version, 'error': str(e)}))`;
  const result = spawnSync(interpreter, ['-c', code], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return { available: false, executable: interpreter, error: result.error?.message || result.stderr || result.stdout };
  try { return JSON.parse(result.stdout.trim()); } catch { return { available: false, executable: interpreter, error: result.stdout }; }
}

export function discoverPackage(packageName = 'PyYAML', preferred = null) { if (!allowlist[packageName]) throw new Error(`package is not allowlisted for automatic recovery: ${packageName}`); const list = [...(preferred ? [preferred] : []), ...candidates()]; return [...new Set(list)].map((interpreter) => inspectInterpreter(interpreter, packageName)); }

export function writeRecovery(root, record) { const id = record.recovery_id || `REC-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`; const value = { schema_version: '1.0.0', record_type: 'toolchain-recovery', recovery_id: id, recorded_at: nowIso(), ...record }; const file = path.join(root, recoveryDir, `${id}.json`); ensureDirectory(path.dirname(file)); jsonWrite(file, value); return { file, record: value }; }

export function ensurePackage(packageName = 'PyYAML', { install = false, python = null, root = process.cwd() } = {}) {
  const found = discoverPackage(packageName, python); const available = found.find((item) => item.available && item.version === allowlist[packageName].version) || found.find((item) => item.available);
  if (available) return { status: 'available', package: packageName, selected: available, candidates: found };
  if (!install) return { status: 'missing', package: packageName, candidates: found, action: 'rerun with --install' };
  const base = python || found.find((item) => item.available)?.executable; if (!base) throw new Error(`no usable Python interpreter available for ${packageName}`);
  const venv = path.join(localRoot, 'venvs', 'muion-project'); const created = spawnSync(base, ['-m', 'venv', venv], { encoding: 'utf8', windowsHide: true }); if (created.status !== 0) throw new Error(created.stderr || 'venv creation failed');
  const pip = path.join(venv, 'Scripts', 'pip.exe'); const installed = spawnSync(pip, ['install', '--disable-pip-version-check', '--only-binary=:all:', `${packageName}==${allowlist[packageName].version}`], { encoding: 'utf8', windowsHide: true }); if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout || 'package installation failed');
  const selected = inspectInterpreter(path.join(venv, 'Scripts', 'python.exe'), packageName); if (!selected.available) throw new Error(`installed package cannot be imported: ${selected.error}`);
  const recovery = writeRecovery(root, { package: packageName, action: 'installed', interpreter: selected.executable, version: selected.version, package_path: selected.path, install_root: venv, output: installed.stdout });
  return { status: 'installed', selected, recovery: recovery.file };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2)); const command = args._[0] || 'check'; const root = path.resolve(args.project_root || projectRootFromHere());
  try { const result = ensurePackage(args.package || 'PyYAML', { install: Boolean(args.install), python: args.python || null, root }); if (args.record) writeRecovery(root, { package: args.package || 'PyYAML', action: result.status === 'available' ? 'verified-existing' : result.status, selected: result.selected || null, candidates: result.candidates || [] }); console.log(JSON.stringify(result, null, 2)); if (result.status === 'missing') process.exitCode = 2; } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}
