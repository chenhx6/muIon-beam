import fs from 'node:fs';
import path from 'node:path';
import { parseYamlFile } from './yaml-lite.mjs';
const root = path.resolve(process.argv[2] || '.');
const data = parseYamlFile(path.join(root, '00_project/traceability/capability-map.yaml'));
const rows = (data.capabilities || []).map((c) => `| ${c.capability_id} | ${c.decision} | ${c.trigger_mode || 'unspecified'} | ${c.execution_kind || 'unspecified'} | ${c.primary_entrypoint} | ${c.decision_reason} |`);
fs.writeFileSync(path.join(root, '00_project/traceability/CAPABILITY_MAP.md'), `# 能力对照表\n\n由 capability-map.yaml 生成，请勿手工编辑。\n\n| 能力 | 决策 | 触发模式 | 执行类型 | 主要入口 | 原因 |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
