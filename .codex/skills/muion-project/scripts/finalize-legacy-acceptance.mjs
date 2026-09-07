import path from 'node:path';
import { projectRootFromHere, jsonRead, jsonWrite, nowIso } from './project-utils.mjs';

const root = path.resolve(process.argv[2] || projectRootFromHere());
const runId = 'RUN-LEGACY-SMOKE-001-stage1-centered';
const taskId = 'TASK-LEGACY-SMOKE-001';
const modelId = 'MODEL-LEGACY-SMOKE-001';
const tag = 'r1-framework-acceptance';
const publishedCommit = 'fe727c59843013c4f738b6a487403db3930aa11c';
const runPath = path.join(root, '03_runs/formal', runId, 'run-manifest.json');
const migrationPath = path.join(root, '90_migration/from-D-muIon/migration-manifest.json');
const taskPath = path.join(root, '00_project/task-cards', `${taskId}.task-manifest.json`);
const modelPath = path.join(root, '02_models/model-manifests', `${modelId}.model-manifest.json`);

const run = jsonRead(runPath);
run.updated_at = nowIso();
run.acceptance_status = 'structural-accepted';
run.git = { ...(run.git || {}), commit: publishedCommit, tag };
run.drive = { ...(run.drive || {}), archive_status: 'three-way-verified', sync_state_ref: `${run.drive?.archive_path || ''}/sync-state.json` };
run.files = (run.files || []).map((artifact) => ({ ...artifact, drive_status: 'verified', gitee_status: artifact.gitee_status === 'published' ? 'published' : 'not-uploaded-by-policy' }));
jsonWrite(runPath, run);

const migration = jsonRead(migrationPath);
migration.updated_at = nowIso();
migration.acceptance_status = 'structural-accepted';
migration.drive_status = 'verified';
migration.archive_status = 'three-way-verified';
migration.gitee_status = 'selected-summary-published';
migration.files = (migration.files || []).map((item) => ({ ...item, drive_status: 'verified', gitee_status: 'not-uploaded-by-policy' }));
jsonWrite(migrationPath, migration);

for (const file of [taskPath, modelPath]) {
  const doc = jsonRead(file);
  doc.updated_at = nowIso();
  doc.acceptance_status = 'structural-accepted';
  doc.scientific_revalidation = 'not-performed';
  jsonWrite(file, doc);
}

console.log(JSON.stringify({ runPath, migrationPath, taskPath, modelPath, acceptance_status: 'structural-accepted', gitee_tag: tag, published_commit: publishedCommit }, null, 2));
