import fs from 'node:fs';
import path from 'node:path';

export function readLegacyDecision(root) {
  const file = path.join(root, '00_project/decisions/legacy-source-change-decision.json');
  if (!fs.existsSync(file)) return null;
  const decision = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!decision.decision_id || !decision.decision) throw new Error('Invalid legacy version decision');
  return decision;
}

export function retainsMigratedBaseline(decision) {
  return decision?.decision === 'keep-original-migrated-version'
    && decision.overall_migration_status === 'awaiting-legacy-phase-completion';
}

export function requireLegacyPhaseComplete(root, operation) {
  const decision = readLegacyDecision(root);
  if (retainsMigratedBaseline(decision)) {
    console.log(JSON.stringify({ operation, status: decision.overall_migration_status,
      decision_id: decision.decision_id, changed_files: 0,
      message: 'The user retained the migrated baseline. Incremental migration and regeneration are paused until the legacy phase is confirmed complete.' }, null, 2));
    process.exit(2);
  }
}
