import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCommand, commandRecord, parseJsonFile, toWslPath } from './common.mjs';
import { preflight } from './preflight.mjs';

export function runExecutable({ executable, args = [], cwd = process.cwd(), output = null, backend = 'auto', distribution = 'Ubuntu-20.04', env_script = null, project = cwd } = {}) {
  const check = preflight({ project, backend, distribution, env_script });
  const selected = check.backend;
  if (!executable) return { status: 'blocked', reason: 'missing-executable', preflight: check };
  const effectiveArgs = selected === 'wsl' ? args.map((value) => /^[A-Za-z]:[\\/]/.test(String(value)) ? toWslPath(value) : value) : args;
  const result = runCommand(executable, effectiveArgs, { cwd, backend: selected, distribution: check.distribution || distribution, envScript: check.runtime.env_script, timeout: 30 * 60 * 1000 });
  const record = { status: result.status === 0 ? 'complete' : 'failed', exit_code: result.status, command: commandRecord(result), output_file: output, preflight: check };
  if (output && fs.existsSync(output)) {
    try { record.outputs = parseJsonFile(output); } catch (error) { record.output_parse_error = error.message; }
  }
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.executable) throw new Error('usage: node 07_research_system/blocks/geant4/scripts/run.mjs --executable FILE [--arg VALUE ...]');
  const extra = [];
  if (args.scenario) extra.push('--scenario', args.scenario);
  if (args.output) extra.push('--output', path.resolve(args.output));
  if (args.events) extra.push('--events', String(args.events));
  const result = runExecutable({ executable: args.executable, args: extra, cwd: args.cwd || process.cwd(), output: args.output ? path.resolve(args.output) : null, backend: args.backend || 'auto', distribution: args.distribution || 'Ubuntu-20.04', env_script: args.env_script || null });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'complete' ? 0 : 2;
}
