import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalRoot } from './runtime-store.mjs';
import { acquireProjectLock, releaseProjectLock, applyIntegration, checkSession, closeSession, continueAfterIntegration, planIntegration, readSession, submitSession } from '../../.codex/skills/team/scripts/session-concurrency.mjs';
import { runGit, sha256File } from '../../.codex/skills/muion-project/scripts/project-utils.mjs';
import { syncMirrorOnDelivery } from '../../.codex/skills/muion-project/scripts/drive-mirror-sync.mjs';
import { createTaskTag, taskTagName } from '../../.codex/skills/muion-project/scripts/create-task-tag.mjs';

const statusPaths = root => {
  return spawnSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8', windowsHide: true }).stdout.split(/\r?\n/).filter(Boolean);
};

export function prepareIntegration({ root, sessionId }) {
  const session = readSession(root, sessionId);
  const checked = checkSession({ root, sessionId });
  if (checked.status !== 'ready') return { status: 'blocked-ownership', session_id: sessionId, outside_claim_paths: checked.outside_claim_paths };
  if (session.mode !== 'worktree' || !session.branch) return { status: 'blocked-mode', session_id: sessionId, mode: session.mode };
  if (session.status === 'active') {
    if (session.resume_count) return { status: 'blocked-submit', session_id: sessionId, reason: 'resumed work requires a fresh submission before integration' };
    try { submitSession({ root, sessionId }); }
    catch (error) { return { status: 'blocked-submit', session_id: sessionId, reason: error.message }; }
  }
  try { return { status: 'ready-for-integration', session_id: sessionId, receipt: planIntegration({ root, sessionId }) }; }
  catch (error) { return { status: 'blocked-submit', session_id: sessionId, reason: error.message }; }
}

export function integratePrepared({ root, sessionId }) {
  if (statusPaths(root).length) return { status: 'blocked-dirty-leader', session_id: sessionId, next_action: 'preserve leader changes and retry after a clean integration checkout' };
  const prepared = prepareIntegration({ root, sessionId });
  if (prepared.status !== 'ready-for-integration') return prepared;
  const result = applyIntegration({ root, sessionId });
  return { ...result, session_id: sessionId, source_branch: readSession(root, sessionId).branch };
}

