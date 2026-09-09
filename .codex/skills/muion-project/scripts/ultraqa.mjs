import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, jsonWrite, nowIso } from './project-utils.mjs';
import { readWorkflow, workflowDir, rel, appendStageEvent } from './workflow-store.mjs';

const args = parseArgs(process.argv.slice(2)); const root = path.resolve(args.project_root || path.resolve(import.meta.dirname, '../../../..')); const command = args._[0] || 'status'; const id = args.workflow_run_id;
function main() {
  if (!id) throw new Error(`${command} requires --workflow-run-id`); const run = readWorkflow(root, id); const dir = workflowDir(root, id); fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, 'ultraqa.json');
  if (command === 'status') { console.log(JSON.stringify(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { status: 'missing' }, null, 2)); return; }
  if (command !== 'run') throw new Error('Usage: ultraqa run|status --workflow-run-id <id>');
  const commands = [
    ['architecture', 'tests/architecture-smoke.mjs', []],
    ['manifests', '.codex/skills/muion-project/scripts/validate-manifests.mjs', []],
    ['variables', '.codex/skills/muion-project/scripts/validate-variable-catalog.mjs', []],
  ];
  const toolRoot = path.resolve(import.meta.dirname, '../../../..');
  const checks = commands.map(([name, script, scriptArgs]) => { const target = path.resolve(toolRoot, script); const result = spawnSync(process.execPath, [target, ...scriptArgs], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }); return { name, command: `${process.execPath} ${script}`, exit_code: result.status ?? 1, passed: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || '' }; });
  const passed = checks.every((item) => item.passed); const value = { schema_version: '1.0.0', artifact_type: 'ultraqa', workflow_run_id: id, task_id: run.task_id, status: passed ? 'pass' : 'fail', created_at: nowIso(), checks };
  jsonWrite(file, value); run.qa_artifact = rel(root, file); appendStageEvent(root, run, 'ultraqa-completed', 'QA', passed ? 'READY' : 'BLOCKED', passed ? 'archive' : 'repair-qa', { artifact_refs: [run.qa_artifact], qa_passed: passed }); console.log(JSON.stringify(value, null, 2));
}
main();
