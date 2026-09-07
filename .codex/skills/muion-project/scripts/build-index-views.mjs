import fs from 'node:fs';
import path from 'node:path';
import { parseYamlFile } from './yaml-lite.mjs';
import { projectRootFromHere, walkFiles, relativePath, parseArgs } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args._[0] || args.root || projectRootFromHere());
const traceability = path.join(root, '00_project', 'traceability');
const files = walkFiles(root, { ignoredDirectories: ['.git', 'node_modules', '_work'] }).filter((file) => /\.(ya?ml|json)$/i.test(file));
const docs = [];
const errors = [];
for (const file of files) {
  const relative = relativePath(root, file);
  if (/^(00_project\/traceability\/(VARIABLE_CATALOG|PROJECT_INDEX|TASK_INDEX|MODEL_INDEX|RESULTS_INDEX|REFERENCE_INDEX)\.(md|csv)|package-lock\.json)$/i.test(relative)) continue;
  try {
    const doc = file.toLowerCase().endsWith('.json') ? JSON.parse(fs.readFileSync(file, 'utf8')) : parseYamlFile(file);
    if (doc && typeof doc === 'object' && (doc.manifest_id || doc.migration_id || doc.publication_id || doc.sync_id || doc.figures || doc.analyses || doc.variables)) docs.push({ file: relative, doc });
  } catch (error) { errors.push({ file: relative, error: error.message }); }
}

const generated = {
  PROJECT_INDEX: ['# PROJECT_INDEX', '', `项目根目录：\`${root}\``, '旧工作区 `D:\\muIon` 已完成任务，但迁移仍须 copy-only 并保留原件。', '', '| Manifest ID | 类型 | 来源路径 | 状态 |', '|---|---|---|---|'],
  TASK_INDEX: ['# TASK_INDEX', '', '| 任务 ID | 任务名称 | 来源 | 状态 | 当前运行 |', '|---|---|---|---|---|'],
  MODEL_INDEX: ['# MODEL_INDEX', '', '| 模型 ID/引用 | 类型 | 版本 | 来源路径 | 使用运行 |', '|---|---|---|---|---|'],
  RESULTS_INDEX: ['# RESULTS_INDEX', '', '| 运行 ID | 任务 ID | 父结果 | 成熟度 | 标签 | 结论 | Drive 路径 |', '|---|---|---|---|---|---|---|'],
  REFERENCE_INDEX: ['# REFERENCE_INDEX', '', '参考资料索引由资料 Manifest 或清单维护。参考资料本体可放在 Google Drive 的 `references` 目录。']
};
const seen = { tasks: new Set(), models: new Set(), runs: new Set(), manifests: new Set() };
for (const { file, doc } of docs) {
  const manifestId = doc.manifest_id || doc.migration_id || doc.publication_id || doc.sync_id || file;
  if (!seen.manifests.has(String(manifestId))) {
    seen.manifests.add(String(manifestId));
    generated.PROJECT_INDEX.push(`| ${manifestId} | ${doc.manifest_type || ''} | ${file} | ${doc.status || ''} |`);
  }
  if (doc.task_id && !seen.tasks.has(String(doc.task_id))) {
    seen.tasks.add(String(doc.task_id));
    generated.TASK_INDEX.push(`| ${doc.task_id} | ${doc.task_name || ''} | ${doc.source_type || doc.run_kind || ''} | ${doc.status || ''} | ${doc.run_id || ''} |`);
  }
  for (const model of doc.model_references || []) {
    const modelId = typeof model === 'object' ? model.model_id || model.path : model;
    if (!modelId || seen.models.has(String(modelId))) continue;
    seen.models.add(String(modelId));
    generated.MODEL_INDEX.push(`| ${modelId} | ${typeof model === 'object' ? model.model_type || '' : ''} | ${typeof model === 'object' ? model.revision || '' : ''} | ${typeof model === 'object' ? model.path || '' : ''} | ${doc.run_id || ''} |`);
  }
  if (doc.run_id && !seen.runs.has(String(doc.run_id))) {
    seen.runs.add(String(doc.run_id));
    const git = doc.git || {};
    const drive = doc.drive || {};
    generated.RESULTS_INDEX.push(`| ${doc.run_id} | ${doc.task_id || ''} | ${doc.parent_result_tag || ''} | ${doc.maturity_level || ''} | ${git.tag || ''} | ${doc.human_summary_zh || ''} | ${drive.archive_path || doc.drive_path || ''} |`);
  }
}
for (const [name, lines] of Object.entries(generated)) fs.writeFileSync(path.join(traceability, `${name}.md`), `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ root, manifests: docs.length, parseErrors: errors, outputs: Object.keys(generated).map((name) => path.join(traceability, `${name}.md`)) }, null, 2));
