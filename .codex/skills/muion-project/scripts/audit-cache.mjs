import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, projectRootFromHere, jsonRead, jsonWrite, isPathInside, nowIso } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.project_root || projectRootFromHere());
const indexPath = path.resolve(args.index || path.join(root, '_work/cache/cache-index.json'));
if (!fs.existsSync(indexPath)) throw new Error(`cache index not found: ${indexPath}; run index-cache.mjs first`);
const index = jsonRead(indexPath);
const thresholdDays = Number(args.days || 14);
const cutoff = Date.now() - thresholdDays * 86400000;
const candidates = [];
for (const item of index.entries || []) {
  const absolute = path.resolve(root, item.cache_path);
  const stale = item.last_used_at ? Date.parse(item.last_used_at) < cutoff : false;
  const safe = isPathInside(absolute, path.join(root, '_work/cache')) && item.rebuildable && !item.locked && item.retention_level !== 'P0' && item.retention_level !== 'P1';
  if (safe && stale) candidates.push({ ...item, absolute_path: absolute, reason: `unused-more-than-${thresholdDays}-days` });
}
const reportPath = path.join(root, '_work/cleanup-candidates/cache-audit-report.json');
jsonWrite(reportPath, { generated_at: nowIso(), threshold_days: thresholdDays, candidates, deleted: [], deletion_enabled: Boolean(args.delete_p3) });
if (args.delete_p3) {
  for (const item of candidates.filter((candidate) => candidate.retention_level === 'P3')) {
    if (isPathInside(item.absolute_path, path.join(root, '_work/cache')) && fs.existsSync(item.absolute_path)) fs.rmSync(item.absolute_path, { force: true });
  }
}
console.log(JSON.stringify({ report: reportPath, candidates: candidates.length, deleted: args.delete_p3 ? candidates.filter((item) => item.retention_level === 'P3').length : 0 }, null, 2));
