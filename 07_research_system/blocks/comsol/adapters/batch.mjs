import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function quote(value) { return `"${String(value).replaceAll('"', '\\"')}"`; }

function commandFromTemplate(template, replacements) {
  return template.replace(/\{(executable|task|case|result|workdir)\}/g, (_, key) => quote(replacements[key]));
}

function runShell(command, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`COMSOL adapter timed out after ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout?.on('data', (value) => { stdout += value; });
    child.stderr?.on('data', (value) => { stderr += value; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`COMSOL command exited ${code}: ${stderr || stdout}`));
      else resolve({ code, stdout, stderr });
    });
  });
}

export function createComsolBatchAdapter({ executable, command_template, build_command_template = null, working_directory = process.cwd(), timeout_ms = 3600000, capabilities = {} } = {}) {
  if (!executable || !command_template) throw new Error('createComsolBatchAdapter requires executable and command_template');
  if (!fs.existsSync(executable)) throw new Error(`COMSOL executable does not exist: ${executable}`);
  const root = path.resolve(working_directory);
  return {
    kind: 'comsol-batch-command',
    version: '6.4-or-configured',
    available: true,
    capabilities: { build: true, solve: true, parallel_cases: false, ...capabilities },
    executable,
    command_template,
    async build(task) {
      if (!build_command_template) return { status: 'adapter-not-executed', model_handle: { mode: 'external-command', working_directory: root }, note: 'No build_command_template was supplied; Build remains an explicit adapter plan.' };
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-comsol-build-'));
      const taskFile = path.join(temp, 'task.json');
      const resultFile = path.join(temp, 'build-result.json');
      fs.writeFileSync(taskFile, `${JSON.stringify(task, null, 2)}\n`);
      const command = commandFromTemplate(build_command_template, { executable, task: taskFile, case: '', result: resultFile, workdir: temp });
      try {
        await runShell(command, root, timeout_ms);
        const value = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : {};
        return { status: 'built', model_handle: value.model_handle || value, adapter_result: value };
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    },
    async solveCase(caseSpec, { task }) {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-comsol-'));
      const taskFile = path.join(temp, 'task.json');
      const caseFile = path.join(temp, 'case.json');
      const resultFile = path.join(temp, 'result.json');
      fs.writeFileSync(taskFile, `${JSON.stringify(task, null, 2)}\n`);
      fs.writeFileSync(caseFile, `${JSON.stringify(caseSpec, null, 2)}\n`);
      const command = commandFromTemplate(command_template, { executable, task: taskFile, case: caseFile, result: resultFile, workdir: temp });
      try {
        await runShell(command, root, timeout_ms);
        if (!fs.existsSync(resultFile)) throw new Error(`COMSOL command completed without result JSON: ${resultFile}`);
        return JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    }
  };
}

export function detectInstalledComsolBatch() {
  const candidates = [
    process.env.COMSOL_BATCH,
    'C:\\Program Files\\COMSOL\\COMSOL64\\Multiphysics\\bin\\win64\\comsolbatch.exe'
  ].filter(Boolean);
  const executable = candidates.find((value) => fs.existsSync(value)) || null;
  if (!executable) return { detected: false, executable: null, version: null };
  const version = fs.statSync(executable).size ? (String(executable).includes('COMSOL64') ? '6.4 (file metadata; command not executed)' : 'detected (command not executed)') : null;
  return { detected: true, executable, version };
}
