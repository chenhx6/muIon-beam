import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, nowIso } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const destination = path.resolve(args.destination || path.join(root, '.codex/external-skills/nature-figure'));
const installed = path.join(destination, 'upstream-skill', 'SKILL.md');
if (fs.existsSync(installed) && !args.force) {
  console.log(JSON.stringify({ status: 'already-installed', path: path.dirname(installed), message: 'Use --force only after reviewing the existing pinned version.' }, null, 2));
  process.exit(0);
}
const python = process.env.MUION_PYTHON || 'C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
const installer = process.env.CODEX_SKILL_INSTALLER || 'C:\\Users\\Administrator\\.codex\\skills\\.system\\skill-installer\\scripts\\install-skill-from-github.py';
fs.mkdirSync(destination, { recursive: true });
const command = spawnSync(python, [installer, '--repo', 'Yuan1z0825/nature-skills', '--path', 'skills/nature-figure', '--dest', destination, '--name', 'upstream-skill', '--method', 'auto'], { cwd: root, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
if (command.status !== 0) throw new Error(command.stderr || command.stdout || 'nature-figure installation failed');
const result = { status: 'installed', path: path.join(destination, 'upstream-skill'), source_url: 'https://github.com/Yuan1z0825/nature-skills', installed_at: nowIso(), output: command.stdout.trim() };
console.log(JSON.stringify(result, null, 2));
