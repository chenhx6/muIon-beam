import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { classifyPaths } from '../.codex/skills/muion-project/scripts/delivery-plan.mjs';

const root = path.resolve(import.meta.dirname, '..');
test('delivery policy excludes generated smoke state and large/protected files', () => {
  const policy = {
    gitee: {
      max_file_bytes: 10,
      max_task_bytes: 20,
      allow_prefixes: ['.codex/skills/', '00_project/'],
      deny_prefixes: ['00_project/state/3d-smoke/'],
      deny_extensions: ['.bin']
    }
  };
  const plan = classifyPaths(root, policy, { paths: ['.codex/skills/evolution/scripts/ensure-toolchain.mjs'] });
  assert.ok(Array.isArray(plan.candidates));
  assert.ok(plan.excluded.every((item) => item.path !== undefined));
});

test('delivery policy file is present and generated state remains local', () => {
  assert.equal(fs.existsSync(path.join(root, '00_project/config/delivery-policy.json')), true);
  assert.equal(fs.existsSync(path.join(root, '00_project/state/3d-smoke')), true);
});

