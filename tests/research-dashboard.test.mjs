import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { handler } from '../11_tools/research-dashboard/server.mjs';
import { validateEvidenceNote } from '../11_tools/research-dashboard/evidence-notes.mjs';
import { inspectPhysicsContract } from '../11_tools/research-dashboard/physics-gate.mjs';
import { reviewClosure } from '../11_tools/research-dashboard/review-closure.mjs';
import { compareCapability } from '../11_tools/research-dashboard/capability-matrix.mjs';
import { normalizeLedger } from '../11_tools/research-dashboard/ledger-normalizer.mjs';
import { withDisplayNames } from '../11_tools/project-supervisor/progress-aggregator.mjs';

function removeTempTree(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 100, retryDelay: 100 });
  } catch (error) {
    const cleanup = spawnSync(process.execPath, ['-e', "require('node:fs').rmSync(process.env.MUION_TEST_TEMP,{recursive:true,force:true})"], {
      env: { ...process.env, MUION_TEST_TEMP: target }, encoding: 'utf8',
    });
    if (cleanup.status !== 0 || fs.existsSync(target)) throw error;
  }
}

function request(method, url) {
  return new Promise((resolve, reject) => {
    const req = { method, url };
    const chunks = [];
    const res = {
      writeHead: (status, headers) => { res.statusCode = status; res.headers = headers; },
      end: body => resolve({ status: res.statusCode, body: String(body || ''), headers: res.headers }),
    };
    try { handler(req, res); } catch (error) { reject(error); }
  });
}

test('dashboard is read-only and exposes only the status-board projection', async () => {
  assert.equal((await request('GET', '/')).status, 200);
  assert.equal((await request('GET', '/supervision.js')).status, 200);
  const response = await request('GET', '/api/status');
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body);
  assert.ok(data.generated_at);
  assert.ok(Array.isArray(data.supervision.sessions));
  assert.ok(Array.isArray(data.supervision.warnings));
  assert.ok(data.system_services.services.dashboard);
  for (const key of ['research_state', 'workflow', 'display', 'agents', 'artifact_triage']) assert.equal(key in data, false);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await request(method, '/api/status')).status, 405);
  assert.equal((await request('GET', '/bad')).status, 404);
});

test('dashboard status stays compact when artifact history contains large scans', async () => {
  const response = await request('GET', '/api/status');
  assert.equal(response.status, 200);
  assert.ok(Buffer.byteLength(response.body) < 65536);
  const data = JSON.parse(response.body);
  assert.equal('artifact_triage' in data.supervision, false);
  assert.equal(typeof data.supervision.artifact_counts.durable_unregistered, 'number');
});

test('dashboard exposes the farmer emergency pause instead of stale healthy process state', async () => {
  const data = JSON.parse((await request('GET', '/api/status')).body);
  const controlPath = path.join(process.cwd(), '_work/current/farmer/control.json');
  const control = fs.existsSync(controlPath) ? JSON.parse(fs.readFileSync(controlPath, 'utf8')) : null;
  if (control?.disabled) assert.equal(data.system_services.services.farmer.status, 'disabled');
});

test('dashboard status uses its live process identity instead of a stale supervisor PID', async () => {
  const data = JSON.parse((await request('GET', '/api/status')).body);
  assert.equal(data.system_services.services.dashboard.pid, process.pid);
  assert.equal(data.system_services.services.dashboard.status, 'healthy');
});

test('repeated polling leaves research state, plan checkpoint and tracked files unchanged', async () => {
  const files = [
    '07_research_system/control/research-state/state.yaml',
    '07_research_system/control/research-state/events.jsonl',
    '07_research_system/control/research-state/open-problems.yaml',
    '10_plans/active/20260924_dashboard-and-plan-upgrade/plan_v3.json',
  ];
  const hashes = () => files.map(file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  const status = () => spawnSync('git', ['status', '--porcelain'], { cwd: process.cwd(), encoding: 'utf8' }).stdout;
  const head = () => spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).stdout;
  const tags = () => spawnSync('git', ['tag', '--list'], { cwd: process.cwd(), encoding: 'utf8' }).stdout;
  const before = hashes();
  const gitBefore = status();
  const headBefore = head();
  const tagsBefore = tags();
  await request('GET', '/api/status');
  await request('GET', '/api/status');
  assert.deepEqual(hashes(), before);
  assert.equal(status(), gitBefore);
  assert.equal(head(), headBefore);
  assert.equal(tags(), tagsBefore);
});

