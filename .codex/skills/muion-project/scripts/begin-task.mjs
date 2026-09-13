import fs from 'node:fs';
import path from 'node:path';
import { projectRootFromHere, runGit, gitStatusEntries, nowIso, parseArgs } from './project-utils.mjs';
import { syncExternalLibraries } from './external-lib-sync.mjs';
import { beginSession } from '../../team/scripts/session-concurrency.mjs';
const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || args._[0] || projectRootFromHere());
const explicitSession = args.session_id || args.mode || args.owned_path || args.task_id;
if (explicitSession) {
  const session = beginSession({ root, sessionId: args.session_id, taskId: args.task_id, mode: args.mode || 'worktree', ownedPaths: args.owned_path || [], reads: args.read || [] });
  console.log(JSON.stringify({ session, baseline: path.join(root, session.baseline_path) }, null, 2));
  process.exit(0);
}
const file = path.join(root, '00_project/state/task-baseline.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
const beforeSyncPaths = gitStatusEntries(root).map((entry) => entry.path).filter(Boolean);
let externalLibrarySync = null;
try {
  externalLibrarySync = syncExternalLibraries({ projectRoot: root, event: 'task-begin', allowPending: true });
} catch (error) {
  externalLibrarySync = error.result || { status: 'pending-drive', error: error.message };
}
// External-library files use their own path-scoped delivery workflow. Keep them
// out of the generic baseline so a first registration remains task-owned even
// when Drive is temporarily unavailable.
const paths = beforeSyncPaths.filter((item) => !item.startsWith('06_external_lib/') && !item.startsWith('00_project/traceability/external-libraries/'));
const session = beginSession({ root, mode: 'shared-write', taskId: 'legacy-task', allowDirtyShared: true });
const head = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
const baseline = { schema_version: 2, session_id: session.session_id, baseline_path: session.baseline_path, started_at: nowIso(), head, paths, external_library_sync: externalLibrarySync };
fs.writeFileSync(file, JSON.stringify(baseline, null, 2) + '\n');
console.log(JSON.stringify({ baseline: file, private_baseline: path.join(root, session.baseline_path), session_id: session.session_id, token: session.owner_token, head, paths, external_library_sync: externalLibrarySync }, null, 2));
