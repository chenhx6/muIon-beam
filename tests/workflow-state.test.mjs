import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWorkflowState, writeWorkflowState } from '../.codex/skills/muion-project/scripts/workflow-state.mjs';

test('workflow state persists only known phases', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-workflow-'));
  writeWorkflowState(root, { phase: 'planned', active_goal_id: 'g1' });
  assert.equal(readWorkflowState(root).phase, 'planned');
  assert.throws(() => writeWorkflowState(root, { phase: 'bad' }));
});
