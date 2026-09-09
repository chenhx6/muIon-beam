import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/common.mjs';
import { runSmoke } from '../scripts/smoke.mjs';

export { runSmoke };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = runSmoke({ executable: args.executable || null, build: !args.no_build, backend: args.backend || 'auto', distribution: args.distribution || 'Ubuntu-20.04', env_script: args.env_script || null, output_dir: args.output_dir ? path.resolve(args.output_dir) : undefined });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'failed' ? 2 : 0;
}
