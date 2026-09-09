import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, ensureDirectory, nowIso } from './project-utils.mjs';

const EXPERIENCE_DIR = '00_project/traceability/experiences';

function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all'; }
function readRecords(root) {
  const dir = path.join(root, EXPERIENCE_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^EXP-[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name)).sort().map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

export function summarizeExperiences(root, category = null, output = null) {
  const records = readRecords(root).filter((item) => !category || item.category === category);
  const selected = category || 'all';
  const counts = { positive: 0, negative: 0, neutral: 0 };
  const tags = new Map();
  for (const record of records) {
    if (counts[record.polarity] === undefined) counts[record.polarity] = 0;
    counts[record.polarity] += 1;
    for (const tag of record.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
  }
  const lines = [
    `# 经验汇总：${selected}`,
    '',
    `- 生成时间：${nowIso()}`,
    `- 经验条数：${records.length}`,
    `- 正向：${counts.positive || 0}；负向：${counts.negative || 0}；中性：${counts.neutral || 0}`,
    '',
    '## 可共享结论',
    '',
  ];
  if (!records.length) lines.push('当前类别没有已登记经验。');
  else for (const record of records) lines.push(`- **[${record.polarity}] ${record.title}**：${record.reusable_value}`);
  lines.push('', '## 记录明细', '', '| 时间 | 极性 | 状态 | 标题 | 证据/动作 |', '|---|---|---|---|---|');
  for (const record of records) lines.push(`| ${record.recorded_at || ''} | ${record.polarity} | ${record.status || ''} | ${record.title} | ${(record.evidence || []).concat(record.actions || []).join('；')} |`);
  lines.push('', '## 高频标签', '');
  if (!tags.size) lines.push('暂无标签。');
  else for (const [tag, count] of [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) lines.push(`- ${tag}: ${count}`);
  const file = output ? path.resolve(root, output) : path.join(root, EXPERIENCE_DIR, `SUMMARY-${slug(selected)}.md`);
  ensureDirectory(path.dirname(file));
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return { file, category: selected, count: records.length, counts };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.project_root || projectRootFromHere());
  const result = summarizeExperiences(root, args.category || null, args.output || null);
  console.log(JSON.stringify({ status: 'summarized', path: path.relative(root, result.file).replaceAll('\\', '/'), category: result.category, count: result.count, counts: result.counts }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
