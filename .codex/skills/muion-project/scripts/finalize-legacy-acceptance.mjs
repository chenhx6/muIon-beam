import path from 'node:path';
import { parseArgs, projectRootFromHere } from './project-utils.mjs';
import { readLegacyDecision, retainsMigratedBaseline } from './legacy-version-policy.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || args._[0] || projectRootFromHere());
const decision = readLegacyDecision(root);
// Never infer human acceptance or overwrite archived facts.
const status = retainsMigratedBaseline(decision) ? 'awaiting-legacy-phase-completion' : 'pending-human-acceptance';
console.log(JSON.stringify({ read_only: true, status, human_acceptance: 'pending',
  migration_complete: false, decision_id: decision?.decision_id || null,
  message: 'No acceptance or upload flags were changed. Legacy phase completion and explicit human sign-off are required.' }, null, 2));
process.exitCode = 2;
