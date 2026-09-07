import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { result._.push(token); continue; }
    const key = token.slice(2).replaceAll('-', '_');
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else { result[key] = result[key] === undefined ? next : [].concat(result[key], next); i += 1; }
  }
  return result;
}

export function projectRootFromHere() {
  return path.resolve(import.meta.dirname, '../../../..');
}

export function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function relativePath(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

export function walkFiles(root, options = {}) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const ignored = new Set(options.ignoredDirectories || []);
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && !ignored.has(full)) visit(full);
      } else if (entry.isFile()) result.push(full);
    }
  };
  visit(root);
  return result;
}

export function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    do { bytes = fs.readSync(fd, buffer, 0, buffer.length, null); if (bytes) hash.update(buffer.subarray(0, bytes)); } while (bytes);
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

export function jsonWrite(file, value) {
  ensureDirectory(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function jsonRead(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function runGit(root, args, options = {}) {
  const gitArgs = ['-c', 'safe.directory=D:/muIon-beam', '-C', root, ...args];
  const result = spawnSync('git', gitArgs, { encoding: 'utf8', input: options.input, timeout: options.timeout || 60000 });
  if (options.allowFailure) return result;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  return result;
}

export function csvEscape(value) {
  const text = value === null || value === undefined ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function isPathInside(child, parent) {
  const childResolved = path.resolve(child).toLowerCase();
  const parentResolved = path.resolve(parent).toLowerCase();
  return childResolved === parentResolved || childResolved.startsWith(`${parentResolved}${path.sep}`);
}

export function nowIso() { return new Date().toISOString(); }
