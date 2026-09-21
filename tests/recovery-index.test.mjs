import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildRecoveryIndex, writeRecoveryIndex } from '../.codex/skills/muion-project/scripts/recovery-index.mjs';

test('recovery index links Gitee, Drive receipt, cloud pending, incident and plan state', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muion-recovery-index-')); const drive = path.join(root, 'drive'); const remote = path.join(root, 'remote.git');
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout.trim(); };
  git('init', '-b', 'main'); spawnSync('git', ['init', '--bare', remote], { cwd: root, encoding: 'utf8' }); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.invalid'); fs.writeFileSync(path.join(root, 'README.md'), 'x\n'); git('add', '.'); git('commit', '-m', 'base'); git('remote', 'add', 'origin', remote); git('push', 'origin', 'main');
  fs.mkdirSync(path.join(root, '00_project/traceability/project-snapshots'), { recursive: true }); fs.mkdirSync(path.join(root, '00_project/traceability/incidents'), { recursive: true }); fs.mkdirSync(path.join(root, '10_plans/active/20260916_project_supervisor_auto_recovery'), { recursive: true });
  fs.writeFileSync(path.join(root, '00_project/traceability/project-snapshots/SNAPSHOT-x.json'), JSON.stringify({ record_type: 'committed-project-snapshot', snapshot_id: 'SNAPSHOT-x', commit: git('rev-parse', 'HEAD'), verified_at: '2026-09-20T00:00:00Z', drive_path: 'drive/project/snapshots/SNAPSHOT-x', status: 'mapped-drive-verified', file_count: 1, total_bytes: 2, manifest_sha256: 'sha' }));
  fs.writeFileSync(path.join(root, '00_project/traceability/project-snapshots/CLOUD-x.json'), JSON.stringify({ record_type: 'snapshot-cloud-audit', snapshot_id: 'SNAPSHOT-x', recorded_at: '2026-09-20T00:01:00Z', cloud_upload_verification: 'pending', conclusion: 'pending', next_action: 'verify' }));
  fs.writeFileSync(path.join(root, '00_project/traceability/incidents/I.json'), JSON.stringify({ record_type: 'incident', incident_id: 'I', status: 'contained', severity: 'P1', unresolved: ['u'] }));
  fs.writeFileSync(path.join(root, '10_plans/active/20260916_project_supervisor_auto_recovery/plan_index.json'), JSON.stringify({ task_id: 'T', status: 'executing', current_phase: 'P4', next_action: 'verify' }));
  const result = buildRecoveryIndex(root, { driveRoot: drive, git: args => git(...args), now: '2026-09-20T00:02:00Z' });
  assert.equal(result.gitee.verified_match, true); assert.equal(result.drive.latest_snapshot.snapshot_id, 'SNAPSHOT-x'); assert.equal(result.drive.latest_cloud_audit.cloud_upload_verification, 'pending'); assert.equal(result.open_incidents[0].incident_id, 'I'); assert.equal(result.workflow.next_action, 'verify');
  const written = writeRecoveryIndex(root, drive, { git: args => git(...args), now: '2026-09-20T00:02:00Z' }); assert.equal(fs.existsSync(written.destination), true); assert.equal(written.index.drive.cleanup_allowed, false);
});
