import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, sha256File, relativePath, jsonWrite } from './project-utils.mjs';
import { parseYamlFile } from './yaml-lite.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
if (!args.manifest) throw new Error('--manifest is required');
const manifestPath = path.resolve(root, args.manifest);
const doc = manifestPath.toLowerCase().endsWith('.json') ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : parseYamlFile(manifestPath);
const errors = [];
const warnings = [];
const checked = [];
const hashPattern = /^[a-f0-9]{64}$/i;
const filePath = (value) => path.resolve(root, String(value || ''));
const existsFile = (value, label) => {
  const file = filePath(value);
  if (!value || !fs.existsSync(file) || !fs.statSync(file).isFile()) { errors.push(`${label}: missing file ${value || '(empty)'}`); return null; }
  return file;
};
const checkHash = (file, expected, label) => {
  if (!hashPattern.test(String(expected || ''))) { errors.push(`${label}: invalid SHA256`); return; }
  const actual = sha256File(file);
  if (actual.toLowerCase() !== String(expected).toLowerCase()) errors.push(`${label}: SHA256 mismatch (expected ${expected}, got ${actual})`);
};
const pythonRuntime = () => process.env.MUION_PYTHON || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const runJsonCheck = (runtime, script, args) => {
  const run = spawnSync(runtime, ['-B', script, ...args], { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (run.status !== 0) return { status: 'fail', errors: [run.stderr || run.stdout || 'check failed'] };
  try { return JSON.parse(run.stdout); } catch { return { status: 'fail', errors: ['check did not return JSON'] }; }
};

if (!Array.isArray(doc.figures)) throw new Error('manifest.figures must be an array');
for (const [index, figure] of doc.figures.entries()) {
  const prefix = `figures[${index}]`;
  if (figure?.legacy_source_path && !figure.source_code) {
    warnings.push(`${prefix}: legacy figure without source code is retained as historical evidence only`);
    if (args.for_report) errors.push(`${prefix}: historical-only figure cannot be used as new report evidence`);
    continue;
  }
  for (const field of ['figure_id', 'run_id', 'figure_class', 'source_code', 'input_snapshot', 'backend', 'outputs', 'qa']) if (!figure || figure[field] === undefined) errors.push(`${prefix}: missing ${field}`);
  if (!figure || errors.some((item) => item.startsWith(`${prefix}: missing`))) continue;
  const source = existsFile(figure.source_code.path, `${prefix}.source_code.path`);
  if (source) {
    checkHash(source, figure.source_code.sha256, `${prefix}.source_code`); checked.push(relativePath(root, source));
    if (!fs.readFileSync(source, 'utf8').includes(figure.figure_id)) errors.push(`${prefix}: source must declare figure_id`);
    if (args.reproduce) {
      const sourceText = fs.readFileSync(source, 'utf8');
      if (!sourceText.includes('MUION_FIGURE_OUTPUT_DIR')) errors.push(`${prefix}: reproduction requires MUION_FIGURE_OUTPUT_DIR support`);
      else {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), `muion-figure-${figure.figure_id}-`));
        const runtime = process.env.MUION_PYTHON || 'python';
        const execution = spawnSync(runtime, ['-B', source], { cwd: root, encoding: 'utf8', timeout: 180000, env: { ...process.env, MUION_FIGURE_ID: figure.figure_id, MUION_FIGURE_OUTPUT_DIR: work, PYTHONDONTWRITEBYTECODE: '1' } });
        if (execution.status !== 0) errors.push(`${prefix}: reproduction failed: ${execution.stderr || execution.stdout || 'runtime error'}`);
        if (!fs.existsSync(path.join(work, `${figure.figure_id}.svg`))) errors.push(`${prefix}: reproduction did not create figure_id.svg in isolated output`);
      }
    }
  }
  const runManifest = existsFile(figure.input_snapshot.run_manifest, `${prefix}.input_snapshot.run_manifest`);
  if (runManifest) checked.push(relativePath(root, runManifest));
  if (!Array.isArray(figure.input_snapshot.source_data)) errors.push(`${prefix}.input_snapshot.source_data must be an array`);
  for (const [dataIndex, data] of (figure.input_snapshot.source_data || []).entries()) {
    const sourceData = existsFile(data.path, `${prefix}.input_snapshot.source_data[${dataIndex}]`);
    if (sourceData) { checkHash(sourceData, data.sha256, `${prefix}.input_snapshot.source_data[${dataIndex}]`); checked.push(relativePath(root, sourceData)); }
  }
  if (!Array.isArray(figure.outputs) || !figure.outputs.length) errors.push(`${prefix}.outputs must contain at least one output`);
  const outputNames = [];
  for (const [outputIndex, output] of (figure.outputs || []).entries()) {
    const outputFile = existsFile(output.path, `${prefix}.outputs[${outputIndex}]`);
    if (outputFile) { checkHash(outputFile, output.sha256, `${prefix}.outputs[${outputIndex}]`); outputNames.push(path.basename(outputFile).toLowerCase()); checked.push(relativePath(root, outputFile)); }
  }
  const hasSvg = outputNames.some((name) => name.endsWith('.svg'));
  const hasPdf = outputNames.some((name) => name.endsWith('.pdf'));
  if (!hasSvg) errors.push(`${prefix}: every new figure requires an SVG output`);
  if (figure.figure_class === 'final' && !hasPdf) errors.push(`${prefix}: final/core figure requires an SVG and PDF output`);
  if (figure.figure_class !== 'final' && outputNames.some((name) => /\.(png|jpe?g|tiff?)$/.test(name))) warnings.push(`${prefix}: raster output is redundant for a non-core figure`);
  if (figure.backend === 'python' && source && /\.py$/i.test(source) === false) errors.push(`${prefix}: python backend requires a Python source script`);
  if (!figure.qa || !['pass', 'warn', 'fail'].includes(figure.qa.status)) errors.push(`${prefix}.qa.status must be pass, warn or fail`);
  if (figure.qa?.status !== 'pass') warnings.push(`${prefix}: QA status is ${figure.qa?.status || 'missing'}`);
  if (args.audit && source && figure.backend === 'python') {
    const checkerRoot = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '').replaceAll('/', path.sep)), 'figure_checks');
    const sourceAudit = runJsonCheck(pythonRuntime(), path.join(checkerRoot, 'validate_figure.py'), [source, '--backend', 'python', '--json']);
    if (sourceAudit.summary && !sourceAudit.summary.ready) errors.push(`${prefix}: source audit has blocking findings`);
    const pdf = (figure.outputs || []).find((out) => /\.pdf$/i.test(out.path));
    if (pdf) {
      const pdfFile = path.resolve(root, pdf.path);
      const textAudit = runJsonCheck(pythonRuntime(), path.join(checkerRoot, 'audit_pdf_text.py'), [pdfFile, '--min-pt', '5', '--json']);
      if (textAudit.below_minimum_count || textAudit.auditable === false) errors.push(`${prefix}: PDF text audit failed`);
      const collisionAudit = runJsonCheck(pythonRuntime(), path.join(checkerRoot, 'audit_figure_collisions.py'), [pdfFile, '--json']);
      if (collisionAudit.verdict && collisionAudit.verdict !== 'PASS') errors.push(`${prefix}: PDF collision audit is ${collisionAudit.verdict}`);
    }
  }
  if (args.for_report && figure.qa?.status === 'pass') {
    const report = figure.qa.report ? filePath(figure.qa.report) : null;
    if (!report || !fs.existsSync(report)) errors.push(`${prefix}: QA report is required for report use`);
    else {
      try {
        const qa = JSON.parse(fs.readFileSync(report, 'utf8'));
        if (qa.figure_id !== figure.figure_id || qa.status !== 'pass' || qa.machine_status !== 'pass' || qa.visual_status !== 'pass') errors.push(`${prefix}: QA report does not prove machine and visual pass`);
      } catch (error) { errors.push(`${prefix}: invalid QA report: ${error.message}`); }
    }
  }
  if (figure.semantic_note === null && /censor|reached|filter|normal|interpol/i.test(JSON.stringify(figure))) warnings.push(`${prefix}: review semantic_note for censoring, filtering or transforms`);
}

const result = { manifest: relativePath(root, manifestPath), valid: errors.length === 0, errors, warnings, checked_files: [...new Set(checked)] };
if (args.report) jsonWrite(path.resolve(root, args.report), result);
console.log(JSON.stringify(result, null, 2));
process.exitCode = errors.length ? 1 : 0;
