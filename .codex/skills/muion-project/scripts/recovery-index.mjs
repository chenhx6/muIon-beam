import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, runGit, jsonWrite, nowIso } from './project-utils.mjs';
import { listSessions } from '../../team/scripts/session-concurrency.mjs';

const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
const listJson = directory => fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => path.join(directory, name)).sort() : [];

export function buildRecoveryIndex(root, { driveRoot, git = args => runGit(root, args).stdout.trim(), now = nowIso() } = {}) {
  const projectRoot = path.resolve(root); const archiveRoot = path.resolve(driveRoot || 'H:\\我的云端硬盘\\muIon_archive');
  const latestCommit = git(['rev-parse', 'HEAD']); const remoteCommit = git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] || null;
  const snapshotDir = path.join(projectRoot, '00_project/traceability/project-snapshots');
  const snapshots = listJson(snapshotDir).map(file => readJson(file)).filter(item => item?.record_type === 'committed-project-snapshot').sort((a, b) => String(a.verified_at).localeCompare(String(b.verified_at)));
  const cloudAudits = listJson(snapshotDir).map(file => readJson(file)).filter(item => item?.record_type === 'snapshot-cloud-audit').sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
  const plan = readJson(path.join(projectRoot, '10_plans/active/20260916_project_supervisor_auto_recovery/plan_index.json'), {});
  const incidents = listJson(path.join(projectRoot, '00_project/traceability/incidents')).map(file => readJson(file)).filter(Boolean);
  const experiences = listJson(path.join(projectRoot, '00_project/traceability/experiences')).map(file => readJson(file)).filter(item => item?.record_type === 'experience-record');
  let sessions = []; try { sessions = listSessions({ root: projectRoot }).map(item => ({ session_id: item.session_id, task_id: item.task_id, status: item.status, mode: item.mode, branch: item.branch, worktree_path: item.worktree_path, lease_until: item.lease_until })); } catch (error) { sessions = [{ status: 'unavailable', reason: error.message }]; }
  const latestSnapshot = snapshots.at(-1) || null; const latestCloudAudit = cloudAudits.at(-1) || null;
  return {
    schema_version: 1, record_type: 'project-recovery-index', generated_at: now, project: 'muIon-beam',
    gitee: { remote: 'origin', branch: 'main', local_commit: latestCommit, remote_commit: remoteCommit, verified_match: Boolean(remoteCommit && remoteCommit === latestCommit) },
    drive: { root: archiveRoot, latest_snapshot: latestSnapshot ? { snapshot_id: latestSnapshot.snapshot_id, commit: latestSnapshot.commit, path: latestSnapshot.drive_path, status: latestSnapshot.status, file_count: latestSnapshot.file_count, total_bytes: latestSnapshot.total_bytes, manifest_sha256: latestSnapshot.manifest_sha256 } : null, latest_cloud_audit: latestCloudAudit ? { snapshot_id: latestCloudAudit.snapshot_id, cloud_upload_verification: latestCloudAudit.cloud_upload_verification, conclusion: latestCloudAudit.conclusion, next_action: latestCloudAudit.next_action } : null, cleanup_allowed: false },
    workflow: { task_id: plan.task_id || null, status: plan.status || null, current_phase: plan.current_phase || null, next_action: plan.next_action || null, farmer_pause_file: '_work/current/farmer/control.json' },
    open_incidents: incidents.filter(item => item.status !== 'resolved').map(item => ({ incident_id: item.incident_id, status: item.status, severity: item.severity, unresolved: item.unresolved || [] })),
    sessions, experience_count: experiences.length,
    recovery_scope: 'Gitee commit plus verified mapped-drive snapshots; cloud visibility and old-archive cleanup require a separate verified gate'
  };
}

export function writeRecoveryIndex(root, driveRoot, options = {}) {
  const index = buildRecoveryIndex(root, { driveRoot, ...options });
  const destination = path.join(path.resolve(driveRoot), 'project', 'recovery-index', 'recovery-index.json');
  jsonWrite(destination, index); return { destination, index };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  try { if (!args.drive_root) throw new Error('--drive-root is required'); console.log(JSON.stringify(writeRecoveryIndex(args.project_root || projectRootFromHere(), args.drive_root).index, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
