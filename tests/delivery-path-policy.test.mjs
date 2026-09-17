import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateDeliveryPath } from '../.codex/skills/muion-project/scripts/delivery-path-policy.mjs';
import { classifyPaths } from '../.codex/skills/muion-project/scripts/delivery-plan.mjs';

const policy = {
  max_file_bytes: 1024,
  max_task_bytes: 16 * 1024,
  allow_prefixes: ['02_models/', '00_project/'],
  deny_prefixes: ['02_models/', '02_models/private/', '00_project/state/'],
  deny_extensions: ['.mph', '.step', '.root', '.bin'],
  model_sources: {
    prefix: '02_models/',
    extensions: ['.py', '.java', '.cc', '.mac', '.json', '.txt'],
    filenames: ['makefile'],
    excluded_directory_names: ['build', 'output', 'outputs', 'results', 'logs', 'cache']
  }
};

test('model source exception admits small source and rejects generated or binary paths', () => {
  for (const file of ['02_models/a.py', '02_models/b.java', '02_models/c.cc', '02_models/d.mac', '02_models/e.json']) {
    assert.deepEqual(evaluateDeliveryPath(file, policy), { allowed: true, reason: 'model-rebuild-source', text_required: true });
  }
  assert.equal(evaluateDeliveryPath('02_models/build/a.py', policy).reason, 'generated-model-output');
  assert.equal(evaluateDeliveryPath('02_models/output/a.json', policy).reason, 'generated-model-output');
  assert.equal(evaluateDeliveryPath('02_models/a.mph', policy).reason, 'protected-binary-extension');
  assert.equal(evaluateDeliveryPath('02_models/a.unknown', policy).reason, 'model-file-not-source');
  assert.equal(evaluateDeliveryPath('02_models/private/a.py', policy).reason, 'protected-path');
});

test('delivery plan uses the same exception and rejects binary masquerading as text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-delivery-policy-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  };
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'policy-test');
    git('config', 'user.email', 'policy-test@example.invalid');
    fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
    git('add', '.'); git('commit', '-m', 'base');
    fs.mkdirSync(path.join(root, '02_models', 'output'), { recursive: true });
    fs.writeFileSync(path.join(root, '02_models', 'model.py'), 'print(1)\n');
    fs.writeFileSync(path.join(root, '02_models', 'model.mph'), 'binary placeholder\n');
    fs.writeFileSync(path.join(root, '02_models', 'output', 'result.json'), '{}\n');
    fs.writeFileSync(path.join(root, '02_models', 'opaque.bin'), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(root, '02_models', 'fake.json'), Buffer.from([123, 0, 125]));
    fs.writeFileSync(path.join(root, '02_models', 'invalid.txt'), Buffer.from([0xff, 0xfe, 0x61]));
    fs.writeFileSync(path.join(root, '02_models', 'large.txt'), 'x'.repeat(1025));
    const plan = classifyPaths(root, { gitee: policy }, { paths: [] });
    assert.ok(plan.candidates.includes('02_models/model.py'));
    assert.ok(plan.excluded.some((item) => item.path === '02_models/model.mph' && item.reason === 'protected-binary-extension'));
    assert.ok(plan.excluded.some((item) => item.path === '02_models/output/result.json' && item.reason === 'generated-model-output'));
    assert.ok(plan.excluded.some((item) => item.path === '02_models/fake.json' && item.reason === 'model-source-is-binary'));
    assert.ok(plan.excluded.some((item) => item.path === '02_models/invalid.txt' && item.reason === 'model-source-not-utf8'));
    assert.ok(plan.excluded.some((item) => item.path === '02_models/large.txt' && item.reason === 'gitee-size-limit'));
    const protectedPlan = classifyPaths(root, { gitee: policy }, { paths: ['02_models/'] });
    assert.equal(protectedPlan.candidates.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
