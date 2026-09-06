import fs from 'node:fs';
import path from 'node:path';

const runDir = path.resolve(process.argv[2] || '03_runs/formal/RUN-YYYYMMDD-NNN-short-name');
const reportDir = path.join(runDir, 'report');
fs.mkdirSync(path.join(reportDir, 'checkpoints'), { recursive: true });
fs.mkdirSync(path.join(reportDir, 'tables'), { recursive: true });
fs.mkdirSync(path.join(reportDir, 'selected-figures'), { recursive: true });
const files = {
  'summary-report-zh.md': '# 简洁版任务报告\n\n## 任务目标\n\n## 基于的模型和结果标签\n\n## 本次调整\n\n## 关键指标\n\n## 主要结论\n\n## 主要限制\n\n## 下一步\n\n## 详细报告\n\n## Google Drive 归档路径\n',
  'detailed-report-zh.md': '# 详细版过程汇报\n\n## 1. 任务目标和范围\n\n## 2. 初始条件、模型和变量\n\n## 3. 预期物理行为\n\n## 4. 基线结果\n\n## 5. 变量变化和行为响应\n\n## 6. 调试节点和异常\n\n## 7. 场分布、粒子轨迹和输运\n\n## 8. 候选方案与最终方案\n\n## 9. μ 子存活、电荷态和效率\n\n## 10. 不确定性和限制\n\n## 11. 结论与下一步\n',
  'figure-manifest.yaml': 'schema_version: 1.0.0\nfigures: []\n',
  'behavior-analysis.yaml': 'schema_version: 1.0.0\nanalyses: []\n'
};
for (const [name, content] of Object.entries(files)) {
  const file = path.join(reportDir, name);
  if (!fs.existsSync(file) || process.argv.includes('--force')) fs.writeFileSync(file, content, 'utf8');
}
for (const checkpoint of ['checkpoint-00-baseline', 'checkpoint-01-parameter-screen', 'checkpoint-02-model-or-geometry-change', 'checkpoint-03-diagnostic-findings', 'checkpoint-04-candidate-design', 'checkpoint-05-final-design']) {
  const file = path.join(reportDir, 'checkpoints', `${checkpoint}.md`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${checkpoint}\n\n记录本节点的输入、结果、图件和结论。\n`, 'utf8');
}
console.log(JSON.stringify({ runDir, reportDir, created: Object.keys(files) }, null, 2));
