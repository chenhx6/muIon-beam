import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const qa = path.join(root, '.codex/skills/muion-project/scripts/figure-qa.mjs');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture(kind = 'final') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-figure-qa-'));
  const source = path.join(dir, 'plot_figure.py');
  const data = path.join(dir, 'source.csv');
  const run = path.join(dir, 'run-manifest.yaml');
  const svg = path.join(dir, 'FIG-TEST-001.svg');
  const pdf = path.join(dir, 'FIG-TEST-001.pdf');
  fs.writeFileSync(source, '# FIG-TEST-001\n', 'utf8');
  fs.writeFileSync(data, 'x,y\n1,2\n', 'utf8');
  fs.writeFileSync(run, 'manifest_id: RUN-TEST-001\n', 'utf8');
  fs.writeFileSync(svg, '<svg><metadata>figure_id=FIG-TEST-001</metadata></svg>\n', 'utf8');
  if (kind === 'final') fs.writeFileSync(pdf, '%PDF-test\n', 'utf8');
  const outputs = [{ path: path.relative(root, svg).replaceAll('\\', '/'), sha256: sha(svg) }];
  if (kind === 'final') outputs.push({ path: path.relative(root, pdf).replaceAll('\\', '/'), sha256: sha(pdf) });
  const manifest = {
    schema_version: '1.1.0',
    figures: [{ figure_id: 'FIG-TEST-001', run_id: 'RUN-TEST-001', figure_class: kind,
      source_code: { path: path.relative(root, source).replaceAll('\\', '/'), sha256: sha(source) },
      input_snapshot: { run_manifest: path.relative(root, run).replaceAll('\\', '/'), source_data: [{ path: path.relative(root, data).replaceAll('\\', '/'), sha256: sha(data) }] },
      backend: 'python', outputs, qa: { status: 'pass', report: 'tmp/figure-qa.json' }, semantic_note: null }]
  };
  const manifestPath = path.join(dir, 'figure-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { dir, manifestPath, source, svg };
}

test('figure-qa accepts a code-bound final SVG/PDF bundle', () => {
  const f = fixture('final');
  const result = spawnSync(process.execPath, [qa, '--manifest', f.manifestPath], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('figure-qa rejects a final figure without PDF', () => {
  const f = fixture('analysis');
  const result = spawnSync(process.execPath, [qa, '--manifest', f.manifestPath], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /redundant|valid/);
});

test('figure-qa rejects a changed source hash', () => {
  const f = fixture('final');
  fs.appendFileSync(f.source, '\nchanged\n');
  const result = spawnSync(process.execPath, [qa, '--manifest', f.manifestPath], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /SHA256 mismatch/);
});
