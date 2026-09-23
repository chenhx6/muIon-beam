import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, '../../../..'));
const apply = process.argv.includes('--apply');
const excluded = new Set(['.git', '.codex', 'node_modules', '_work', '90_migration', 'sync-states', 'sync-receipts', 'publication-records']);
const roots = ['00_project', '01_physics', '02_models', '03_runs', '04_results', '05_reports', '06_external_lib', '07_research_system', '08_references', '09_catalog', '10_plans'];
const textExt = new Set(['.md', '.json', '.jsonl', '.yaml', '.yml', '.csv', '.txt', '.mjs', '.js', '.py', '.ps1', '.sh', '.xml', '.toml']);
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file); else if (textExt.has(path.extname(entry.name).toLowerCase())) files.push(file);
  }
}
for (const item of roots) walk(path.join(root, item));
const pattern = /\b(?:TASK|RUN|MODEL|FIGURES?|MANIFEST|SNAPSHOT|PUBLICATION|WF)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g;
const mappings = new Map();
function normalized(value) {
  const parts = value.split('-');
  const prefixMap = { TASK: 'task', RUN: 'run', MODEL: 'model', FIG: 'fig', FIGURES: 'figures', MANIFEST: 'manifest', SNAPSHOT: 'snapshot', PUBLICATION: 'publication', WF: 'wf' };
  const first = prefixMap[parts.shift()] || parts.shift().toLowerCase();
  return [first, ...parts.map((part) => part.toLowerCase())].join('_');
}
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(pattern)) mappings.set(match[0], normalized(match[0]));
}
const replacements = [...mappings].sort((a, b) => b[0].length - a[0].length);
const pathChanges = [];
for (const file of files) {
  const rel = path.relative(root, file);
  let next = rel;
  for (const [oldId, newId] of replacements) next = next.split(oldId).join(newId);
  if (next !== rel) pathChanges.push({ from: rel.split(path.sep).join('/'), to: next.split(path.sep).join('/') });
}
const contentChanges = [];
if (apply) {
  for (const file of files) {
    let text = fs.readFileSync(file, 'utf8'); let next = text;
    for (const [oldId, newId] of replacements) next = next.split(oldId).join(newId);
    if (next !== text) { fs.writeFileSync(file, next, 'utf8'); contentChanges.push(path.relative(root, file).split(path.sep).join('/')); }
  }
  const renames = pathChanges.sort((a, b) => b.from.length - a.from.length);
  for (const change of renames) {
    const from = path.join(root, change.from); const to = path.join(root, change.to);
    if (fs.existsSync(from) && !fs.existsSync(to)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); }
  }
}
const result = { mode: apply ? 'apply' : 'dry-run', mapping_count: mappings.size, mappings: Object.fromEntries(mappings), path_change_count: pathChanges.length, content_change_count: contentChanges.length, path_changes: pathChanges.slice(0, 200), content_changes: contentChanges.slice(0, 200) };
console.log(JSON.stringify(result, null, 2));
