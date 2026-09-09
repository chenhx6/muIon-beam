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

test('status reads do not initialize storage and corrupt state is blocked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-workflow-read-'));
  assert.equal(readWorkflowState(root).phase, 'idle');
  assert.equal(fs.existsSync(path.join(root, '07_research_system')), false);
  writeWorkflowState(root, { phase: 'planned' });
  fs.writeFileSync(path.join(root, '07_research_system/control/research-state/events.jsonl'), '{bad json}\n');
  const state = readWorkflowState(root);
  assert.equal(state.phase, 'blocked');
  assert.equal(state.state_error, true);
});
