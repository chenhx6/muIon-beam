import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs, projectRootFromHere, ensureDirectory, jsonWrite, nowIso } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
if (!args.receipt) throw new Error('provide --receipt');
const receiptPath = path.resolve(root, args.receipt);
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const receiptSha256 = crypto.createHash('sha256').update(fs.readFileSync(receiptPath)).digest('hex');
const gitTree = spawnSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', receipt.local_commit], { encoding: 'utf8' });
if (gitTree.status !== 0) throw new Error(`historical commit unavailable: ${gitTree.stderr || gitTree.stdout}`);
const treeFiles = new Set(gitTree.stdout.split(/\r?\n/).filter(Boolean));
const gitExcluded = new Set(['00_project/traceability/index.sqlite', '_work/cache/cache-index.sqlite']);
const receiptFiles = Array.isArray(receipt.files) ? receipt.files : [];
const receiptNotInHistory = receiptFiles.filter((item) => !gitExcluded.has(item.path) && !treeFiles.has(item.path));
const treeExpectedExclusions = [...treeFiles].filter((item) => !receiptFiles.some((value) => value.path === item));
let driveState = null; let driveError = null;
try { driveState = JSON.parse(fs.readFileSync(path.join(receipt.drive_path, 'sync-state.json'), 'utf8')); } catch (error) { driveError = `${error.code || 'read-error'}: ${error.message}`; }
const driveFiles = Array.isArray(driveState?.files) ? driveState.files : [];
const driveMismatch = driveState ? receiptFiles.filter((item) => { const archived = driveFiles.find((value) => value.path === item.path); return !archived || archived.size !== item.size || archived.sha256 !== item.sha256; }) : receiptFiles;
const status = receiptNotInHistory.length || driveMismatch.length || driveError ? (driveError ? 'pending-audit' : 'invalid') : 'verified';
const audit = {
  audit_id: `AUDIT-${receipt.snapshot_id || receipt.sync_id}`,
  record_type: 'sync-receipt-audit', schema_version: '1.0.0', audited_at: nowIso(),
  receipt_path: path.relative(root, receiptPath).replaceAll('\\', '/'), receipt_sha256: receiptSha256,
  snapshot_id: receipt.snapshot_id, historical_commit: receipt.local_commit, drive_path: receipt.drive_path,
  source_status: receipt.status, status, receipt_file_count: receiptFiles.length, historical_tree_file_count: treeFiles.size,
  git_files_checked: receiptFiles.filter((item) => !gitExcluded.has(item.path)).length,
  snapshot_extra_files: [...gitExcluded].filter((item) => receiptFiles.some((value) => value.path === item)),
  expected_history_exclusions: treeExpectedExclusions,
  drive_files_checked: driveFiles.length, mismatches: [...receiptNotInHistory.map((item) => ({ kind: 'history-missing', path: item.path })), ...driveMismatch.map((item) => ({ kind: 'drive-mismatch', path: item.path }))],
  drive_error: driveError
};
const output = path.resolve(root, args.output || `00_project/traceability/sync-receipts/${audit.audit_id}.json`);
ensureDirectory(path.dirname(output)); jsonWrite(output, audit);
console.log(JSON.stringify({ status, audit_path: path.relative(root, output).replaceAll('\\', '/'), receipt_sha256: receiptSha256, git_files_checked: audit.git_files_checked, drive_files_checked: audit.drive_files_checked, mismatches: audit.mismatches.length }, null, 2));
process.exitCode = status === 'verified' ? 0 : 2;
