import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(process.argv[2] || '.');
const expected = path.resolve('D:/muIon-beam');
const result = { projectRoot, checks: [], warnings: [], blockers: [] };
function check(name, ok, detail) {
  result.checks.push({ name, ok, detail });
  if (!ok) result.blockers.push(`${name}: ${detail}`);
}

check('project-root', projectRoot.toLowerCase() === expected.toLowerCase(), `expected ${expected}`);
check('agents', fs.existsSync(path.join(projectRoot, 'AGENTS.md')), 'AGENTS.md must exist');
check('variable-catalog', fs.existsSync(path.join(projectRoot, '00_project', 'traceability', 'variable-catalog.yaml')), 'variable catalog must exist');
const git = spawnSync('git', ['-c', 'safe.directory=D:/muIon-beam', '-C', projectRoot, 'status', '--short', '--branch'], { encoding: 'utf8' });
check('git', git.status === 0, git.stderr?.trim() || git.stdout?.trim() || 'git status failed');
if (git.stdout?.split(/\r?\n/).some((line) => line.startsWith(' M ') || line.startsWith('MM '))) result.warnings.push('working tree contains modified files; do not overwrite them');
const drivePath = 'H:\\我的云端硬盘\\muIon_archive';
result.checks.push({ name: 'drive-archive', ok: fs.existsSync(drivePath), detail: drivePath });
if (!fs.existsSync(drivePath)) result.warnings.push(`Drive archive path is not available in this environment: ${drivePath}`);
const modelExtensions = new Set(['.mph', '.sldasm', '.sldprt', '.slddrw']);
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (modelExtensions.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}
const models = walk(path.join(projectRoot, '02_models'));
if (models.length) result.warnings.push(`model binaries require registered fingerprints: ${models.length}`);
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.blockers.length ? 1 : 0;