function nodePath(root, value) {
  const absolute = path.resolve(root, value);
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative) || !relative.startsWith('10_plans/')) throw new Error('plan file must stay under 10_plans');
  return { absolute, relative };
}
function nodeRecordPath(root, planId, nodeIds, sourceCommit) {
  const slug = value => String(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
  return path.join(root, '_work/current/publish-outbox/node-delivery', slug(planId) + '-' + nodeIds.map(slug).sort().join('-') + '-' + String(sourceCommit || 'unknown').slice(0, 12) + '.json');
}
function readRecord(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function writeRecord(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temp, file);
}
function supersedeUnmergedAttempts(root, planId, nodeIds, sessionId, sourceCommit) {
  const sample = nodeRecordPath(root, planId, nodeIds, sourceCommit); const prefix = path.basename(sample).slice(0, -17);
  const legacyName = prefix.replace(/-$/, '') + '.json';
  const directory = path.dirname(sample); if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory).filter(value => (value === legacyName || value.startsWith(prefix)) && value.endsWith('.json'))) {
    const file = path.join(directory, name); const attempt = readRecord(file);
    if (!attempt || attempt.session_id !== sessionId || attempt.source_commit === sourceCommit || attempt.status === 'delivered' || attempt.status === 'superseded-source') continue;
    if (attempt.integration_head || !['pending-integration','blocked-submit','blocked-ownership'].includes(attempt.status)) throw new Error('previous node source is already integrated or published; finish that outbox before changing source SHA');
    attempt.status = 'superseded-source'; attempt.superseded_by = sourceCommit; attempt.superseded_at = new Date().toISOString(); attempt.supersede_reason = 'fresh checkpoint after explicit same-worktree resume'; writeRecord(file, attempt);
  }
}
function isAncestor(root, ancestor, descendant) { return runGit(root, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true }).status === 0; }
function mainCheckout(root, publication) {
  const branch = runGit(root, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  if (branch !== publication.branch) throw new Error('leader delivery requires the configured main checkout');
  if (statusPaths(root).length) throw new Error('leader checkout is dirty; preserve its changes and retry after a clean delivery checkout');
  const fetched = runGit(root, ['fetch', publication.remote, publication.branch], { timeout: 120000, allowFailure: true });
  if (fetched.status !== 0) throw new Error('cannot fetch remote main: ' + (fetched.stderr || fetched.stdout).trim());
  const remoteRef = 'refs/remotes/' + publication.remote + '/' + publication.branch;
  const local = runGit(root, ['rev-parse', 'HEAD']).stdout.trim(); const remote = runGit(root, ['rev-parse', remoteRef]).stdout.trim();
  if (local !== remote && isAncestor(root, local, remote)) runGit(root, ['merge', '--ff-only', remoteRef]);
  else if (local !== remote && !isAncestor(root, remote, local)) {
    const merged = runGit(root, ['merge', '--no-edit', '--no-ff', remoteRef], { allowFailure: true });
    if (merged.status !== 0) {
      const conflicts = runGit(root, ['diff', '--name-only', '--diff-filter=U'], { allowFailure: true }).stdout.split(/\r?\n/).filter(Boolean);
      runGit(root, ['merge', '--abort'], { allowFailure: true });
      return { status: 'blocked-remote-conflict', conflicts, detail: (merged.stderr || merged.stdout).trim() };
    }
  }
  if (statusPaths(root).length) throw new Error('remote main merge left a dirty leader checkout');
  return { status: 'ready', remote_ref: remoteRef, head: runGit(root, ['rev-parse', 'HEAD']).stdout.trim() };
}
function runNodeValidation(root, node) {
  const validation = node.validation || {}; const files = validation.full_test_suite
    ? fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.mjs')).map(name => 'tests/' + name).sort()
    : validation.test_files || [];
  for (const file of files) {
    const rel = String(file).replaceAll('\\', '/');
    if (!rel.startsWith('tests/') || rel.split('/').includes('..') || !fs.existsSync(path.join(root, rel))) throw new Error('invalid node validation file: ' + file);
  }
  const steps = [];
  if (files.length) {
    const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 50 * 1024 * 1024 });
    steps.push({ command: 'node --test ' + files.join(' '), status: result.status === 0 ? 'passed' : 'failed', output: (result.stdout || '') .slice(-3000), error: (result.stderr || '').slice(-3000) });
    if (result.status !== 0) return { passed: false, steps };
  }
  if (validation.architecture_check !== false) {
    const result = spawnSync(process.execPath, ['tests/architecture-smoke.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    steps.push({ command: 'node tests/architecture-smoke.mjs', status: result.status === 0 ? 'passed' : 'failed', output: (result.stdout || '').slice(-3000), error: (result.stderr || '').slice(-3000) });
    if (result.status !== 0) return { passed: false, steps };
  }
  return { passed: true, steps };
}
function syncNodeDrive(root, driveRoot) {
  const result = syncMirrorOnDelivery(root, driveRoot ? { driveRoot } : {});
  if (result.status !== 'mapped-drive-verified') return { status: result.status || 'pending-drive', result };
  const manifest = JSON.parse(fs.readFileSync(result.manifest_path, 'utf8'));
  return { status: 'mapped-drive-verified', root: manifest.drive_root, manifest_path: result.manifest_path, manifest_sha256: sha256File(result.manifest_path), file_count: manifest.file_count, total_bytes: manifest.total_bytes, source_commit: runGit(root, ['rev-parse', 'HEAD']).stdout.trim(), files: manifest.files };
}

export function buildCleanupDispositionReceipt(plan, cloudReadback) {
  const expected = Array.isArray(plan.checkpoint?.required_historical_cleanup_sessions) ? plan.checkpoint.required_historical_cleanup_sessions : [];
  if (!expected.length) return null;
  const batch = cloudReadback?.cleanup_disposition;
  if (batch?.status !== 'verified' || !batch.generated_at || !Array.isArray(batch.sessions)) throw new Error('N3 requires a verified historical cleanup disposition batch');
  const actual = new Map(batch.sessions.map(item => [item.session_id, item]));
  if (actual.size !== expected.length || expected.some(item => !actual.has(item.session_id))) throw new Error('cleanup disposition does not cover the fixed historical session set');
  const sha256 = value => /^[a-f0-9]{64}$/i.test(String(value || ''));
  const sessions = expected.map(item => {
    const result = actual.get(item.session_id);
    if (result.branch !== item.branch || result.source_commit !== item.source_commit || result.status !== 'verified' || result.cleanup_result?.status !== 'branch-removed' || result.cleanup_result?.worktree_removed !== true || result.cleanup_result?.branch_removed !== true || !result.cleanup_receipt_sha256 || !result.preflight_receipt_sha256) throw new Error('historical cleanup result is incomplete: ' + item.session_id);
    if (!['verified','not-found'].includes(result.host_completion?.status) || !result.process_check || result.process_check.status !== 'clear') throw new Error('historical host/process evidence is incomplete: ' + item.session_id);
    if (result.gitee_readback?.status !== 'verified' || result.drive_readback?.status !== 'verified' || !Array.isArray(result.path_mappings)) throw new Error('historical Gitee, Drive or path mapping evidence is incomplete: ' + item.session_id);
    if (!sha256(result.cleanup_receipt_sha256) || !sha256(result.preflight_receipt_sha256) || !sha256(result.drive_readback.manifest_sha256) || result.path_mappings.some(mapping => !sha256(mapping.source_sha256) || !sha256(mapping.delivery_sha256) || mapping.delivery_sha256 !== mapping.drive_sha256 || !String(mapping.disposition_ref || '').trim())) throw new Error('historical cleanup receipt contains incomplete hashes or path mappings: ' + item.session_id);
    if (result.host_completion.status === 'not-found' && !['active_lookup','archived_lookup','state_index','turn_history'].every(key => result.host_completion.absence_checks?.[key] === 'not-found')) throw new Error('host absence evidence is incomplete: ' + item.session_id);
    return {
      session_id: item.session_id, branch: item.branch, source_commit: item.source_commit, merge_base: result.merge_base,
      path_mappings: result.path_mappings,
      gitee_readback: { status:result.gitee_readback.status, remote:result.gitee_readback.remote, branch:result.gitee_readback.branch, commit:result.gitee_readback.commit, remote_head:result.gitee_readback.remote_head, verified_path_count:result.gitee_readback.verified_path_count },
      drive_readback: { status:result.drive_readback.status, manifest_sha256:result.drive_readback.manifest_sha256, file_count:result.drive_readback.file_count, total_bytes:result.drive_readback.total_bytes, verified_path_count:result.drive_readback.verified_path_count },
      host_completion: { status:result.host_completion.status, host_session_id:result.host_completion.host_session_id, source:result.host_completion.source, verified_at:result.host_completion.verified_at, ...(result.host_completion.absence_checks ? { absence_checks:result.host_completion.absence_checks } : {}) },
      process_check: { status:result.process_check.status, checked_at:result.process_check.checked_at, process_count:result.process_check.process_ids?.length ?? null },
      cleanup: { status:result.cleanup_result.status, worktree_removed:result.cleanup_result.worktree_removed, branch_removed:result.cleanup_result.branch_removed, ignored_file_count:result.cleanup_result.ignored_file_count, ignored_bytes:result.cleanup_result.ignored_bytes, quarantine_file_count:result.cleanup_result.quarantine_file_count, preserved_file_count:result.cleanup_result.preserved_file_count, local_archive_root:result.cleanup_result.local_archive_root, completed_at:result.cleanup_result.completed_at, local_receipt_sha256:result.cleanup_receipt_sha256, preflight_receipt_sha256:result.preflight_receipt_sha256 },
    };
  });
  return { schema_version:1, record_type:'historical-worktree-cleanup-disposition', status:'verified', plan_id:plan.plan_id, node_id:'N3', created_at:batch.generated_at, sessions };
}

function planAndNodes(root, planFile, nodeIds) {
  const planRef = nodePath(root, planFile); const plan = JSON.parse(fs.readFileSync(planRef.absolute, 'utf8'));
  if (plan.schema_version !== 1 || !plan.plan_id || !Array.isArray(plan.nodes)) throw new Error('invalid plan node document');
  const nodes = nodeIds.map(id => { const node = plan.nodes.find(item => item.id === id); if (!node) throw new Error('plan node not found: ' + id); return node; });
  return { ...planRef, plan, nodes };
}

export function deliverPlanNode({ root, sessionId, nodeIds, nodeId, planFile, sourceHead, sourceFiles, driveRoot } = {}) {
  const repoRoot = canonicalRoot(path.resolve(root)); const ids = [...new Set((nodeIds || (nodeId ? [nodeId] : [])).map(String))].sort();
  if (!ids.length) throw new Error('node delivery requires at least one plan node');
  const session = readSession(repoRoot, sessionId); const worktree = session.worktree_path;
  const plan = planAndNodes(worktree, planFile, ids);
  if (plan.nodes.every(node => node.status === 'delivered')) return { status: 'node-delivered-idempotent', outbox: null };
  const fixedSource = sourceHead || runGit(worktree, ['rev-parse', 'HEAD']).stdout.trim();
  const recordFile = nodeRecordPath(repoRoot, plan.plan.plan_id, ids, fixedSource); let record = readRecord(recordFile);
  if (!record) supersedeUnmergedAttempts(repoRoot, plan.plan.plan_id, ids, sessionId, fixedSource);
  let fileManifest = sourceFiles || record?.source_files || [];
  if (!record && !fileManifest.length && ['active','submitted'].includes(session.status)) {
    if (session.status === 'submitted') {
      const receipt = session.receipt_path ? readRecord(path.resolve(repoRoot, session.receipt_path)) : null;
      if (!receipt || receipt.source_head !== fixedSource || receipt.source_branch !== session.branch) throw new Error('submitted receipt does not match the fixed source SHA');
    }
    const changed = runGit(worktree, ['diff', '--name-only', session.base_ref + '..' + fixedSource]).stdout.split(/\r?\n/).filter(Boolean);
    fileManifest = changed.map(file => { const absolute = path.resolve(worktree, file); const blob = runGit(worktree, ['rev-parse', fixedSource + ':' + file], { allowFailure: true }); return { path: file, sha256: fs.existsSync(absolute) ? sha256File(absolute) : null, blob_sha: blob.status === 0 ? blob.stdout.trim() : null }; });
  }
  const canonicalFile = value => String(value || '').replaceAll('\\', '/').toLowerCase();
  if (record && (record.plan_id !== plan.plan.plan_id || JSON.stringify(record.node_ids) !== JSON.stringify(ids) || record.source_commit !== fixedSource || record.session_id !== sessionId || (sourceFiles && JSON.stringify(sourceFiles) !== JSON.stringify(record.source_files)))) throw new Error('delivery retry does not match its fixed plan, node, source SHA, file list and session');
  if (!record && !fileManifest.length) throw new Error('first node delivery requires the exact checkpoint path/hash list');
  for (const item of fileManifest) { const rel = String(item.path || '').replaceAll('\\', '/'); const abs = path.resolve(worktree, rel); const within = path.relative(worktree, abs); if (!rel || rel.startsWith('/') || path.isAbsolute(within) || within === '..' || within.startsWith('..' + path.sep)) throw new Error('checkpoint manifest path escapes the worker: ' + rel); const actual = fs.existsSync(abs) ? sha256File(abs) : null; const blob = runGit(worktree, ['rev-parse', fixedSource + ':' + item.path], { allowFailure: true }); const blobSha = blob.status === 0 ? blob.stdout.trim() : null; if (actual !== item.sha256 || blobSha !== item.blob_sha) throw new Error('checkpoint file hash or Git blob changed: ' + rel); }
  if (session.status === 'submitted' && session.receipt_path) {
    const receipt = readRecord(path.resolve(repoRoot, session.receipt_path));
    const expectedPaths = fileManifest.map(item => canonicalFile(item.path)).sort(); const submittedPaths = [...(receipt?.changed_paths || [])].map(canonicalFile).sort();
    if (receipt?.source_head !== fixedSource || JSON.stringify(expectedPaths) !== JSON.stringify(submittedPaths)) throw new Error('submitted receipt paths differ from the node delivery manifest');
  }
  if (plan.nodes.some(node => node.status !== 'ready-for-delivery')) throw new Error('all plan nodes must be ready-for-delivery before checkpoint publication');
  if (runGit(worktree, ['rev-parse', 'HEAD']).stdout.trim() !== fixedSource) throw new Error('worker source SHA changed after node checkpoint');
  if (statusPaths(worktree).length) throw new Error('worker checkpoint must be clean before leader integration');
  const publication = JSON.parse(fs.readFileSync(path.join(worktree, '00_project/config/publish-policy.json'), 'utf8'));
  const lock = acquireProjectLock(repoRoot, 'leader-delivery');
  try {
    record ||= { schema_version: 1, record_type: 'plan-node-delivery', plan_id: plan.plan.plan_id, task_id: plan.plan.task_id || plan.plan.plan_id, node_ids: ids, session_id: sessionId, source_branch: session.branch, source_commit: fixedSource, source_files: fileManifest, plan_file: plan.relative, prepared_at: new Date().toISOString(), status: 'pending-integration', attempts: [] };
    writeRecord(recordFile, record);
    const leader = mainCheckout(repoRoot, publication);
    if (leader.status !== 'ready') { record.status = leader.status; record.last_error = leader; record.updated_at = new Date().toISOString(); writeRecord(recordFile, record); return { ...leader, outbox: recordFile }; }
    let currentSession = readSession(repoRoot, sessionId);
    if (currentSession.status === 'active') submitSession({ root: repoRoot, sessionId });
    currentSession = readSession(repoRoot, sessionId);
    if (currentSession.status === 'submitted') {
      const receipt = readRecord(path.resolve(repoRoot, currentSession.receipt_path));
      if (!receipt || receipt.source_head !== fixedSource) throw new Error('submitted receipt does not match the fixed worker source SHA');
      const expectedPaths = record.source_files.map(item => canonicalFile(item.path)).sort(); const submittedPaths = [...(receipt.changed_paths || [])].map(canonicalFile).sort();
      if (JSON.stringify(expectedPaths) !== JSON.stringify(submittedPaths)) throw new Error('submitted receipt paths differ from the node delivery manifest');
      record.submission_receipt = { path: currentSession.receipt_path, source_head: receipt.source_head, changed_paths: submittedPaths };
      record.updated_at = new Date().toISOString(); writeRecord(recordFile, record);
    }
    if (currentSession.status !== 'integrated' && !record.integration_head) {
      const result = integratePrepared({ root: repoRoot, sessionId });
      if (result.status !== 'integrated') { record.status = result.status; record.last_error = result; record.updated_at = new Date().toISOString(); writeRecord(recordFile, record); return { ...result, outbox: recordFile }; }
      record.integration_head = result.target_head; record.integration_source = result.source_head;
    } else if (currentSession.status === 'integrated') {
      record.integration_head ||= currentSession.integrated_head;
      record.integration_source ||= fixedSource;
    }
    const mainHead = runGit(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
    if (!isAncestor(repoRoot, fixedSource, mainHead)) throw new Error('worker source SHA is not an ancestor of integrated main');
    for (const item of record.source_files) { const sourceBlob = runGit(worktree, ['rev-parse', fixedSource + ':' + item.path], { allowFailure: true }); const mainBlob = runGit(repoRoot, ['rev-parse', record.integration_head + ':' + item.path], { allowFailure: true }); const sourceSha = sourceBlob.status === 0 ? sourceBlob.stdout.trim() : null; const mainSha = mainBlob.status === 0 ? mainBlob.stdout.trim() : null; if (sourceSha !== item.blob_sha || mainSha !== item.blob_sha) throw new Error('integrated main Git blob differs from the checkpoint manifest: ' + item.path); }
    if (!record.tested_head || record.tested_head !== mainHead) {
      const validation = runNodeValidation(repoRoot, plan.nodes.find(node => node.id === ids.at(-1)));
      record.validation = validation; record.tested_head = mainHead; record.updated_at = new Date().toISOString();
      if (!validation.passed) { record.status = 'pending-validation'; writeRecord(recordFile, record); return { status: record.status, outbox: recordFile, validation }; }
    }
    let pushed = false;
    // ponytail: two bounded remote-advance retries; later retries resume from this outbox.
    for (let attempt = 0; attempt < 2; attempt++) {
      const head = runGit(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
      const remoteLine = runGit(repoRoot, ['ls-remote', publication.remote, 'refs/heads/' + publication.branch]).stdout.trim();
      const remoteHead = remoteLine.split(/\s+/)[0];
      if (remoteHead === head) { pushed = true; record.remote_head = remoteHead; break; }
      const result = runGit(repoRoot, ['push', publication.remote, 'HEAD:' + publication.branch], { timeout: 120000, allowFailure: true });
      if (result.status === 0) {
        const verified = runGit(repoRoot, ['ls-remote', publication.remote, 'refs/heads/' + publication.branch]).stdout.trim().split(/\s+/)[0];
        if (verified === head) { pushed = true; record.remote_head = verified; record.updated_at = new Date().toISOString(); break; }
      }
      const advanced = mainCheckout(repoRoot, publication);
      if (advanced.status !== 'ready') { record.status = advanced.status; record.last_error = advanced; writeRecord(recordFile, record); return { ...advanced, outbox: recordFile }; }
      const retest = runNodeValidation(repoRoot, plan.nodes.find(node => node.id === ids.at(-1)));
      record.validation = retest; record.tested_head = runGit(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();
      if (!retest.passed) { record.status = 'pending-validation'; writeRecord(recordFile, record); return { status: record.status, outbox: recordFile, validation: retest }; }
    }
    if (!pushed) { record.status = 'pending-main-push'; record.updated_at = new Date().toISOString(); writeRecord(recordFile, record); return { status: record.status, outbox: recordFile }; }
    const remoteHead = runGit(repoRoot, ['ls-remote', publication.remote, 'refs/heads/' + publication.branch]).stdout.trim().split(/\s+/)[0];
    if (!remoteHead || !isAncestor(repoRoot, fixedSource, remoteHead)) throw new Error('remote main does not contain the fixed worker source SHA');
    record.remote_head = remoteHead; record.status = 'syncing-drive'; record.updated_at = new Date().toISOString(); writeRecord(recordFile, record);
    const mirror = syncNodeDrive(repoRoot, driveRoot);
    if (mirror.status !== 'mapped-drive-verified') { record.status = 'pending-drive'; record.drive = mirror; record.updated_at = new Date().toISOString(); writeRecord(recordFile, record); return { status: record.status, outbox: recordFile, drive: mirror }; }
    const planDriveEntry = mirror.files.find(file => file.path === plan.relative);
    if (!planDriveEntry) throw new Error('Drive mirror omitted the plan document');
    record.status = 'awaiting-cloud-readback'; record.delivery_commit = record.integration_head; record.mirror_commit = mirror.source_commit;
    record.drive_root = mirror.root; record.drive_manifest_path = mirror.manifest_path; record.drive_manifest_sha256 = mirror.manifest_sha256;
    record.drive_plan_sha256 = planDriveEntry.sha256; record.drive_file_count = mirror.file_count; record.drive_total_bytes = mirror.total_bytes;
    record.tags ||= Object.fromEntries(ids.map(id => [id, taskTagName({ root: repoRoot, task: record.task_id, node: id, commit: record.delivery_commit })]));
    record.updated_at = new Date().toISOString(); writeRecord(recordFile, record);
    return { status: record.status, outbox: recordFile, source_commit: record.source_commit, delivery_commit: record.delivery_commit, remote_head: record.remote_head, drive_manifest_sha256: record.drive_manifest_sha256, tag_names: record.tags };
  } finally { releaseProjectLock(lock); }
}

export function finalizePlanNodeDelivery({ root, sessionId, nodeIds, nodeId, planFile, cloudReadback, driveRoot, finalNode = false } = {}, { tagPublisher = createTaskTag } = {}) {
  const repoRoot = canonicalRoot(path.resolve(root)); const ids = [...new Set((nodeIds || (nodeId ? [nodeId] : [])).map(String))].sort();
  if (!ids.length) throw new Error('node finalization requires at least one plan node');
  const session = readSession(repoRoot, sessionId); const plan = planAndNodes(session.worktree_path, planFile, ids);
  if (plan.nodes.every(node => node.status === 'delivered')) return { status: 'node-delivered-idempotent', outbox: null };
  const sourceCommit = cloudReadback?.source_commit; if (!sourceCommit) throw new Error('cloud readback must carry the fixed source commit');
  const recordFile = nodeRecordPath(repoRoot, plan.plan.plan_id, ids, sourceCommit); const record = readRecord(recordFile);
  if (!record || record.session_id !== sessionId) throw new Error('plan node delivery outbox is missing');
  if (record.status === 'delivered') return { status: 'node-delivered-idempotent', outbox: recordFile, delivery_commit: record.delivery_commit, receipt_commit: record.plan_receipt_commit, tags: record.tags_verified };
  if (!['awaiting-cloud-readback','pending-tag-receipt','pending-plan-receipt-push','pending-drive-receipt'].includes(record.status)) throw new Error('node is not ready for tag finalization: ' + record.status);
  if (!cloudReadback || cloudReadback.status !== 'verified' || cloudReadback.delivery_commit !== record.delivery_commit || cloudReadback.manifest_sha256 !== record.drive_manifest_sha256 || cloudReadback.plan_sha256 !== record.drive_plan_sha256 || cloudReadback.remote_head !== record.remote_head || cloudReadback.drive_root !== record.drive_root) throw new Error('Drive cloud readback does not match the fixed node commit, remote main and manifest hashes');
  const cleanupDisposition = ids.includes('N3') ? buildCleanupDispositionReceipt(plan.plan, cloudReadback) : null;
  const manifest = JSON.parse(fs.readFileSync(record.drive_manifest_path, 'utf8'));
  if (sha256File(record.drive_manifest_path) !== record.drive_manifest_sha256 || manifest.drive_root !== record.drive_root) throw new Error('local Drive manifest changed after readback');
  const lock = acquireProjectLock(repoRoot, 'leader-delivery');
  try {
    const publication = JSON.parse(fs.readFileSync(path.join(repoRoot, '00_project/config/publish-policy.json'), 'utf8'));
    const leader = mainCheckout(repoRoot, publication);
    if (leader.status !== 'ready') { record.status = leader.status; record.last_error = leader; writeRecord(recordFile, record); return { ...leader, outbox: recordFile }; }
    const currentHead = runGit(repoRoot, ['rev-parse','HEAD']).stdout.trim();
    if (!record.plan_receipt_commit && currentHead !== record.mirror_commit) {
      record.status = 'pending-revalidation'; record.last_error = 'main advanced after Drive readback; rerun post-integration tests and mirror before tagging'; writeRecord(recordFile, record);
      return { status: record.status, outbox: recordFile };
    }
    const tagResults = record.tags_verified || {};
    if (!record.plan_receipt_commit) {
      for (const id of ids) {
        const node = plan.plan.nodes.find(item => item.id === id);
        tagResults[id] = tagPublisher({ root: repoRoot, task: record.task_id, node: id, commit: record.delivery_commit, tag: record.tags[id], message: node.summary || ('交付计划节点 ' + id), validation: (node.validation?.test_files || []).concat(node.validation?.full_test_suite ? ['完整项目测试'] : []), evidence: [record.plan_file, recordFile], drivePath: record.drive_root });
        record.tags_verified = tagResults; record.status = 'pending-tag-receipt'; record.updated_at = new Date().toISOString(); writeRecord(recordFile, record);
      }
      const planLocation = nodePath(repoRoot, record.plan_file); const mainPlan = JSON.parse(fs.readFileSync(planLocation.absolute, 'utf8'));
      const mainCleanupDisposition = ids.includes('N3') ? buildCleanupDispositionReceipt(mainPlan, cloudReadback) : null;
      if (JSON.stringify(cleanupDisposition) !== JSON.stringify(mainCleanupDisposition)) throw new Error('main and source plan disagree on historical cleanup receipts');
      let cleanupReceiptRelative = null; let cleanupReceiptSha256 = null;
      for (const id of ids) {
        const node = mainPlan.nodes.find(item => item.id === id);
        if (!node) throw new Error('plan node disappeared from main: ' + id);
        node.status = 'delivered'; node.source_commit ||= record.source_commit; node.delivery_commit = record.delivery_commit; node.tag = record.tags[id];
        node.remote_verified = true; node.remote_head = record.remote_head; node.drive_verified = true;
        node.drive_manifest_sha256 = record.drive_manifest_sha256; node.drive_plan_sha256 = record.drive_plan_sha256; node.delivered_at = new Date().toISOString();
        const { cleanup_disposition: _cleanup, ...cloudEvidence } = cloudReadback;
        node.evidence = { outbox: path.relative(repoRoot, recordFile).replaceAll('\\', '/'), validation: record.validation, cloud_readback: cloudEvidence, ...(cleanupDisposition ? { cleanup_disposition_receipt: { status:'verified', path:cleanupReceiptRelative, sha256:cleanupReceiptSha256 } } : {}) };
      }
      const phaseMap = { N1: ['P0','P3','P4'], N2: ['P1','P2'], N3: ['P5'] };
      for (const id of ids) for (const phaseId of phaseMap[id] || []) { const phase = mainPlan.phases.find(item => item.id === phaseId); if (phase) phase.status = 'completed'; }
      const nextNode = mainPlan.nodes.find(item => item.status !== 'delivered');
      mainPlan.current_phase = nextNode ? phaseMap[nextNode.id]?.[0] || mainPlan.current_phase : 'P5';
      const resolvedFindings = new Set(Array.isArray(cloudReadback.resolved_findings) ? cloudReadback.resolved_findings : []);
      if (resolvedFindings.size) mainPlan.open_findings = (mainPlan.open_findings || []).filter(item => !resolvedFindings.has(item));
      if (Array.isArray(cloudReadback.remaining_findings)) mainPlan.open_findings = [...new Set([...(mainPlan.open_findings || []), ...cloudReadback.remaining_findings])];
      mainPlan.next_action = cloudReadback.next_action || (nextNode ? 'Prepare ' + nextNode.id + ' from the integrated main baseline.' : 'Complete final P5 evidence and safe cleanup.');
      mainPlan.checkpoint.completed_requirements = [...new Set([...(mainPlan.checkpoint.completed_requirements || []), ...ids.map(id => 'Delivered ' + id + ' after main, Gitee, Drive and annotated t-tag verification.')])];
      mainPlan.checkpoint.next_action = mainPlan.next_action; mainPlan.updated_at = new Date().toISOString();
      const receiptFiles = [planLocation.relative];
      if (cleanupDisposition) {
        const slug = plan.plan.plan_id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        cleanupReceiptRelative = `00_project/traceability/supersession-cleanup-disposition-${slug}.json`;
        const cleanupFile = path.join(repoRoot, ...cleanupReceiptRelative.split('/'));
        const cleanupText = JSON.stringify(cleanupDisposition, null, 2) + '\n';
        if (fs.existsSync(cleanupFile)) {
          if (fs.readFileSync(cleanupFile, 'utf8') !== cleanupText) throw new Error('cleanup disposition receipt path already contains different content');
        } else {
          const temp = `${cleanupFile}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(temp, cleanupText); fs.renameSync(temp, cleanupFile);
        }
        cleanupReceiptSha256 = sha256File(cleanupFile);
        const n3 = mainPlan.nodes.find(item => item.id === 'N3');
        n3.evidence.cleanup_disposition_receipt = { status:'verified', path:cleanupReceiptRelative, sha256:cleanupReceiptSha256 };
        receiptFiles.push(cleanupReceiptRelative);
        mainPlan.checkpoint.completed_requirements = [...new Set([...mainPlan.checkpoint.completed_requirements, 'Historical worker branches and worktrees were removed through the fixed-SHA, Gitee/Drive-verified supersession gate; disposition receipt ' + cleanupReceiptRelative + '.'])];
      }
      mainPlan.checkpoint.next_action = mainPlan.next_action; mainPlan.updated_at = new Date().toISOString();
      fs.writeFileSync(planLocation.absolute, JSON.stringify(mainPlan, null, 2) + '\n');
      runGit(repoRoot, ['add','--',...receiptFiles]);
      runGit(repoRoot, ['-c','user.name=' + publication.author.name,'-c','user.email=' + publication.author.email,'commit','--only','-m','chore: record delivered plan node ' + ids.join('+'),'--',...receiptFiles]);
      record.plan_receipt_commit = runGit(repoRoot, ['rev-parse','HEAD']).stdout.trim(); record.status = 'pending-plan-receipt-push'; record.updated_at = new Date().toISOString(); writeRecord(recordFile, record);
    }
    const receiptHead = runGit(repoRoot, ['rev-parse','HEAD']).stdout.trim();
    if (!isAncestor(repoRoot, record.plan_receipt_commit, receiptHead)) throw new Error('plan receipt commit is no longer an ancestor of main');
    const testNode = plan.plan.nodes.find(item => item.id === ids.at(-1));
    const testHead = record.plan_receipt_tested_head || null;
    if (receiptHead !== testHead) {
      const validation = runNodeValidation(repoRoot, testNode); record.plan_receipt_validation = validation; record.plan_receipt_tested_head = receiptHead;
      if (!validation.passed) { record.status = 'pending-validation'; writeRecord(recordFile, record); return { status: record.status, outbox: recordFile, validation }; }
    }
    const remoteLine = runGit(repoRoot, ['ls-remote', publication.remote, 'refs/heads/' + publication.branch]).stdout.trim();
    const beforePush = remoteLine.split(/\s+/)[0];
    if (beforePush !== receiptHead) {
      const pushed = runGit(repoRoot, ['push', publication.remote, 'HEAD:' + publication.branch], { timeout: 120000, allowFailure: true });
      if (pushed.status !== 0) { record.status = 'pending-plan-receipt-push'; record.last_error = (pushed.stderr || pushed.stdout).trim(); writeRecord(recordFile, record); return { status: record.status, outbox: recordFile, receipt_commit: record.plan_receipt_commit }; }
    }
    const remote = runGit(repoRoot, ['ls-remote', publication.remote, 'refs/heads/' + publication.branch]).stdout.trim().split(/\s+/)[0];
    if (remote !== receiptHead) { record.status = 'pending-plan-receipt-push'; record.last_error = 'remote main advanced; retry through the leader integration gate'; writeRecord(recordFile, record); return { status: record.status, outbox: recordFile, receipt_commit: record.plan_receipt_commit, remote_head: remote }; }
    const mirror = syncNodeDrive(repoRoot, driveRoot || record.drive_root);
    if (mirror.status !== 'mapped-drive-verified') { record.status = 'pending-drive-receipt'; record.drive_receipt = mirror; writeRecord(recordFile, record); return { status: record.status, outbox: recordFile, receipt_commit: record.plan_receipt_commit, drive: mirror }; }
    record.receipt_drive_manifest_sha256 = mirror.manifest_sha256; record.receipt_drive_commit = mirror.source_commit;
    record.status = 'delivered'; record.updated_at = new Date().toISOString(); writeRecord(recordFile, record);
    const mainPlan = JSON.parse(fs.readFileSync(nodePath(repoRoot, record.plan_file).absolute, 'utf8'));
    const allDelivered = mainPlan.nodes.every(item => item.status === 'delivered');
    const lifecycle = allDelivered || finalNode
      ? { status: 'closed', session: closeSession({ root: repoRoot, sessionId, token: session.owner_token, cleanup: true }) }
      : { status: 'continued', session: continueAfterIntegration({ root: repoRoot, sessionId, reason: 'plan node(s) ' + ids.join('+') + ' delivered; continue from main ' + record.plan_receipt_commit }) };
    return { status: 'delivered', outbox: recordFile, source_commit: record.source_commit, delivery_commit: record.delivery_commit, receipt_commit: record.plan_receipt_commit, tags: tagResults, remote_main: remote, drive_manifest_sha256: mirror.manifest_sha256, lifecycle };
  } finally { releaseProjectLock(lock); }
}
