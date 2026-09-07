import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, walkFiles, sha256File, relativePath, nowIso, jsonWrite } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const cacheRoot = path.resolve(args.cache_root || path.join(root, '_work/cache'));
const database = path.resolve(args.database || path.join(cacheRoot, 'cache-index.sqlite'));
const files = walkFiles(cacheRoot, { ignoredDirectories: ['.git'] }).filter((file) => path.basename(file) !== 'README.md' && !file.endsWith('.sqlite'));
const entries = files.map((file) => {
  const stat = fs.statSync(file);
  const relative = relativePath(root, file);
  const locked = /(?:\.lock$|\.recover$|\.tmp$|~$)/i.test(file) || fs.existsSync(`${file}.lock`);
  return { cache_path: relative, absolute_path: file, source_model: null, source_parameters: null, software_version: null, size: stat.size, last_used_at: stat.atime.toISOString(), rebuildable: !locked, locked, referenced_by: [], retention_level: locked ? 'P3' : 'P2', sha256: stat.size <= 25 * 1024 * 1024 ? sha256File(file) : null };
});
const python = process.env.MUION_PYTHON || 'C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
const script = path.join(import.meta.dirname, 'build-cache-index.py');
const result = spawnSync(python, [script, '--database', database], { input: JSON.stringify(entries), encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
if (result.status !== 0) { console.error(result.stderr || result.stdout); process.exitCode = result.status || 1; }
else { jsonWrite(path.join(cacheRoot, 'cache-index.json'), { schema_version: '1.0.0', generated_at: nowIso(), entries }); console.log(JSON.stringify({ cacheRoot, database, entries: entries.length, sqlite: JSON.parse(result.stdout) }, null, 2)); }
