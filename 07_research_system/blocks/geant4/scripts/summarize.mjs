import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseJsonFile, writeJson } from './common.mjs';

function markdown(result) {
  const rows = (result.scenarios || []).map((item) => {
    const validation = item.validation || item.clean || {};
    return `| ${item.scenario} | ${validation.status || 'not-evaluated'} | ${(validation.checks || []).filter((check) => check.passed).length}/${(validation.checks || []).length} |`;
  }).join('\n');
  return `# Geant4 MVP Smoke Summary\n\n- Status: **${result.status || 'not-evaluated'}**\n- Executable: ${result.executable || 'not available'}\n- Output directory: ${result.output_dir || 'not recorded'}\n\n| Scenario | Status | Checks |\n|---|---|---|\n${rows || '| (none) | not-yet-validated | 0/0 |'}\n\n${result.note || ''}\n`;
}

export function summarize(result, { output_dir } = {}) {
  const target = path.resolve(output_dir || path.dirname(result.output_dir || process.cwd()));
  const json = path.join(target, 'g4-result.json');
  const report = path.join(target, 'summary-report-zh.md');
  writeJson(json, result);
  if (fs.existsSync(report)) throw new Error(`Refusing to overwrite ${report}`);
  fs.writeFileSync(report, markdown(result));
  return { files: [json, report] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) throw new Error('usage: node 07_research_system/blocks/geant4/scripts/summarize.mjs --input smoke.json --output-dir DIR');
  const result = summarize(parseJsonFile(path.resolve(args.input)), { output_dir: args.output_dir });
  console.log(JSON.stringify(result, null, 2));
}
