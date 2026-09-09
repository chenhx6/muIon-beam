import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const project = path.resolve(import.meta.dirname, '..');
const script = path.join(project, '.codex/skills/muion-project/scripts/autopilot.mjs');

function run(root, args) {
  return spawnSync(process.execPath, [script, '--project-root', root, ...args], { cwd: project, encoding: 'utf8' });
}

test('autopilot creates a resumable workflow run and records a blocked checkpoint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-autopilot-'));
  const planned = run(root, ['plan', '--task-id', 'TASK-AUTOPILOT-TEST']);
  assert.equal(planned.status, 0, planned.stderr);
  const runDoc = JSON.parse(planned.stdout);
  assert.equal(runDoc.stage, 'INTAKE');
  assert.equal(runDoc.status, 'PLANNED');
  assert.equal(fs.existsSync(path.join(root, runDoc.owned_paths_file)), true);
  const resumed = run(root, ['resume', '--workflow-run-id', runDoc.workflow_run_id]);
  assert.equal(resumed.status, 0, resumed.stderr);
  const blocked = JSON.parse(resumed.stdout);
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.next_action, 'create-task-card');
  const events = fs.readFileSync(path.join(root, '07_research_system/control/research-state/events.jsonl'), 'utf8');
  assert.match(events, /workflow-created/);
  assert.match(events, /stage-blocked/);
  const retried = run(root, ['retry', '--workflow-run-id', runDoc.workflow_run_id]);
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(JSON.parse(retried.stdout).status, 'BLOCKED');
});
