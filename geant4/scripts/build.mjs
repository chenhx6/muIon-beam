import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, defaultBuildDir, parseArgs, runCommand, commandRecord, toWslPath } from './common.mjs';
import { preflight } from './preflight.mjs';

export function buildGeant4({ source = path.join(ROOT, 'geant4/tests/fixtures/mvp-smoke'), build_dir = defaultBuildDir(), backend = 'auto', distribution = 'Ubuntu-20.04', geant4_dir = null, env_script = null, build_type = 'Release' } = {}) {
  const check = preflight({ project: ROOT, backend, distribution, geant4_dir, env_script });
  if (check.status !== 'ready') return { status: 'blocked', reason: 'geant4-toolchain-unavailable', preflight: check, commands: [] };
  const sourceDir = path.resolve(source);
  const buildDir = path.resolve(build_dir);
  const g4Dir = geant4_dir || (check.runtime.prefix ? path.posix.join(check.runtime.prefix, 'lib/cmake/Geant4') : null);
  const cmakeArgs = ['-S', check.backend === 'wsl' ? toWslPath(sourceDir) : sourceDir, '-B', check.backend === 'wsl' ? toWslPath(buildDir) : buildDir, `-DCMAKE_BUILD_TYPE=${build_type}`];
  if (g4Dir) cmakeArgs.push(`-DGeant4_DIR=${check.backend === 'wsl' ? g4Dir.replaceAll('\\', '/') : g4Dir}`);
  const configure = runCommand('cmake', cmakeArgs, { cwd: ROOT, backend: check.backend, distribution: check.distribution || distribution, envScript: check.runtime.env_script, timeout: 300000 });
  const build = configure.status === 0 ? runCommand('cmake', ['--build', check.backend === 'wsl' ? toWslPath(buildDir) : buildDir, '--parallel', '2'], { cwd: ROOT, backend: check.backend, distribution: check.distribution || distribution, envScript: check.runtime.env_script, timeout: 300000 }) : null;
  const binary = path.join(buildDir, 'bin', 'g4_mvp_smoke');
  const result = { status: configure.status === 0 && build?.status === 0 ? 'built' : 'failed', backend: check.backend, geant4_version: check.runtime.version, source: sourceDir, build_dir: buildDir, binary, commands: [commandRecord(configure), ...(build ? [commandRecord(build)] : [])], preflight: check };
  if (result.status === 'built' && check.backend === 'wsl') result.binary_wsl = toWslPath(binary);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = buildGeant4({ source: args.source || undefined, build_dir: args.build_dir || undefined, backend: args.backend || 'auto', distribution: args.distribution || 'Ubuntu-20.04', geant4_dir: args.geant4_dir || null, env_script: args.env_script || null });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'built' ? 0 : 2;
}
