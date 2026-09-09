import { blockPath } from '../../../paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, commandExists, parseArgs, runCommand, toWslPath } from './common.mjs';

function check(name, ok, detail, extra = {}) { return { name, ok: Boolean(ok), detail, ...extra }; }

function detectWslGeant4(distribution) {
  const result = runCommand('find', ['/home', '/opt', '-path', '*/bin/geant4-config', '-type', 'f', '-print', '-quit'], { backend: 'wsl', distribution, timeout: 30000 });
  const config = result.status === 0 ? result.stdout.trim().split(/\r?\n/).find((line) => line.startsWith('/') && line.endsWith('/geant4-config')) : null;
  return config ? { config, env_script: path.posix.join(path.posix.dirname(config), 'geant4.sh') } : null;
}

export function preflight({ project = ROOT, backend = 'auto', distribution = 'Ubuntu-20.04', geant4_dir = null, env_script = null } = {}) {
  const source = path.resolve(project);
  const fixture = blockPath(source, 'geant4', 'tests/fixtures/mvp-smoke');
  const checks = [check('project-root', fs.existsSync(source), source), check('smoke-fixture', fs.existsSync(path.join(fixture, 'CMakeLists.txt')), fixture)];
  let selected = backend;
  let runtime = { config: null, env_script: env_script || null, version: null, prefix: null };
  if (selected === 'auto') selected = commandExists('cmake') && commandExists('g++') && commandExists('geant4-config') ? 'native' : 'wsl';
  if (selected === 'wsl') {
    const found = env_script ? { config: path.posix.join(path.posix.dirname(env_script), 'geant4-config'), env_script } : detectWslGeant4(distribution);
    runtime = { ...runtime, ...(found || {}) };
    if (runtime.config) {
      const versionResult = runCommand('geant4-config', ['--version'], { backend: 'wsl', distribution, envScript: runtime.env_script, timeout: 30000 });
      const prefixResult = runCommand('geant4-config', ['--prefix'], { backend: 'wsl', distribution, envScript: runtime.env_script, timeout: 30000 });
      runtime.version = versionResult.status === 0 && /^\d+\.\d+/.test(versionResult.stdout.trim()) ? versionResult.stdout.trim() : null;
      runtime.prefix = prefixResult.status === 0 && prefixResult.stdout.trim().startsWith('/') ? prefixResult.stdout.trim() : null;
      checks.push(check('wsl-cmake', commandExists('cmake', { backend: 'wsl', distribution }), 'command -v cmake'), check('wsl-compiler', commandExists('g++', { backend: 'wsl', distribution }), 'command -v g++'), check('wsl-geant4-config', Boolean(runtime.config), runtime.config || 'find */bin/geant4-config'), check('wsl-geant4-version', Boolean(runtime.version), runtime.version || 'geant4-config --version')); 
    } else checks.push(check('wsl-cmake', commandExists('cmake', { backend: 'wsl', distribution }), 'command -v cmake'), check('wsl-compiler', commandExists('g++', { backend: 'wsl', distribution }), 'command -v g++'), check('wsl-geant4-config', false, 'No Geant4 installation was found in /home or /opt'));
  } else {
    const config = geant4_dir ? path.join(geant4_dir, 'bin/geant4-config') : 'geant4-config';
    runtime = { config, env_script: env_script || null };
    checks.push(check('native-cmake', commandExists('cmake'), 'cmake'), check('native-compiler', commandExists('c++') || commandExists('g++') || commandExists('cl'), 'C++ compiler'), check('native-geant4-config', commandExists(config), config));
    if (commandExists(config)) {
      const versionResult = runCommand(config, ['--version'], { envScript: runtime.env_script, timeout: 30000 });
      const prefixResult = runCommand(config, ['--prefix'], { envScript: runtime.env_script, timeout: 30000 });
      runtime.version = versionResult.stdout.trim() || null;
      runtime.prefix = prefixResult.stdout.trim() || null;
    }
  }
  const ready = checks.every((item) => item.ok);
  return { status: ready ? 'ready' : runtime.version ? 'partial' : 'not-yet-validated', backend: selected, distribution: selected === 'wsl' ? distribution : null, project: source, runtime, checks, note: ready ? 'Geant4 build/runtime prerequisites are available.' : 'Native Geant4 execution is not yet validated in this environment.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = preflight({ project: args.project || ROOT, backend: args.backend || 'auto', distribution: args.distribution || 'Ubuntu-20.04', geant4_dir: args.geant4_dir || null, env_script: args.env_script || null });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'not-yet-validated' ? 0 : result.status === 'partial' ? 2 : 0;
}
