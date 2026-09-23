import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, '../../../..'));
const candidates = [
  process.env.CODEX_PYTHON,
  process.env.CODEX_BUNDLED_PYTHON,
  'C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe',
  'python',
].filter(Boolean);
let result = null;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, [path.join(root, '.codex/skills/muion-project/scripts/reference-index.py'), root], { cwd: root, encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') continue;
  result = probe;
  break;
}
if (!result) throw new Error('No Python runtime found for reference indexing');
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); process.exitCode = result.status ?? 1;
