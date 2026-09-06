import fs from 'node:fs';
import path from 'node:path';
import { parseYamlFile } from './yaml-lite.mjs';

const source = path.resolve(process.argv[2] || '00_project/traceability/variable-catalog.yaml');
const outputDir = path.dirname(source);
const doc = parseYamlFile(source);
if (!Array.isArray(doc.variables)) throw new Error('variables must be a list');

function csv(value) {
  const text = Array.isArray(value) ? value.join('; ') : value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const columns = ['canonical_name', 'display_name_zh', 'definition_zh', 'unit', 'dimension', 'data_type', 'value_type', 'physical_region', 'model_layer', 'input_or_output', 'allowed_alias', 'introduced_in', 'deprecated_in', 'change_reason'];
const markdown = [
  '# VARIABLE_CATALOG',
  '',
  `来源：\`${path.relative(process.cwd(), source).replaceAll('\\', '/')}\`（自动生成，不手工编辑）`,
  '',
  '| 规范名称 | 中文名称 | 定义 | 单位 | 类型 | 区域 | 模型层 | 别名 |',
  '|---|---|---|---|---|---|---|---|',
  ...doc.variables.map((v) => `| ${v.canonical_name ?? ''} | ${v.display_name_zh ?? ''} | ${v.definition_zh ?? ''} | ${v.unit ?? ''} | ${v.value_type ?? ''} | ${(v.physical_region || []).join('<br>')} | ${v.model_layer ?? ''} | ${(v.allowed_alias || []).join(', ')} |`),
  '',
  '## 字段说明',
  '',
  '规范名称用于代码、参数文件和 Manifest；中文名称用于报告和图表；别名必须登记后才能使用。',
  ''
].join('\n');
const csvText = [columns.join(','), ...doc.variables.map((v) => columns.map((column) => csv(v[column])).join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(outputDir, 'VARIABLE_CATALOG.md'), markdown, 'utf8');
fs.writeFileSync(path.join(outputDir, 'VARIABLE_CATALOG.csv'), csvText, 'utf8');
console.log(JSON.stringify({ source, outputs: [path.join(outputDir, 'VARIABLE_CATALOG.md'), path.join(outputDir, 'VARIABLE_CATALOG.csv')] }, null, 2));
