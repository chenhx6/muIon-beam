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
function nodeRecordPath(root, planId, nodeIds) {
  const slug = value => String(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
  return path.join(root, '_work/current/publish-outbox/node-delivery', slug(planId) + '-' + nodeIds.map(slug).sort().join('-') + '.json');
}
function readRecord(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function writeRecord(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temp, file);
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
  const plan = planAndNodes(worktree, planFile, ids); const fixedSource = sourceHead || runGit(worktree, ['rev-parse', 'HEAD']).stdout.trim();
  const recordFile = nodeRecordPath(repoRoot, plan.plan.plan_id, ids); let record = readRecord(recordFile);
  let fileManifest = sourceFiles || record?.source_files || [];
  if (!record && !fileManifest.length && session.status === 'submitted' && session.receipt_path) {
    const receipt = readRecord(path.resolve(repoRoot, session.receipt_path));
    if (!receipt || receipt.source_head !== fixedSource || receipt.source_branch !== session.branch) throw new Error('submitted receipt does not match the fixed source SHA');
    const changed = runGit(worktree, ['diff', '--name-only', session.base_ref + '..' + fixedSource]).stdout.split(/\r?\n/).filter(Boolean);
    fileManifest = changed.map(file => { const absolute = path.resolve(worktree, file); return { path: file, sha256: fs.existsSync(absolute) ? sha256File(absolute) : null }; });
  }
  const canonicalFile = value => String(value || '').replaceAll('\\', '/').toLowerCase();
  if (record && (record.plan_id !== plan.plan.plan_id || JSON.stringify(record.node_ids) !== JSON.stringify(ids) || record.source_commit !== fixedSource || record.session_id !== sessionId || (sourceFiles && JSON.stringify(sourceFiles) !== JSON.stringify(record.source_files)))) throw new Error('delivery retry does not match its fixed plan, node, source SHA, file list and session');
  if (!record && !fileManifest.length) throw new Error('first node delivery requires the exact checkpoint path/hash list');
  for (const item of fileManifest) { const rel = String(item.path || '').replaceAll('\\', '/'); const abs = path.resolve(worktree, rel); const within = path.relative(worktree, abs); if (!rel || rel.startsWith('/') || path.isAbsolute(within) || within === '..' || within.startsWith('..' + path.sep)) throw new Error('checkpoint manifest path escapes the worker: ' + rel); const actual = fs.existsSync(abs) ? sha256File(abs) : null; if (actual !== item.sha256) throw new Error('checkpoint file hash changed: ' + rel); }
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
      const expectedPaths = record.source_files.map(item => item.path).sort(); const submittedPaths = [...(receipt.changed_paths || [])].sort();
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
    for (const item of record.source_files) { const target = path.resolve(repoRoot, item.path); const actual = fs.existsSync(target) ? sha256File(target) : null; if (actual !== item.sha256) throw new Error('integrated main file differs from the checkpoint manifest: ' + item.path); }
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
  const recordFile = nodeRecordPath(repoRoot, plan.plan.plan_id, ids); const record = readRecord(recordFile);
  if (!record || record.session_id !== sessionId) throw new Error('plan node delivery outbox is missing');
  if (record.status === 'delivered') return { status: 'node-delivered-idempotent', outbox: recordFile, delivery_commit: record.delivery_commit, receipt_commit: record.plan_receipt_commit, tags: record.tags_verified };
  if (!['awaiting-cloud-readback','pending-tag-receipt','pending-plan-receipt-push','pending-drive-receipt'].includes(record.status)) throw new Error('node is not ready for tag finalization: ' + record.status);
  if (!cloudReadback || cloudReadback.status !== 'verified' || cloudReadback.delivery_commit !== record.delivery_commit || cloudReadback.manifest_sha256 !== record.drive_manifest_sha256 || cloudReadback.plan_sha256 !== record.drive_plan_sha256 || cloudReadback.remote_head !== record.remote_head || cloudReadback.drive_root !== record.drive_root) throw new Error('Drive cloud readback does not match the fixed node commit, remote main and manifest hashes');
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
      for (const id of ids) {
        const node = mainPlan.nodes.find(item => item.id === id);
        if (!node) throw new Error('plan node disappeared from main: ' + id);
        node.status = 'delivered'; node.source_commit ||= record.source_commit; node.delivery_commit = record.delivery_commit; node.tag = record.tags[id];
        node.remote_verified = true; node.remote_head = record.remote_head; node.drive_verified = true;
        node.drive_manifest_sha256 = record.drive_manifest_sha256; node.drive_plan_sha256 = record.drive_plan_sha256; node.delivered_at = new Date().toISOString();
        node.evidence = { outbox: path.relative(repoRoot, recordFile).replaceAll('\\', '/'), validation: record.validation, cloud_readback: cloudReadback };
      }
      const phaseMap = { N1: ['P0','P3','P4'], N2: ['P1','P2'], N3: ['P5'] };
      for (const id of ids) for (const phaseId of phaseMap[id] || []) { const phase = mainPlan.phases.find(item => item.id === phaseId); if (phase) phase.status = 'completed'; }
      const nextNode = mainPlan.nodes.find(item => item.status !== 'delivered');
      mainPlan.current_phase = nextNode ? phaseMap[nextNode.id]?.[0] || mainPlan.current_phase : 'P5';
      mainPlan.next_action = nextNode ? 'Prepare ' + nextNode.id + ' from the integrated main baseline.' : 'Complete final P5 evidence and safe cleanup.';
      mainPlan.checkpoint.completed_requirements = [...new Set([...(mainPlan.checkpoint.completed_requirements || []), ...ids.map(id => 'Delivered ' + id + ' after main, Gitee, Drive and annotated t-tag verification.')])];
      mainPlan.checkpoint.next_action = mainPlan.next_action; mainPlan.updated_at = new Date().toISOString();
      fs.writeFileSync(planLocation.absolute, JSON.stringify(mainPlan, null, 2) + '\n');
      runGit(repoRoot, ['add','--',planLocation.relative]);
      runGit(repoRoot, ['-c','user.name=' + publication.author.name,'-c','user.email=' + publication.author.email,'commit','--only','-m','chore: record delivered plan node ' + ids.join('+'),'--',planLocation.relative]);
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
