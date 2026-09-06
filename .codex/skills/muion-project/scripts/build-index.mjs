import fs from 'node:fs';
import path from 'node:path';
import { parseYamlFile } from './yaml-lite.mjs';

const root = path.resolve(process.argv[2] || '.');
const traceability = path.join(root, '00_project', 'traceability');
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.name === 'run-manifest.yaml') result.push(full);
  }
  return result;
}
const manifests = walk(path.join(root, '03_runs', 'formal'));
const rows = [];
for (const file of manifests) {
  try { rows.push({ file, doc: parseYamlFile(file) }); } catch (error) { rows.push({ file, error: error.message }); }
}
const generated = {
  PROJECT_INDEX: ['# PROJECT_INDEX', '', `项目根目录：\`${root}\``, '旧工作区 `D:\\muIon` 当前不迁移。', ''],
  TASK_INDEX: ['# TASK_INDEX', '', '| 任务 ID | 任务名称 | 当前运行 | 状态 | 物理区域 |', '|---|---|---|---|---|'],
  MODEL_INDEX: ['# MODEL_INDEX', '', '| 模型引用 | 使用运行 | 版本来源 |', '|---|---|---|'],
  RESULTS_INDEX: ['# RESULTS_INDEX', '', '| 运行 ID | 任务 ID | 父结果 | 成熟度 | 标签 | 结论 | Drive 路径 |', '|---|---|---|---|---|---|---|'],
  REFERENCE_INDEX: ['# REFERENCE_INDEX', '', '参考资料索引由项目资料清单维护。参考资料本体放在 Google Drive 的 `references` 目录。']
};
for (const row of rows) {
  if (row.error) continue;
  const d = row.doc;
  const regions = (d.physical_regions || []).join('<br>');
  generated.TASK_INDEX.push(`| ${d.task_id || ''} | ${d.task_name || ''} | ${d.run_id || ''} | ${d.status || ''} | ${regions} |`);
  for (const model of (d.model_references || [])) generated.MODEL_INDEX.push(`| ${model} | ${d.run_id || ''} | ${d.git?.commit || ''} |`);
  generated.RESULTS_INDEX.push(`| ${d.run_id || ''} | ${d.task_id || ''} | ${d.parent_result_tag || ''} | ${d.maturity_level || ''} | ${d.git?.tag || ''} | ${d.human_summary_zh || ''} | ${d.drive?.archive_path || ''} |`);
}
for (const [name, lines] of Object.entries(generated)) fs.writeFileSync(path.join(traceability, `${name}.md`), `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ manifests: manifests.length, outputs: Object.keys(generated).map((name) => path.join(traceability, `${name}.md`)) }, null, 2));
