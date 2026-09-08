import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, ensureDirectory, sha256File, jsonRead, jsonWrite, relativePath, nowIso } from './project-utils.mjs';
import { requireLegacyPhaseComplete } from './legacy-version-policy.mjs';

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args.project_root || path.resolve(import.meta.dirname, '../../../..'));
requireLegacyPhaseComplete(projectRoot, 'legacy-migrate');
const source = path.resolve(args.source || 'D:/muIon');
const destinationRoot = path.resolve(args.destination || path.join(projectRoot, '90_migration/from-D-muIon'));
const indexPath = path.resolve(args.index || path.join(destinationRoot, 'source-index/legacy-source-index.json'));
const driveRoot = args.drive_root === false || args.skip_drive ? null : (args.drive_root ? path.resolve(args.drive_root) : 'H:\\我的云端硬盘\\muIon_archive\\legacy-from-D-muIon\\selected-migration-20260907-stage1');
const taskId = args.task_id || 'TASK-LEGACY-SMOKE-001';
const runId = args.run_id || 'RUN-LEGACY-SMOKE-001-stage1-centered';
if (!fs.existsSync(indexPath)) throw new Error(`legacy inventory not found: ${indexPath}; run index-legacy-workspace.mjs first`);
const inventory = jsonRead(indexPath);
const keyModelNames = new Set(['stage1_3d_feasibility.mph', 'stage1_solidworks_step_import_check.mph', 'centered_cooling_calibration.mph', 'centered_stage1_highfield_10_v2.mph', 'stage1_master_3d.sldprt', 'stage1_master_3d.step', 'stage1_3d_physics_geometry.step']);
const keyTableNames = new Set(['cooling_density_summary.csv', 'cooling_density_scan.csv', 'centered_transport_scan_master.csv', 'transport_scan_master.csv', 'candidate_parameter_sets.csv', 'variable_sensitivity.csv', 'centered_scan_plan.csv', 'field_summary.csv', 'field_aperture_zoom.csv', 'loss_diagnostics.csv', 'centered_loss_diagnostics.csv']);
const keyFigureNames = new Set(['source_k_theta_distribution.png', 'neon_number_density_radial_cooling_time.png', 'neon_number_density_kperp.png', 'neon_number_density_threshold_fraction.png', 'density_x_field_en.png', 'density_x_field_p90_exit_time.png', 'density_x_field_transport_rate.png', 'electric_field_strength_acceleration_time.png', 'electric_field_strength_axial_velocity.png', 'aperture_peak_field_reference.png', 'baseline_candidate_final_comparison.png', 'centered_trajectories_rz.png', 'centered_trajectories_xy.png', 'overall_e_linear.png', 'v2_aperture_e_linear.png']);
const keyLogNames = new Set(['transport_tuning.log', 'reload_validation.log', 'run_option3.log', 'run_option4.log', 'field_export.log']);

function isInSelectedProject(rel) { return rel.toLowerCase().startsWith('muion_archive/muon-ion_beam/'); }
function shouldSelect(record) {
  const rel = record.relative_path.replaceAll('\\', '/');
  const lower = rel.toLowerCase();
  if (!isInSelectedProject(rel) || record.candidate_retention_level === 'P3') return false;
  const name = record.file_name.toLowerCase();
  const ext = record.extension;
  if (keyModelNames.has(name)) return true;
  if (keyTableNames.has(name)) return true;
  if (keyFigureNames.has(name)) return true;
  if (keyLogNames.has(name)) return true;
  if (lower.includes('/reports/') && ['.md', '.txt', '.csv', '.json'].includes(ext)) return true;
  if (lower.includes('/scripts/') && ['.py', '.java', '.cs', '.ps1', '.sh', '.md'].includes(ext)) return true;
  if (lower.includes('/data/centered_source/') && ['.json', '.csv', '.txt'].includes(ext) && /(?:_10_|_2_|_500_).*nominal/.test(name)) return record.size <= 2 * 1024 * 1024;
  if (lower.includes('/muon/ne/') && ['.txt', '.csv', '.json', '.md'].includes(ext) && record.size <= 2 * 1024 * 1024) return true;
  if (lower.includes('/comsol_muon_stage1_feasibility/') && lower.includes('/reports/') && ext === '.md') return true;
  if (lower.includes('/logs/') && ext === '.log' && record.size <= 2 * 1024 * 1024) return true;
  return false;
}

