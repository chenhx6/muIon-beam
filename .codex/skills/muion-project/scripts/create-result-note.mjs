import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, projectRootFromHere, ensureDirectory, nowIso } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const output = path.resolve(args.output || path.join(root, '05_reports/release', `${args.tag || 'result'}-result-note-zh.md`));
const text = `# Gitee 结果说明\n\n- 基于标签：${args.base_tag || '无'}\n- 本次任务：${args.task || '待填写'}\n- 本次调整：${args.change || '待填写'}\n- 优化内容：${args.optimization || '待填写'}\n- 结果：${args.result || '待填写'}\n- 主要限制：${args.limitations || '待填写'}\n- 详细报告：${args.detailed_report || '待填写'}\n- Google Drive 归档路径：${args.drive_path || '待填写'}\n- 生成时间：${nowIso()}\n`;
ensureDirectory(path.dirname(output));
if (fs.existsSync(output) && !args.force) throw new Error(`result note exists: ${output}; use --force to replace`);
fs.writeFileSync(output, text, 'utf8');
console.log(JSON.stringify({ output }, null, 2));
