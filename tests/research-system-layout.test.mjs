import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureInitialized } from '../07_research_system/control/research-state/index.mjs';
import { freezeContract } from '../07_research_system/control/contracts/index.mjs';

test('research system writes state and contracts only under canonical control paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-layout-'));
  ensureInitialized(root);
  assert.equal(fs.existsSync(path.join(root, '07_research_system/control/research-state/state.yaml')), true);
  assert.equal(fs.existsSync(path.join(root, 'research-state')), false);
  const frozen = freezeContract({ module: 'comsol', objective: 'layout test', inputs: {}, required_outputs: ['validation'] }, { root });
  assert.match(frozen.path, /^07_research_system\/control\/contracts\/instances\//);
  assert.equal(fs.existsSync(path.join(root, 'contracts')), false);
});