function destinationFor(rel, fileName) {
  const normalized = rel.replaceAll('\\', '/');
  const lower = normalized.toLowerCase();
  const ext = path.extname(fileName).toLowerCase();
  const safeRelative = normalized.replace(/^muion_archive\/muon-ion_beam\//i, '');
  if (lower.includes('/reports/') || ext === '.md' && !lower.includes('/scripts/')) return path.join('05_reports', 'interim', 'legacy', safeRelative);
  if (['.mph'].includes(ext)) return path.join('02_models', 'comsol', 'legacy', safeRelative);
  if (['.sldasm', '.sldprt', '.slddrw', '.step', '.stp', '.x_t', '.iges', '.igs'].includes(ext)) return path.join('02_models', 'solidworks', 'legacy', safeRelative);
  if (lower.includes('/muon/ne/') || lower.includes('geant4')) return path.join('02_models', 'geant4', 'legacy', safeRelative);
  if (lower.includes('/scripts/')) return path.join('02_models', 'comsol', 'legacy-scripts', safeRelative);
  if (lower.includes('/figures/') || ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.svg'].includes(ext)) return path.join('03_runs', 'formal', runId, 'figures', 'legacy', safeRelative);
  if (lower.includes('/tables/') || lower.includes('/data/') || ['.csv', '.json'].includes(ext)) return path.join('03_runs', 'formal', runId, 'input', 'legacy', safeRelative);
  if (lower.includes('/logs/') || lower.includes('/intermediate/')) return path.join('03_runs', 'formal', runId, 'diagnostics', 'legacy', safeRelative);
  return path.join('90_migration', 'from-D-muIon', 'selected-tasks', taskId, 'legacy-files', safeRelative);
}

function copyVerified(sourceFile, destinationFile) {
  ensureDirectory(path.dirname(destinationFile));
  if (fs.existsSync(destinationFile)) {
    if (sha256File(destinationFile) !== sha256File(sourceFile)) throw new Error(`destination exists with different content: ${destinationFile}`);
    return false;
  }
  fs.copyFileSync(sourceFile, destinationFile);
  if (sha256File(destinationFile) !== sha256File(sourceFile)) throw new Error(`copy verification failed: ${destinationFile}`);
  return true;
}

const selected = inventory.files.filter(shouldSelect);
if (!selected.length) throw new Error('selection produced no files; inspect legacy inventory and selection rules');
const migrated = [];
for (const record of selected) {
  const localRelative = destinationFor(record.relative_path, record.file_name).replaceAll('\\', '/');
  const localDestination = path.join(projectRoot, localRelative);
  const copiedLocal = copyVerified(record.legacy_source_path, localDestination);
  let driveRelative = null;
  let driveDestination = null;
  let copiedDrive = false;
  let driveStatus = 'not-requested';
  if (driveRoot) {
    driveRelative = record.relative_path.replaceAll('\\', '/');
    driveDestination = path.join(driveRoot, driveRelative);
    if (fs.existsSync(path.parse(driveRoot).root)) {
      try { copiedDrive = copyVerified(record.legacy_source_path, driveDestination); driveStatus = 'verified'; } catch (error) { driveStatus = `failed: ${error.message}`; }
    } else driveStatus = 'unavailable';
  }
  migrated.push({
    legacy_file_id: record.legacy_file_id,
    legacy_source_path: record.legacy_source_path,
    legacy_source_relative_path: record.relative_path,
    legacy_source_sha256: record.sha256,
    legacy_source_size: record.size,
    retention_level: record.candidate_retention_level,
    migration_decision: 'selected',
    destination_path: localRelative,
    destination_sha256: sha256File(localDestination),
    drive_path: driveDestination,
    drive_status: driveStatus,
    copied_local: copiedLocal,
    copied_drive: copiedDrive,
    scientific_revalidation: 'not-performed'
  });
}
const migrationId = 'MIGRATION-LEGACY-20260907-STAGE1';
const manifest = {
  manifest_id: migrationId,
  manifest_type: 'migration',
  schema_version: '1.0.0',
  created_at: nowIso(),
  updated_at: nowIso(),
  source_workspace: source,
  destination_workspace: projectRoot,
  copy_only: true,
  preserve_source: true,
  task_id: taskId,
  run_id: runId,
  source_inventory: path.relative(projectRoot, indexPath).replaceAll('\\', '/'),
  drive_root: driveRoot,
  selected_count: migrated.length,
  selected_bytes: migrated.reduce((sum, item) => sum + item.legacy_source_size, 0),
  excluded_count: inventory.files.length - selected.length,
  scientific_revalidation: 'not-performed',
  files: migrated
};
const manifestPath = path.join(destinationRoot, 'migration-manifest.json');
jsonWrite(manifestPath, manifest);
const summary = ['# Legacy selected migration', '', `Migration ID: \`${migrationId}\``, `Source: \`${source}\``, `Destination: \`${projectRoot}\``, `Selected files: ${migrated.length}`, `Selected bytes: ${manifest.selected_bytes}`, `Drive root: \`${driveRoot || 'not-requested'}\``, '', '| Retention | Files | Bytes |', '|---|---:|---:|'];
for (const level of ['P0', 'P1', 'P2', 'P3']) { const group = migrated.filter((item) => item.retention_level === level); if (group.length) summary.push(`| ${level} | ${group.length} | ${group.reduce((sum, item) => sum + item.legacy_source_size, 0)} |`); }
summary.push('', 'All selected files were copied and checked against the recorded source SHA256. The legacy source was not modified. Historical results remain marked as not revalidated.');
fs.writeFileSync(path.join(destinationRoot, 'migration-summary.md'), `${summary.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ manifest: manifestPath, selected_count: migrated.length, selected_bytes: manifest.selected_bytes, drive_root: driveRoot, drive_failures: migrated.filter((item) => item.drive_status.startsWith('failed')).length }, null, 2));
