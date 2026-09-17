import fs from 'node:fs';
import path from 'node:path';
import { projectRootFromHere, runGit, gitStatusEntries, sha256File } from './project-utils.mjs';
import { evaluateDeliveryPath } from './delivery-path-policy.mjs';

export function loadDeliveryPolicy(root) { return JSON.parse(fs.readFileSync(path.join(root, '00_project/config/delivery-policy.json'), 'utf8')); }
function expand(root, file) {
  const target = path.join(root, file);
  try {
    if (!fs.lstatSync(target).isDirectory()) return [file];
    const result = [];
    const visit = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else result.push(path.relative(root, full).replaceAll('\\', '/'));
      }
    };
    visit(target); return result;
  } catch { return [file]; }
}

export function classifyPaths(root, policy = loadDeliveryPolicy(root), baseline = null, ownedPaths = null) {
  const entries = gitStatusEntries(root);
  const ownedValues = ownedPaths == null ? [] : Array.isArray(ownedPaths) ? ownedPaths : ownedPaths.paths || [];
  const owned = ownedPaths ? new Set(ownedValues.flatMap((value) => [String(value), String(value).toLowerCase()])) : null;
  const paths = entries.flatMap((entry) => [...expand(root, entry.path).map((file) => ({ file, deleted: entry.status.includes('D') })), ...(entry.status.includes('R') && entry.old_path ? [{ file: entry.old_path, deleted: true }] : [])]).filter((item) => item.file && (!owned || owned.has(item.file) || owned.has(item.file.toLowerCase())));
  const baselinePaths = new Set(baseline?.paths || []);
  const candidates = []; const adopted = []; const excluded = []; let totalBytes = 0;
  for (const entry of paths) {
    const file = entry.file;
    const preexisting = [...baselinePaths].some((entry) => file.toLowerCase() === entry.toLowerCase() || (entry.endsWith('/') && file.toLowerCase().startsWith(entry.toLowerCase())));
    const eligibility = evaluateDeliveryPath(file, policy.gitee);
    const managed = file.startsWith('00_project/traceability/external-libraries/');
    const retainedExternalDeletion = entry.deleted && file.startsWith('06_external_lib/');
    let size = 0; let contentError = null;
    if (!entry.deleted) {
      try {
        const absolute = path.join(root, file); const stat = fs.lstatSync(absolute);
        size = stat.size;
        if (!stat.isFile() || stat.isSymbolicLink()) contentError = 'not-a-regular-file';
        else if (eligibility.text_required && size <= policy.gitee.max_file_bytes) {
          const bytes = fs.readFileSync(absolute);
          if (bytes.includes(0)) contentError = 'model-source-is-binary';
          else { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { contentError = 'model-source-not-utf8'; } }
        }
      } catch { contentError = 'file-unreadable'; }
    }
    const oversized = size > policy.gitee.max_file_bytes || totalBytes + size > policy.gitee.max_task_bytes;
    if (!preexisting && !managed && !retainedExternalDeletion && eligibility.allowed && !oversized && !contentError) { candidates.push(file); totalBytes += size; }
    else excluded.push({ path: file, reason: preexisting ? 'preexisting-user-change' : managed ? 'managed-by-external-library-workflow' : retainedExternalDeletion ? 'external-library-deletion-retained' : !eligibility.allowed ? eligibility.reason : oversized ? 'gitee-size-limit' : contentError, size });
  }
  return { gitee: candidates.length ? 'commit' : 'none', drive: candidates.length ? 'project' : 'none', candidates, adopted, excluded, total_bytes: totalBytes };
}

export function digestFiles(root, files) { return files.map((file) => ({ path: file, sha256: fs.existsSync(path.join(root, file)) ? sha256File(path.join(root, file)) : null })); }

if (process.argv[1] && path.basename(process.argv[1]) === 'delivery-plan.mjs') console.log(JSON.stringify(classifyPaths(path.resolve(process.argv[2] || projectRootFromHere())), null, 2));
