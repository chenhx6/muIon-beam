import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ensureInitialized, recordWorkflowEvent, readState } from '../07_research_system/control/research-state/index.mjs';

const project = path.resolve(import.meta.dirname, '..');
const script = (name) => path.join(project, '.codex/skills/muion-project/scripts', name);
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'muion-orchestration-')); }
function run(file, root, args) { return spawnSync(process.execPath, [script(file), '--project-root', root, ...args], { cwd: project, encoding: 'utf8' }); }
function plan(root, task = 'TASK-ORCHESTRATION-TEST') { const result = run('autopilot.mjs', root, ['plan', '--task-id', task]); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }

test('deep interview persists one startup intake and resumes without another question', () => {
  const root = temp(); const workflow = plan(root); const input = path.join(root, 'intake.json'); fs.writeFileSync(input, JSON.stringify({ intake: { objective: 'test', scope: ['workflow'], non_goals: ['models'], success_criteria: ['handoff'] }, task_card: null }));
  let result = run('deep-interview.mjs', root, ['start', '--workflow-run-id', workflow.workflow_run_id, '--task-id', workflow.task_id, '--input', 'intake.json']);
  assert.equal(result.status, 0, result.stderr); const completed = JSON.parse(result.stdout); assert.equal(completed.stage, 'CONSENSUS_PLAN'); assert.ok(completed.requirements_handoff);
  result = run('deep-interview.mjs', root, ['resume', '--workflow-run-id', workflow.workflow_run_id]); assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).stage, 'CONSENSUS_PLAN');
});

test('consensus plan enforces Architect before Critic and writes a handoff', () => {
  const root = temp(); const workflow = plan(root); const input = path.join(root, 'intake.json'); fs.writeFileSync(input, JSON.stringify({ intake: { objective: 'test' } }));
  assert.equal(run('deep-interview.mjs', root, ['start', '--workflow-run-id', workflow.workflow_run_id, '--task-id', workflow.task_id, '--input', 'intake.json']).status, 0);
  assert.equal(run('consensus-plan.mjs', root, ['start', '--workflow-run-id', workflow.workflow_run_id, '--requirements', `07_research_system/control/research-state/workflows/${workflow.workflow_run_id}/requirements-handoff.json`]).status, 0);
  const planPath = path.join(root, '07_research_system/control/research-state/workflows', workflow.workflow_run_id, 'consensus-plan.json');
  const planHash = crypto.createHash('sha256').update(fs.readFileSync(planPath)).digest('hex');
  const critic = path.join(root, 'critic.json'); fs.writeFileSync(critic, JSON.stringify({ verdict: 'APPROVE', workflow_run_id: workflow.workflow_run_id, review_cycle: 1, plan_sha256: planHash, reviewed_at: new Date().toISOString(), architect_sha256: 'wrong' }));
  assert.notEqual(run('consensus-plan.mjs', root, ['record-review', '--workflow-run-id', workflow.workflow_run_id, '--role', 'critic', '--review-file', 'critic.json']).status, 0);
  const architect = path.join(root, 'architect.json'); fs.writeFileSync(architect, JSON.stringify({ verdict: 'APPROVE', workflow_run_id: workflow.workflow_run_id, review_cycle: 1, plan_sha256: planHash, reviewed_at: new Date().toISOString(), role: 'architect' }));
  assert.equal(run('consensus-plan.mjs', root, ['record-review', '--workflow-run-id', workflow.workflow_run_id, '--role', 'architect', '--review-file', 'architect.json']).status, 0);
  const architectHash = crypto.createHash('sha256').update(fs.readFileSync(architect)).digest('hex');
  fs.writeFileSync(critic, JSON.stringify({ verdict: 'APPROVE', workflow_run_id: workflow.workflow_run_id, review_cycle: 1, plan_sha256: planHash, reviewed_at: new Date().toISOString(), architect_sha256: architectHash, role: 'critic' }));
  assert.equal(run('consensus-plan.mjs', root, ['record-review', '--workflow-run-id', workflow.workflow_run_id, '--role', 'critic', '--review-file', 'critic.json']).status, 0);
  const final = JSON.parse(run('consensus-plan.mjs', root, ['status', '--workflow-run-id', workflow.workflow_run_id]).stdout); assert.equal(final.stage, 'PRECHECK'); assert.ok(final.consensus_handoff);
});

test('ultraqa records a machine-readable pass/fail artifact', () => {
  const root = temp(); const workflow = plan(root, `TASK-ORCHESTRATION-QA-${Date.now()}`);
  const result = run('ultraqa.mjs', root, ['run', '--workflow-run-id', workflow.workflow_run_id]);
  assert.ok([0, 2].includes(result.status));
  const file = path.join(root, '07_research_system/control/research-state/workflows', workflow.workflow_run_id, 'ultraqa.json');
  assert.equal(fs.existsSync(file), true); const qa = JSON.parse(fs.readFileSync(file, 'utf8')); assert.ok(['pass', 'fail'].includes(qa.status));
});

test('autopilot resumes an interrupted RUNNING attempt without losing the old attempt', () => {
  const root = temp(); const workflow = plan(root, 'TASK-ORCHESTRATION-RECOVERY');
  const file = path.join(root, '07_research_system/control/research-state/workflows', workflow.workflow_run_id, 'workflow.json');
  const interrupted = { ...workflow, stage: 'RUNNING', status: 'RUNNING', attempts: 1, next_action: 'collect-result' };
  fs.writeFileSync(file, JSON.stringify(interrupted, null, 2));
  const resumed = run('autopilot.mjs', root, ['resume', '--workflow-run-id', workflow.workflow_run_id]); assert.equal(resumed.status, 0, resumed.stderr);
  const value = JSON.parse(resumed.stdout); assert.equal(value.status, 'FAILED_RETRYABLE'); assert.equal(value.next_action, 'retry');
  const retried = run('autopilot.mjs', root, ['retry', '--workflow-run-id', workflow.workflow_run_id]); assert.equal(retried.status, 0, retried.stderr); assert.equal(JSON.parse(retried.stdout).attempts, 2);
});

test('workflow events are idempotent and conflicting keys fail closed', () => {
  const root = temp(); ensureInitialized(root);
  const event = { event_type: 'test', workflow_run_id: 'WF-IDEMPOTENT', task_id: 'TASK-IDEMPOTENT', stage: 'INTAKE', status: 'PLANNED', next_action: 'run', operation_id: 'op-1', idempotency_key: 'op-1' };
  recordWorkflowEvent(event, root); const revision = readState(root).state_revision; recordWorkflowEvent(event, root); assert.equal(readState(root).state_revision, revision);
  assert.throws(() => recordWorkflowEvent({ ...event, status: 'BLOCKED' }, root), /idempotency conflict/);
});
