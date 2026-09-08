import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const BASE_CONTENT_VERIFIED = '基础内容已核验';
export const BASE_CONTENT_NOT_REVERIFIED = '基于历史 tag，基础快照未重新核验';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function snapshotReceipts(root) {
  const directory = path.join(root, '00_project/traceability/sync-states');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.startsWith('SYNC-SNAPSHOT-') && name.endsWith('.json'))
    .map((name) => ({ file: path.join(directory, name), state: readJson(path.join(directory, name)) }))
    .filter(({ state }) => state && state.manifest_type === 'sync-state');
}

function receiptTimestamp(state) {
  return Date.parse(state.verified_at || state.created_at || '') || 0;
}

export function findBaseSnapshotReceipt(root, baseTag) {
  if (!baseTag) return null;
  return snapshotReceipts(root)
    .filter(({ state }) => state.gitee_tag === baseTag)
    .sort((a, b) => receiptTimestamp(b.state) - receiptTimestamp(a.state))[0] || null;
}

export function structurallyVerifiedReceipt(state) {
  return Boolean(
    state &&
    state.status === 'three-way-verified' &&
    state.verified_at &&
    state.drive_path &&
    state.local_commit &&
    state.gitee_remote_commit === state.local_commit &&
    state.gitee_tag_commit &&
    Array.isArray(state.errors) && state.errors.length === 0 &&
    Array.isArray(state.pending_actions) && state.pending_actions.length === 0
  );
}

function parseAuditOutput(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Ignore diagnostics before the final JSON result.
    }
  }
  return null;
}

export function runBaseSnapshotAudit(root, receipt, options = {}) {
  if (!structurallyVerifiedReceipt(receipt?.state)) return { status: 'not-verified', reason: 'receipt-not-verified' };
  if (typeof options.audit === 'function') {
    const audit = options.audit(root, receipt.state);
    return audit?.status === 'three-way-verified'
      ? { status: 'three-way-verified', audit }
      : { status: 'not-verified', reason: 'second-layer-audit-failed', audit };
  }
  const auditScript = path.join(root, '.codex/skills/muion-project/scripts/audit-project-snapshot.mjs');
  if (!fs.existsSync(auditScript)) return { status: 'not-verified', reason: 'audit-script-missing' };
  const result = spawnSync(process.execPath, [auditScript, '--project-root', root, '--drive-path', receipt.state.drive_path], {
    cwd: root,
    encoding: 'utf8',
    timeout: options.timeout || 120000,
    windowsHide: true
  });
  const audit = parseAuditOutput(result.stdout);
  if (result.status !== 0 || audit?.status !== 'three-way-verified') {
    return { status: 'not-verified', reason: 'second-layer-audit-failed', exit_code: result.status, audit };
  }
  return { status: 'three-way-verified', audit };
}

export function resolveBaseContentVerification(root, baseTag, options = {}) {
  const receipt = findBaseSnapshotReceipt(root, baseTag);
  if (!receipt) {
    return { verified: false, message: BASE_CONTENT_NOT_REVERIFIED, base_tag: baseTag || null, reason: 'base-snapshot-missing' };
  }
  const audit = runBaseSnapshotAudit(root, receipt, options);
  const verified = audit.status === 'three-way-verified';
  return {
    verified,
    message: verified ? BASE_CONTENT_VERIFIED : BASE_CONTENT_NOT_REVERIFIED,
    base_tag: baseTag,
    snapshot_id: receipt.state.snapshot_id || null,
    sync_id: receipt.state.sync_id || path.basename(receipt.file, '.json'),
    drive_path: receipt.state.drive_path || null,
    receipt_file: receipt.file,
    second_layer: audit.status,
    reason: verified ? null : audit.reason || 'second-layer-audit-failed'
  };
}
