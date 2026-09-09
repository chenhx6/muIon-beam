import fs from 'node:fs';
import path from 'node:path';
import { projectRootFromHere, runGit, nowIso } from './project-utils.mjs';
import { syncExternalLibraries } from './external-lib-sync.mjs';
const root = path.resolve(process.argv[2] || projectRootFromHere());
const file = path.join(root, '00_project/state/task-baseline.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
const beforeSyncPaths = runGit(root, ['status', '--porcelain']).stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3)).filter(Boolean);
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
const head = runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
fs.writeFileSync(file, JSON.stringify({ schema_version: 1, started_at: nowIso(), head, paths, external_library_sync: externalLibrarySync }, null, 2) + '\n');
console.log(JSON.stringify({ baseline: file, head, paths, external_library_sync: externalLibrarySync }, null, 2));
