import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, '../../../..'));
const plans = path.join(root, '10_plans');
const requiredDirs = ['inbox', 'active', 'archive'];
const errors = [];
if (!fs.existsSync(path.join(plans, 'README.md'))) errors.push('10_plans/README.md is missing');
for (const dir of requiredDirs) if (!fs.existsSync(path.join(plans, dir))) errors.push(`10_plans/${dir} is missing`);
const active = [];
for (const dir of requiredDirs.length ? fs.readdirSync(path.join(plans, 'active'), { withFileTypes: true }) : []) {
  if (!dir.isDirectory()) continue;
  const base = path.join(plans, 'active', dir.name);
  const indexFile = path.join(base, 'plan_index.json');
  const human = fs.readdirSync(base).find((name) => /^plan_v\d+\.md$/.test(name));
  const machine = fs.readdirSync(base).find((name) => /^plan_v\d+\.json$/.test(name));
  if (!fs.existsSync(indexFile)) { errors.push(`${path.relative(root, base)}/plan_index.json is missing`); continue; }
  if (!human || !machine) errors.push(`${path.relative(root, base)} needs plan_vNN.md and plan_vNN.json`);
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  for (const field of ['plan_id', 'plan_version', 'status', 'task_id', 'next_action']) if (!index[field]) errors.push(`${path.relative(root, indexFile)} missing ${field}`);
  if (index.human_plan && !fs.existsSync(path.join(root, index.human_plan))) errors.push(`${indexFile} human_plan target is missing`);
  if (index.machine_plan && !fs.existsSync(path.join(root, index.machine_plan))) errors.push(`${indexFile} machine_plan target is missing`);
  if (!fs.existsSync(path.join(base, 'decision_log.md'))) errors.push(`${path.relative(root, base)}/decision_log.md is missing`);
  if (!fs.existsSync(path.join(base, 'handoffs'))) errors.push(`${path.relative(root, base)}/handoffs is missing`);
  active.push({ directory: path.relative(root, base).replaceAll('\\', '/'), plan_id: index.plan_id, plan_version: index.plan_version, next_action: index.next_action, plan_hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, index.human_plan || path.join(path.relative(root, base), human)))).digest('hex') });
}
const result = { valid: errors.length === 0, required_dirs: requiredDirs, active_plans: active, errors };
console.log(JSON.stringify(result, null, 2));
process.exitCode = errors.length ? 1 : 0;
