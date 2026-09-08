import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const npmMetadataUrl = 'https://registry.npmjs.org/npm/latest';
const localRoot = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData/Local'), 'muion-tools');
const npmRoot = path.join(localRoot, 'npm');
const binRoot = path.join(localRoot, 'bin');
const nodePath = process.execPath;
const npmExecutable = path.join(binRoot, process.platform === 'win32' ? 'npm.cmd' : 'npm');
function commandExists(command) { const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { encoding: 'utf8', windowsHide: true }); return result.status === 0; }
function prependCurrentPath(dir) {
  const parts = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  if (!parts.some((part) => path.resolve(part).toLowerCase() === path.resolve(dir).toLowerCase())) process.env.PATH = [dir, ...parts].join(path.delimiter);
}
function userPathAdd(dir) {
  if (process.platform !== 'win32') return;
  const safe = dir.replaceAll("'", "''");
  const command = "$p=[Environment]::GetEnvironmentVariable('Path','User');$a=@($p -split ';' | Where-Object { $_ -and $_ -ne '" + safe + "' });[Environment]::SetEnvironmentVariable('Path', (($a + '" + safe + "') -join ';'), 'User')";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || 'failed to update user PATH');
}
export async function ensureNpm({ install = false, fetchImpl = fetch } = {}) {
  if (commandExists('npm')) return { status: 'available', command: 'npm', executable: 'npm' };
  if (fs.existsSync(npmExecutable)) {
    prependCurrentPath(binRoot);
    return { status: 'available', command: npmExecutable, executable: npmExecutable, path_added_to_process: true };
  }
  if (!install) return { status: 'missing', command: 'npm', action: 'run ensure-toolchain with --install' };
  const metadata = await (await fetchImpl(npmMetadataUrl)).json();
  const expected = metadata.dist.integrity;
  const tarball = Buffer.from(await (await fetchImpl(metadata.dist.tarball)).arrayBuffer());
  const actual = 'sha512-' + crypto.createHash('sha512').update(tarball).digest('base64');
  if (actual !== expected) throw new Error('npm integrity mismatch: ' + actual);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-npm-'));
  const archive = path.join(temp, 'npm.tgz');
  fs.writeFileSync(archive, tarball);
  fs.mkdirSync(path.join(npmRoot, 'node_modules'), { recursive: true });
  const extract = spawnSync('tar.exe', ['-xzf', archive, '-C', temp], { encoding: 'utf8', windowsHide: true });
  if (extract.status !== 0) throw new Error(extract.stderr || 'npm extraction failed');
  const packageRoot = path.join(npmRoot, 'node_modules', 'npm');
  fs.rmSync(packageRoot, { recursive: true, force: true });
  fs.renameSync(path.join(temp, 'package'), packageRoot);
  fs.mkdirSync(binRoot, { recursive: true });
  fs.writeFileSync(npmExecutable, '@echo off\r\n"' + nodePath + '" "' + path.join(packageRoot, 'bin/npm-cli.js') + '" %*\r\n', 'ascii');
  fs.writeFileSync(path.join(binRoot, 'npx.cmd'), '@echo off\r\n"' + nodePath + '" "' + path.join(packageRoot, 'bin/npx-cli.js') + '" %*\r\n', 'ascii');
  userPathAdd(binRoot);
  prependCurrentPath(binRoot);
  return { status: 'installed', command: npmExecutable, executable: npmExecutable, version: metadata.version, install_root: npmRoot, bin_root: binRoot, integrity: actual, path_added_to_process: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const install = process.argv.includes('--install');
  ensureNpm({ install }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 2; });
}
