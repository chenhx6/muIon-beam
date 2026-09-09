import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitStatusEntries } from './project-utils.mjs';

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
check('research-system-layout', ['07_research_system/control/contracts/index.mjs', '07_research_system/control/research-state/state.yaml', '07_research_system/control/research-workflow/index.mjs', '07_research_system/blocks/3d/index.mjs', '07_research_system/blocks/comsol/index.mjs', '07_research_system/blocks/geant4/index.mjs'].every((file) => fs.existsSync(path.join(projectRoot, file))), '07_research_system canonical control and block entrypoints must exist');
const researchState = spawnSync(process.execPath, [path.join(projectRoot, '07_research_system/control/research-state/index.mjs'), 'status', '--root', projectRoot], { cwd: projectRoot, encoding: 'utf8' });
check('research-state', researchState.status === 0, researchState.status === 0 ? 'research-state status is readable' : (researchState.stderr?.trim() || 'research-state status failed'));
const git = spawnSync('git', ['-c', 'safe.directory=D:/muIon-beam', '-C', projectRoot, 'status', '--short', '--branch'], { encoding: 'utf8' });
check('git', git.status === 0, git.stderr?.trim() || git.stdout?.trim() || 'git status failed');
if (gitStatusEntries(projectRoot).length) result.warnings.push('working tree contains staged, modified, renamed or untracked files; do not overwrite them');
const drivePath = 'H:\\我的云端硬盘\\muIon_archive';
let driveStatus = 'missing';
try { fs.statSync(drivePath); driveStatus = 'accessible'; } catch (error) { driveStatus = error.code === 'EACCES' ? 'access-denied-to-current-process' : error.code || 'missing'; }
result.checks.push({ name: 'drive-archive', ok: driveStatus === 'accessible', detail: `${drivePath} (${driveStatus})` });
if (driveStatus === 'access-denied-to-current-process' || driveStatus === 'EPERM' || driveStatus === 'EACCES') result.warnings.push(`Drive archive is mounted but inaccessible to this process sandbox: ${drivePath}; retry with the user's mapped-drive context.`);
else if (driveStatus !== 'accessible') result.warnings.push(`Drive archive path is not available in this environment: ${drivePath}`);
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
