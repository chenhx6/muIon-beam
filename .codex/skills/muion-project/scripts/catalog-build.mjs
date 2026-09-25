import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, '../../../..'));
const out = path.join(root, '09_catalog');
const excluded = new Set(['.git', '.codex', 'node_modules', '_work', '90_migration', '09_catalog']);
const records = [];
const durableRoots = ['00_project', '01_physics', '02_models', '03_runs', '04_results', '05_reports', '06_external_lib', '07_research_system', '08_references', '10_plans'];
function classify(rel) {
  const lower = rel.toLowerCase();
  const module = lower.startsWith('07_research_system/blocks/geant4') || lower.includes('/geant4/') ? 'geant4' : lower.startsWith('07_research_system/blocks/comsol') || lower.includes('/comsol/') ? 'comsol' : lower.includes('/3d/') || lower.includes('solidworks') ? '3d' : lower.startsWith('08_references') ? 'references' : lower.startsWith('10_plans') ? 'plans' : lower.split('/')[0];
  const artifact = lower.includes('report') || /\.(md|pdf)$/.test(lower) ? 'reports' : lower.includes('figure') || /\.(svg|png|pdf)$/.test(lower) ? 'figures' : lower.includes('log') || /\.log$/.test(lower) ? 'logs' : lower.includes('manifest') || /\.json$/.test(lower) ? 'manifests' : /\.(csv|tsv)$/.test(lower) ? 'tables' : 'source';
  const topic = lower.includes('cool') || lower.includes('density') ? 'mu_ne_cooling' : lower.includes('transport') || lower.includes('velocity') ? 'mu_transport' : lower.includes('capture') || lower.includes('loss') ? 'capture_loss' : 'general';
  return { module, artifact, topic };
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (/^07_research_system\/control\/research-state\/(events\.jsonl|NOW\.md|state\.yaml|workflows\/)/.test(rel)) continue;
      if (durableRoots.some((candidate) => rel === candidate || rel.startsWith(`${candidate}/`))) {
        const stat = fs.statSync(file); const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        records.push({ path: rel, bytes: stat.size, sha256: hash, ...classify(rel) });
      }
    }
  }
}
for (const dir of durableRoots) if (fs.existsSync(path.join(root, dir))) walk(path.join(root, dir));
records.sort((a, b) => a.path.localeCompare(b.path));
const index = { schema_version: 1, generated_at: new Date().toISOString(), source_roots: durableRoots, count: records.length, records };
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(path.join(out, 'views'), { recursive: true });
fs.writeFileSync(path.join(out, 'catalog_index.json'), JSON.stringify(index, null, 2) + '\n');
const groups = new Map();
for (const record of records) {
  for (const [view, key] of [['by_module', record.module], ['by_artifact', record.artifact], ['by_topic', record.topic], ['by_task', (record.path.match(/task_[a-z0-9_]+/) || ['unassigned'])[0]], ['by_run', (record.path.match(/run_[a-z0-9_]+/) || ['unassigned'])[0]], ['by_plan', (record.path.match(/plan_[a-z0-9_]+/) || ['unassigned'])[0]]]) {
    const groupKey = `${view}/${key}`; if (!groups.has(groupKey)) groups.set(groupKey, []); groups.get(groupKey).push(record);
  }
}
for (const [key, items] of groups) {
  const [view, name] = key.split('/'); const dir = path.join(out, 'views', view); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.md`); fs.writeFileSync(file, `# ${view}: ${name}\n\n${items.map((item) => `- [${item.path}](${item.path}) — ${item.module} / ${item.artifact} / ${item.topic} — ${item.bytes} bytes — ${item.sha256}`).join('\n')}\n`);
}
fs.writeFileSync(path.join(out, 'CATALOG_HOME.md'), fs.readFileSync(path.join(out, 'CATALOG_HOME.md'), 'utf8'));
console.log(JSON.stringify({ catalog: '09_catalog/catalog_index.json', count: records.length }, null, 2));
