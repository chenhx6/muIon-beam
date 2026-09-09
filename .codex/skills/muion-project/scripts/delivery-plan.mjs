import fs from 'node:fs';
import path from 'node:path';
import { projectRootFromHere, runGit, sha256File } from './project-utils.mjs';

export function loadDeliveryPolicy(root) { return JSON.parse(fs.readFileSync(path.join(root, '00_project/config/delivery-policy.json'), 'utf8')); }
const starts = (file, list) => list.some((prefix) => file === prefix || file.startsWith(prefix));
function expand(root, file) {
  const target = path.join(root, file);
  try {
    if (!fs.statSync(target).isDirectory()) return [file];
    const result = [];
    const visit = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile()) result.push(path.relative(root, full).replaceAll('\\', '/'));
      }
    };
    visit(target); return result;
  } catch { return [file]; }
}

export function classifyPaths(root, policy = loadDeliveryPolicy(root), baseline = null) {
  const lines = runGit(root, ['status', '--porcelain']).stdout.split(/\r?\n/).filter(Boolean);
  const paths = lines.flatMap((line) => expand(root, line.slice(3)).map((file) => ({ file, deleted: line.slice(0, 2).includes('D') }))).filter((item) => item.file);
  const baselinePaths = new Set(baseline?.paths || []);
  const candidates = []; const adopted = []; const excluded = []; let totalBytes = 0;
  for (const entry of paths) {
    const file = entry.file;
    const preexisting = [...baselinePaths].some((entry) => file === entry || (entry.endsWith('/') && file.startsWith(entry)));
    const denied = starts(file, policy.gitee.deny_prefixes) || policy.gitee.deny_extensions.some((ext) => file.toLowerCase().endsWith(ext));
    const managed = file.startsWith('00_project/traceability/external-libraries/');
    const retainedExternalDeletion = entry.deleted && file.startsWith('06_external_lib/');
    const allowed = starts(file, policy.gitee.allow_prefixes);
    let size = 0; try { size = fs.statSync(path.join(root, file)).size; } catch {}
    const oversized = size > policy.gitee.max_file_bytes || totalBytes + size > policy.gitee.max_task_bytes;
    if (!managed && !retainedExternalDeletion && !denied && allowed && !oversized) { candidates.push(file); totalBytes += size; if (preexisting) adopted.push(file); }
    else excluded.push({ path: file, reason: managed ? 'managed-by-external-library-workflow' : retainedExternalDeletion ? 'external-library-deletion-retained' : denied ? 'protected-path-or-extension' : oversized ? 'gitee-size-limit' : 'outside-allowlist', size });
  }
  return { gitee: candidates.length ? 'commit' : 'none', drive: candidates.length ? 'project' : 'none', candidates, adopted, excluded, total_bytes: totalBytes };
}

export function digestFiles(root, files) { return files.map((file) => ({ path: file, sha256: fs.existsSync(path.join(root, file)) ? sha256File(path.join(root, file)) : null })); }

if (process.argv[1] && path.basename(process.argv[1]) === 'delivery-plan.mjs') console.log(JSON.stringify(classifyPaths(path.resolve(process.argv[2] || projectRootFromHere())), null, 2));
