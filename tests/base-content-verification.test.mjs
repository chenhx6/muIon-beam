import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  BASE_CONTENT_VERIFIED,
  BASE_CONTENT_NOT_REVERIFIED,
  resolveBaseContentVerification
} from '../.codex/skills/muion-project/scripts/base-content-verification.mjs';

const scratch = path.resolve(import.meta.dirname, '..', '_work/scratch');

function receiptRoot() {
  const root = fs.mkdtempSync(path.join(scratch, 'base-verification-'));
  fs.mkdirSync(path.join(root, '00_project/traceability/sync-states'), { recursive: true });
  return root;
}

function writeReceipt(root, overrides = {}) {
  const state = {
    manifest_type: 'sync-state',
    schema_version: '1.0.0',
    sync_id: 'SYNC-SNAPSHOT-test',
    snapshot_id: 'SNAPSHOT-test',
    gitee_tag: 'base-tag',
    status: 'three-way-verified',
    verified_at: '2026-09-09T00:00:00.000Z',
    created_at: '2026-09-09T00:00:00.000Z',
    drive_path: path.join(root, 'drive'),
    local_commit: 'abc',
    gitee_remote_commit: 'abc',
    gitee_tag_commit: 'def',
    pending_actions: [],
    errors: [],
    ...overrides
  };
  const file = path.join(root, '00_project/traceability/sync-states/SYNC-SNAPSHOT-test.json');
  fs.writeFileSync(file, `${JSON.stringify(state)}\n`);
  return state;
}

test('missing base snapshot uses the explicit historical-tag wording', () => {
  const root = receiptRoot();
  const result = resolveBaseContentVerification(root, 'base-tag', { audit: () => ({ status: 'three-way-verified' }) });
  assert.equal(result.verified, false);
  assert.equal(result.message, BASE_CONTENT_NOT_REVERIFIED);
  assert.equal(result.reason, 'base-snapshot-missing');
});

test('second-layer project audit is required before claiming base content verified', () => {
  const root = receiptRoot();
  writeReceipt(root);
  const passed = resolveBaseContentVerification(root, 'base-tag', { audit: () => ({ status: 'three-way-verified' }) });
  assert.equal(passed.verified, true);
  assert.equal(passed.message, BASE_CONTENT_VERIFIED);
  assert.equal(passed.second_layer, 'three-way-verified');

  const failed = resolveBaseContentVerification(root, 'base-tag', { audit: () => ({ status: 'drift-detected' }) });
  assert.equal(failed.verified, false);
  assert.equal(failed.message, BASE_CONTENT_NOT_REVERIFIED);
  assert.equal(failed.second_layer, 'not-verified');
});

test('structurally incomplete receipts cannot claim base content verified', () => {
  const root = receiptRoot();
  writeReceipt(root, { pending_actions: ['verify-project-snapshot'] });
  const result = resolveBaseContentVerification(root, 'base-tag', { audit: () => ({ status: 'three-way-verified' }) });
  assert.equal(result.verified, false);
  assert.equal(result.message, BASE_CONTENT_NOT_REVERIFIED);
});

