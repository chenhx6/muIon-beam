import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, jsonRead, sha256File, projectRootFromHere, isPathInside } from './project-utils.mjs';
import { readLegacyDecision, retainsMigratedBaseline } from './legacy-version-policy.mjs';

export function verifyLegacyMigration(root, manifestPath, decision = null) {
  const manifest = jsonRead(manifestPath);
  const errors = [];
  const sourceChanges = [];
  const policyApplies = retainsMigratedBaseline(decision)
    && decision.migration_manifest
    && path.resolve(root, decision.migration_manifest).toLowerCase() === path.resolve(manifestPath).toLowerCase();
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!files.length) errors.push('migration file list is empty');
  if (manifest.copy_only !== true || manifest.preserve_source !== true) errors.push('migration must preserve the source');
  let localVerified = 0;
  let driveVerified = 0;
  let driveRequired = 0;
  let sourceReadFailures = 0;
  const digest = (file, label) => {
    try { return sha256File(file); }
    catch (error) { errors.push(label + ': ' + (error.code || error.message) + ': ' + file); return null; }
  };
  for (const item of files) {
    const expected = item.legacy_source_sha256;
    if (!/^[a-f0-9]{64}$/i.test(expected || '')) { errors.push('invalid retained SHA256: ' + item.destination_path); continue; }
    const sourceHash = digest(item.legacy_source_path, 'source unreadable');
    if (!sourceHash) sourceReadFailures += 1;
    if (sourceHash && sourceHash !== expected) {
      const named = (decision?.files || []).find((record) => record.destination_path === item.destination_path && record.retained_sha256 === expected);
      sourceChanges.push({ legacy_source_path: item.legacy_source_path, destination_path: item.destination_path,
        retained_sha256: expected, observed_source_sha256: sourceHash,
        disposition: policyApplies ? 'not-adopted' : 'requires-review',
        named_in_decision: Boolean(named), decision_id: policyApplies ? decision.decision_id : null });
      if (!policyApplies) errors.push('unreviewed source change: ' + item.legacy_source_path);
    }
    const local = path.resolve(root, item.destination_path);
    if (!isPathInside(local, root)) { errors.push('destination escapes project: ' + item.destination_path); continue; }
    const localHash = digest(local, 'retained copy unreadable');
    if (localHash === expected) localVerified += 1;
    else if (localHash) errors.push('retained copy mismatch: ' + item.destination_path);
    // Read actual copies even if an earlier attempt left stale status flags.
    if (item.drive_path) {
      driveRequired += 1;
      const driveHash = digest(item.drive_path, 'Drive copy unreadable');
      if (driveHash === expected) driveVerified += 1;
      else if (driveHash) errors.push('Drive copy mismatch: ' + item.drive_path);
    }
  }
  return { read_only: true, manifest: manifestPath, checked: files.length,
    retained_baseline_valid: errors.length === 0, valid: errors.length === 0,
    local_files_verified: localVerified, drive_files_verified: driveVerified, drive_files_requested: driveRequired,
    source_matches_migration_hash: sourceChanges.length === 0 && sourceReadFailures === 0,
    source_changes: sourceChanges, source_write_performed: false,
    overall_migration_status: policyApplies ? 'awaiting-legacy-phase-completion' : 'pending-human-acceptance',
    migration_complete: false, human_acceptance: 'pending', errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.project_root || projectRootFromHere());
  const manifestPath = path.resolve(args.manifest || path.join(root, '90_migration/from-D-muIon/migration-manifest.json'));
  const result = verifyLegacyMigration(root, manifestPath, readLegacyDecision(root));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
}
