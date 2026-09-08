import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, projectRootFromHere, jsonRead, jsonWrite, sha256File, ensureDirectory, relativePath, nowIso } from './project-utils.mjs';
import { requireLegacyPhaseComplete } from './legacy-version-policy.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
requireLegacyPhaseComplete(root, 'legacy-smoke-regeneration');
const migrationPath = path.resolve(args.migration || path.join(root, '90_migration/from-D-muIon/migration-manifest.json'));
const migration = jsonRead(migrationPath);
const taskId = args.task_id || 'TASK-LEGACY-SMOKE-001';
const runId = args.run_id || 'RUN-LEGACY-SMOKE-001-stage1-centered';
const modelId = args.model_id || 'MODEL-LEGACY-SMOKE-001';
const runDir = path.join(root, '03_runs/formal', runId);
const reportDir = path.join(runDir, 'report');
const errors = [];
const warnings = [];

function relativeProject(file) { return relativePath(root, file); }
function findByName(name) { return (migration.files || []).find((item) => path.basename(item.destination_path).toLowerCase() === name.toLowerCase()); }
function checkInput(item) {
  if (!item) return false;
  const full = path.join(root, item.destination_path);
  if (!fs.existsSync(full)) { errors.push(`missing selected file: ${item.destination_path}`); return false; }
  if (sha256File(full) !== item.legacy_source_sha256) { errors.push(`hash mismatch: ${item.destination_path}`); return false; }
  return true;
}
function csvHeader(item) {
  if (!item) return null;
  const full = path.join(root, item.destination_path);
  const text = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0];
  if (!first || !first.includes(',')) warnings.push(`CSV header is unusual: ${item.destination_path}`);
  return first;
}

for (const item of migration.files || []) checkInput(item);
const jsonInputs = (migration.files || []).filter((item) => item.destination_path.toLowerCase().endsWith('.json'));
for (const item of jsonInputs) {
  try { JSON.parse(fs.readFileSync(path.join(root, item.destination_path), 'utf8')); }
  catch (error) { errors.push(`JSON parse failed: ${item.destination_path}: ${error.message}`); }
}
const csvInputs = (migration.files || []).filter((item) => item.destination_path.toLowerCase().endsWith('.csv'));
for (const item of csvInputs) csvHeader(item);

