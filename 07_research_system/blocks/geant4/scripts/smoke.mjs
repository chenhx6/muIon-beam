import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGeant4 } from './build.mjs';
import { defaultSmokeDir, ensureDir, parseArgs, parseJsonFile, runCommand, commandRecord, toWslPath } from './common.mjs';
import { validateSmokeResult } from './validate.mjs';

const SCENARIOS = ['runtime', 'geometry', 'uniform-magnetic-field', 'material'];

export function runSmoke({ executable = null, build = true, backend = 'auto', distribution = 'Ubuntu-20.04', env_script = null, output_dir = defaultSmokeDir() } = {}) {
  let buildResult = null;
  if (!executable && build) {
    buildResult = buildGeant4({ backend, distribution, env_script });
    if (buildResult.status !== 'built') return { status: 'not-yet-validated', build: buildResult, scenarios: SCENARIOS.map((scenario) => ({ scenario, status: 'not-yet-validated', reason: 'Geant4 toolchain is unavailable.' })), note: 'No native Geant4 smoke value was fabricated.' };
    executable = buildResult.binary;
    backend = buildResult.backend;
    distribution = buildResult.preflight.distribution || distribution;
    env_script = buildResult.preflight.runtime.env_script || env_script;
  }
  if (!executable) return { status: 'not-yet-validated', build: buildResult, scenarios: SCENARIOS.map((scenario) => ({ scenario, status: 'not-yet-validated', reason: 'No executable was supplied.' })) };
  ensureDir(output_dir);
  const records = [];
  for (const scenario of SCENARIOS) {
    const output = path.join(output_dir, `${scenario}.json`);
    const args = ['--scenario', scenario, '--output', backend === 'wsl' ? toWslPath(output) : output, '--events', scenario === 'geometry' ? '1' : '10'];
    const command = runCommand(executable, args, { cwd: output_dir, backend, distribution, envScript: env_script, timeout: 10 * 60 * 1000 });
    let payload = null;
    if (fs.existsSync(output)) { try { payload = parseJsonFile(output); } catch {} }
    if (scenario === 'geometry') {
      const clean = validateSmokeResult({ ...(payload || {}), scenario, expected_overlap: false }, { scenario });
      const overlapOutput = path.join(output_dir, 'geometry-intentional-overlap.json');
      const overlap = runCommand(executable, ['--scenario', scenario, '--intentional-overlap', '--output', backend === 'wsl' ? toWslPath(overlapOutput) : overlapOutput, '--events', '1'], { cwd: output_dir, backend, distribution, envScript: env_script, timeout: 10 * 60 * 1000 });
      const overlapPayload = fs.existsSync(overlapOutput) ? parseJsonFile(overlapOutput) : null;
      const intentional = validateSmokeResult({ ...(overlapPayload || {}), scenario, expected_overlap: true }, { scenario });
      records.push({ scenario, command: commandRecord(command), clean, intentional_overlap: { command: commandRecord(overlap), validation: intentional } });
    } else records.push({ scenario, command: commandRecord(command), validation: validateSmokeResult(payload, { scenario }) });
  }
  const failed = records.some((record) => record.validation?.status === 'failed' || record.clean?.status === 'failed' || record.intentional_overlap?.validation?.status === 'failed');
  const pending = records.some((record) => [record.validation?.status, record.clean?.status, record.intentional_overlap?.validation?.status].includes('partial') || [record.validation?.status, record.clean?.status, record.intentional_overlap?.validation?.status].includes('not-evaluated'));
  return { status: failed ? 'failed' : pending ? 'partial' : 'passed', build: buildResult, executable, output_dir, scenarios: records, note: 'Smoke checks establish runtime/model sanity only; they are not device physics validation.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = runSmoke({ executable: args.executable || null, build: args.no_build ? false : true, backend: args.backend || 'auto', distribution: args.distribution || 'Ubuntu-20.04', env_script: args.env_script || null, output_dir: args.output_dir ? path.resolve(args.output_dir) : undefined });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'failed' ? 2 : 0;
}
