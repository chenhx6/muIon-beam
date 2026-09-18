import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { applyApprovedPromotion, buildPromotionPlan, classifyArtifact } from '../11_tools/project-supervisor/artifact-promoter.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
test('classifies canonical result paths, source assets, binaries and unknown output', () => {
  assert.equal(classifyArtifact({ path: '03_runs/formal/r/run.json' }).status, 'formal-run');
  assert.equal(classifyArtifact({ path: '05_reports/review/report.md' }).status, 'report');
  assert.equal(classifyArtifact({ path: '02_models/model.py' }).status, 'project-asset');
  assert.equal(classifyArtifact({ path: '02_models/model.mph' }).status, 'drive-required');
  assert.equal(classifyArtifact({ path: 'scratch/result.dat' }).status, 'retained-blocked');
});
test('approved project asset promotion is copy-only, hash checked and idempotent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-promoter-')); const worktree = path.join(root, 'worker'); fs.mkdirSync(path.join(worktree, '02_models'), { recursive: true });
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('muion-promoter-')); fs.rmSync(root, { recursive: true, force: true }); });
  const content = 'print(1)\n'; fs.writeFileSync(path.join(worktree, '02_models/model.py'), content);
  const plan = buildPromotionPlan(root, { session_id: 's', task_id: 't', worktree_path: worktree, artifacts: [{ path: '02_models/model.py', bytes: Buffer.byteLength(content), sha256: hash(content) }] });
  assert.equal(plan.artifacts[0].approved, false);
  const applied = applyApprovedPromotion(root, plan, { approvedPaths: ['02_models/model.py'] });
  assert.equal(applied.results[0].promotion, 'promoted'); assert.equal(fs.readFileSync(path.join(root, '02_models/model.py'), 'utf8'), content);
  const second = applyApprovedPromotion(root, plan, { approvedPaths: ['02_models/model.py'] }); assert.equal(second.results[0].promotion, 'already-verified');
});
test('drive-required and blocked outputs remain retained without copy', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-promoter-blocked-')); const worktree = path.join(root, 'worker'); fs.mkdirSync(path.join(worktree, '02_models'), { recursive: true });
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(worktree, '02_models/model.mph'), 'binary');
  const plan = buildPromotionPlan(root, { worktree_path: worktree, artifacts: [{ path: '02_models/model.mph', bytes: 6, sha256: hash('binary') }] });
  const applied = applyApprovedPromotion(root, plan, { approvedPaths: ['02_models/model.mph'] }); assert.equal(applied.results[0].promotion, 'blocked'); assert.equal(fs.existsSync(path.join(root, '02_models/model.mph')), false);
});