const reportSource = findByName('stage1_centered_source_100ns_cooling_extraction_report.md') || findByName('stage1_feasibility_report.md');
const coolingTable = findByName('cooling_density_summary.csv');
const transportTable = findByName('centered_transport_scan_master.csv') || findByName('transport_scan_master.csv');
const sensitivityTable = findByName('variable_sensitivity.csv');
const modelItems = (migration.files || []).filter((item) => ['.mph', '.sldprt', '.step', '.stp'].includes(path.extname(item.destination_path).toLowerCase()));
const figureItems = (migration.files || []).filter((item) => ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.svg'].includes(path.extname(item.destination_path).toLowerCase()));
if (!reportSource) warnings.push('historical report was not selected');
if (!coolingTable) warnings.push('cooling summary table was not selected');
if (!transportTable) warnings.push('transport summary table was not selected');
if (!modelItems.length) warnings.push('no historical model binary was selected');

ensureDirectory(reportDir);
ensureDirectory(path.join(root, '00_project/task-cards'));
ensureDirectory(path.join(root, '02_models/model-manifests'));
ensureDirectory(path.join(root, '05_reports/review'));

const taskManifest = {
  manifest_id: taskId,
  manifest_type: 'task',
  schema_version: '1.0.0',
  created_at: nowIso(),
  updated_at: nowIso(),
  task_id: taskId,
  task_name: '旧工作区 Stage-1 居中源迁移冒烟测试',
  source_type: 'legacy_import',
  is_upper_task: false,
  source_workspace: migration.source_workspace,
  assignment_source: '迁移实例验收',
  objective_zh: '验证新项目框架能承接旧工作区的真实报告、模型、参数、图件和结果关系。',
  physical_object: '自由 μ− 的 Stage-1 冷却与轴向输运历史工程模型',
  initial_conditions: ['历史输入来自旧工作区', '不重新运行 COMSOL 或 Geant4'],
  model_references: [modelId],
  analysis_questions: [
    { analysis_id: 'ANALYSIS-LEGACY-SMOKE-NE-DENSITY', question_zh: '历史报告中的 Ne 密度如何影响径向冷却时间？', factor_variables: ['neon_number_density'], response_metrics: ['radial_cooling_time'], priority: 'useful' },
    { analysis_id: 'ANALYSIS-LEGACY-SMOKE-FIELD', question_zh: '电场强度如何影响轴向加速和输运？', factor_variables: ['electric_field_strength'], response_metrics: ['acceleration_time', 'axial_velocity'], priority: 'useful' },
    { analysis_id: 'ANALYSIS-LEGACY-SMOKE-APERTURE', question_zh: '极板孔径如何影响孔口场分布和接受度？', factor_variables: ['electrode_aperture_diameter'], response_metrics: ['electric_field_peak', 'transport_survival'], priority: 'useful' }
  ],
  success_criteria: ['精选文件源与目标 SHA256 一致', 'JSON/CSV 可读取', '任务—模型—运行关系可索引', '报告和图引用可追踪'],
  expected_maturity: 'F1',
  historical_result: true,
  scientific_revalidation: 'not-performed',
  migration_manifest: relativeProject(migrationPath)
};
jsonWrite(path.join(root, '00_project/task-cards', `${taskId}.task-manifest.json`), taskManifest);

const modelManifest = {
  manifest_id: modelId,
  manifest_type: 'model',
  schema_version: '1.0.0',
  created_at: nowIso(),
  updated_at: nowIso(),
  model_id: modelId,
  model_name: 'Stage-1 legacy centered source model set',
  model_type: 'historical-model-set',
  revision: 'legacy-import-20260907',
  scientific_revalidation: 'not-performed',
  source_workspace: migration.source_workspace,
  files: modelItems.map((item) => ({ path: item.destination_path, legacy_source_path: item.legacy_source_path, sha256: item.legacy_source_sha256, size: item.legacy_source_size, retention_level: item.retention_level })),
  used_by_runs: [runId]
};
jsonWrite(path.join(root, '02_models/model-manifests', `${modelId}.model-manifest.json`), modelManifest);

const figureManifest = {
  manifest_id: `FIGURES-${runId}`,
  manifest_type: 'figure-manifest',
  schema_version: '1.0.0',
  run_id: runId,
  figures: figureItems.map((item, index) => ({ figure_id: `FIG-${runId}-${String(index + 1).padStart(3, '0')}`, run_id: runId, figure_type: /trajectory|particle/i.test(item.destination_path) ? 'analysis' : 'diagnostic', path: item.destination_path, source_data: [], generation_script: null, sha256: item.legacy_source_sha256, retention_level: item.retention_level, legacy_source_path: item.legacy_source_path, interpretation_zh: '历史导入图件，未重新生成。' }))
};
jsonWrite(path.join(reportDir, 'figure-manifest.json'), figureManifest);

const behaviorManifest = {
  manifest_id: `BEHAVIOR-${runId}`,
  manifest_type: 'behavior-analysis',
  schema_version: '1.0.0',
  run_id: runId,
  analyses: taskManifest.analysis_questions.map((question) => ({ ...question, run_id: runId, control_variables: [], baseline_run_id: null, comparison_run_ids: [], source_data_refs: [coolingTable?.destination_path, transportTable?.destination_path, sensitivityTable?.destination_path].filter(Boolean), evidence_figure_ids: figureManifest.figures.map((figure) => figure.figure_id), analysis_type: 'historical-evidence-mapping', confidence: 'historical-not-revalidated', interpretation_zh: '仅验证旧结果的文件关系和证据引用，不重新判断物理结论。', limitations_zh: '未重新运行原模型。' }))
};
jsonWrite(path.join(reportDir, 'behavior-analysis.json'), behaviorManifest);

const relativeReportSource = reportSource ? reportSource.destination_path : 'unknown';
const summary = `# 简洁版任务报告：旧工作区迁移冒烟测试\n\n## 任务目标\n\n验证旧工作区 Stage-1 居中源资料能否按新框架建立任务、模型、运行、报告和图件关系。\n\n## 基于的历史资料\n\n- 历史报告：\`${relativeReportSource}\`\n- 迁移 Manifest：\`${relativeProject(migrationPath)}\`\n- 选中文件数：${migration.selected_count}\n\n## 本次调整\n\n将旧资料按 P0/P1/P2 规则精选复制到新项目，并记录源路径、源 SHA256 和目标路径。\n\n## 结果\n\n- 复制和哈希校验：${errors.length ? '失败' : '通过'}\n- JSON/CSV 读取：${errors.length ? '需检查错误' : '通过'}\n- 新项目实例 Manifest：已生成\n- 科学重新验证：未进行\n\n## 主要限制\n\n这是迁移结构冒烟测试，不代表重新完成 COMSOL 或 Geant4 物理验证。\n\n## 详细报告\n\n[detailed-report-zh.md](detailed-report-zh.md)\n\n## Google Drive 归档路径\n\n${migration.drive_root || '待同步'}\n`;
fs.writeFileSync(path.join(reportDir, 'summary-report-zh.md'), summary, 'utf8');

const detailed = `# 详细版过程汇报：旧工作区迁移冒烟测试\n\n## 1. 任务目标和范围\n\n本次测试使用已经完成的旧工作内容，验证新项目的数据结构和追溯流程。测试不重新运行 COMSOL 或 Geant4。\n\n## 2. 输入、模型和迁移关系\n\n- 旧工作区：\`${migration.source_workspace}\`\n- 迁移 Manifest：\`${relativeProject(migrationPath)}\`\n- 任务 Manifest：\`00_project/task-cards/${taskId}.task-manifest.json\`\n- 模型 Manifest：\`02_models/model-manifests/${modelId}.model-manifest.json\`\n- 运行 ID：\`${runId}\`\n\n## 3. 历史物理问题\n\n旧报告研究自由 μ− 在 Ne 和均匀轴向磁场中的横向冷却、四环电极场作用和轴向输运。历史报告明确说明：缪原子形成、电子剥离、核俘获、真实 μ− 衰变权重和正式击穿验证尚未纳入。\n\n## 4. 文件和数据验收\n\n- 迁移文件总数：${migration.selected_count}\n- 选中文件总字节数：${migration.selected_bytes}\n- JSON 文件检查：${jsonInputs.length} 个\n- CSV 文件检查：${csvInputs.length} 个\n- 图件检查：${figureItems.length} 个\n- 模型文件检查：${modelItems.length} 个\n- 文件 SHA256：${errors.length ? '存在错误' : '全部一致'}\n\n## 5. 变量—行为关系登记\n\n本次从历史报告登记了 Ne 密度—冷却、电场—加速和孔径—局部场/接受度三个分析问题。图件只作为历史证据引用，不重新生成，也不强制将未研究关系扩展为新分析。\n\n详见：\n\n- [figure-manifest.json](figure-manifest.json)\n- [behavior-analysis.json](behavior-analysis.json)\n- [历史报告](${relativeReportSource})\n\n## 6. 迁移结论\n\n${errors.length ? '迁移冒烟测试未通过，需先修复文件或哈希错误。' : '迁移文件、任务关系、模型关系、运行关系和报告图件索引均已建立。'}\n\n## 7. 限制\n\n- \`scientific_revalidation: not-performed\`；\n- 历史结果不能直接当作新项目的实验验证；\n- 历史报告中的路径仍保留其旧上下文；\n- 模型二进制只记录指纹，不在本次测试中打开或重算。\n\n## 8. 后续实例验收\n\n需要人工确认旧任务到新任务、历史模型、运行、报告和图件之间的映射是否符合项目实际含义。\n`;
fs.writeFileSync(path.join(reportDir, 'detailed-report-zh.md'), detailed, 'utf8');

const runManifest = {
  manifest_id: `MANIFEST-${runId}`,
  manifest_type: 'run',
  schema_version: '1.0.0',
  created_at: nowIso(),
  updated_at: nowIso(),
  task_id: taskId,
  task_name: taskManifest.task_name,
  run_id: runId,
  run_kind: 'legacy-smoke-test',
  status: errors.length ? 'failed' : 'complete',
  maturity_level: 'F1',
  retention_level: 'P1',
  physical_regions: ['R02-slowing-capture', 'R04-fast-extraction', 'R05-acceleration-transport'],
  input_references: [coolingTable?.destination_path, transportTable?.destination_path, sensitivityTable?.destination_path].filter(Boolean),
  model_references: [modelId],
  variable_catalog_ref: '00_project/traceability/variable-catalog.yaml',
  source_workspace: migration.source_workspace,
  historical_result: true,
  scientific_revalidation: 'not-performed',
  software_versions: { historical_comsol: 'see historical report', historical_geant4: 'see historical metadata' },
  git: { commit: null, tag: null, dirty_files: [] },
  drive: { archive_path: migration.drive_root ? path.join(migration.drive_root, 'smoke-run', runId) : null, archive_status: migration.drive_root ? 'pending-verification' : 'pending' },
  reports: { summary_report: relativeProject(path.join(reportDir, 'summary-report-zh.md')), detailed_report: relativeProject(path.join(reportDir, 'detailed-report-zh.md')) },
  files: migration.files.map((item) => ({ path: item.destination_path, role: 'legacy-import', size: item.legacy_source_size, sha256: item.legacy_source_sha256, retention_level: item.retention_level, local_status: 'verified', drive_status: item.drive_status, gitee_status: 'pending' })),
  human_summary_zh: errors.length ? '迁移冒烟测试发现文件或哈希错误。' : '旧工作区精选资料已按新框架建立可追溯关系，科学结果尚未重新验证。',
  unknowns: ['历史运行的完整软件环境需要从旧资料补充'],
  limitations: ['未重新运行 COMSOL', '未重新运行 Geant4', '不代表新的物理验证']
};
jsonWrite(path.join(runDir, 'run-manifest.json'), runManifest);
const acceptance = `# Legacy smoke acceptance\n\n- Task: \`${taskId}\`\n- Model: \`${modelId}\`\n- Run: \`${runId}\`\n- Migration files checked: ${migration.selected_count}\n- File/hash validation: ${errors.length ? 'FAILED' : 'PASSED'}\n- Scientific revalidation: NOT PERFORMED\n- Source preserved: ${migration.preserve_source === true ? 'YES' : 'CHECK MANIFEST'}\n\nThis acceptance record validates data structure and traceability only. It does not certify the historical physics result.\n`;
fs.writeFileSync(path.join(root, '05_reports/review/legacy-smoke-acceptance-zh.md'), acceptance, 'utf8');
const result = { task_manifest: relativeProject(path.join(root, '00_project/task-cards', `${taskId}.task-manifest.json`)), model_manifest: relativeProject(path.join(root, '02_models/model-manifests', `${modelId}.model-manifest.json`)), run_manifest: relativeProject(path.join(runDir, 'run-manifest.json')), report_dir: relativeProject(reportDir), selected_files: migration.selected_count, figure_count: figureItems.length, json_count: jsonInputs.length, csv_count: csvInputs.length, valid: errors.length === 0, errors, warnings };
jsonWrite(path.join(runDir, 'smoke-test-result.json'), result);
console.log(JSON.stringify(result, null, 2));
process.exitCode = errors.length ? 1 : 0;