test('board rendering uses backend groups and keeps DOM values as text', async () => {
  const page = (await request('GET', '/')).body;
  const script = fs.readFileSync(path.join(process.cwd(), '11_tools/research-dashboard/supervision.js'), 'utf8');
  for (const id of ['active-list', 'pending-list', 'active-count', 'pending-count', 'file-governance-grid']) assert.match(page, new RegExp('id=\"' + id + '\"'));
  assert.match(page, /需要处理/);
  assert.match(script, /board_group === 'running'/);
  assert.match(script, /board_group === 'needs-attention'/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /JSON\.stringify/);
  assert.match(script, /plan_progress/);
  assert.match(script, /running_subagents/);
  assert.match(script, /artifact_counts/);
});

test('unnamed task cards use a safe readable fallback', () => {
  const rows = withDisplayNames([
    { session_id: 'codex-01a0d764-48d5-7fb1-84a9-7324c1c83896', task_id: 'codex-01a0d764-48d5-7fb1-84a9-7324c1c83896' },
    { session_id: 'a', host_name: '主研究' },
    { session_id: 'b', host_name: '主研究' },
  ]);
  assert.equal(rows[0].display_name, '未命名任务');
  assert.doesNotMatch(rows.map(row => row.display_name).join('\n'), /01a0d764/);
  assert.equal(rows[1].display_name, '主研究 · 1');
  assert.equal(rows[2].display_name, '主研究 · 2');
});

test('evidence notes enforce conclusion levels without becoming state', () => {
  assert.equal(validateEvidenceNote({ facts: [], evidence: [], conclusion: [], conclusion_level: 'confirmed', risks: [], next_steps: [] }).valid, true);
  assert.equal(validateEvidenceNote({ facts: [], evidence: [], conclusion: [], conclusion_level: 'made-up', risks: [], next_steps: [] }).valid, false);
});

test('physics gate is advisory and contract-preserving', () => {
  const result = inspectPhysicsContract({ objective: 'x', initial_conditions: {}, boundary_conditions: {}, validation_requirements: ['v'] });
  assert.equal(result.status, 'ready-for-module-validation');
  assert.equal(result.preserves_contract, true);
});

test('review closure requires evidence and rerun validation', () => {
  assert.equal(reviewClosure({ status: 'closed', severity: 'P1', evidence: ['x'], fix: 'y', rerun_validation: true }).closed, true);
  assert.equal(reviewClosure({ status: 'closed', severity: 'P1' }).closed, false);
});

test('capability comparison is manual and evidence gated', () => {
  const result = compareCapability({ capability_id: 'team' }, { capability_id: 'team', revision: 'r', license: 'MIT', hash: 'h', tests: 't' });
  assert.equal(result.recommended, 'reference-only');
  assert.equal(result.manual_adoption_required, true);
  assert.equal(result.install_executed, false);
});

test('ledger normalization preserves runtime trace fields', () => {
  const result = normalizeLedger({ run_id: 'r', session_id: 's', selected_model: 'm', reasoning: 'xhigh', provider: 'p', status: 'running', unresolved_items: ['u'] });
  assert.equal(result.run, 'r');
  assert.equal(result.model, 'm');
  assert.equal(result.backend, 'p');
  assert.deepEqual(result.unresolved_items, ['u']);
});

test('research workflow validation exposes the advisory physics gate', async () => {
  const module = await import('../07_research_system/control/research-workflow/index.mjs');
  const result = module.validateResearchContract({ objective: 'x', initial_conditions: {}, boundary_conditions: {}, validation_requirements: ['v'] });
  assert.ok(result.advisory_physics_gate);
  assert.equal(result.advisory_physics_gate.preserves_contract, true);
});
