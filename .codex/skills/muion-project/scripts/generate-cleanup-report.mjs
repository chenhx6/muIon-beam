import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const work = path.join(root, '_work');
const output = path.join(work, 'cleanup-candidates', 'cleanup-report.md');
const records = [];
function walk(dir, category) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, category);
    else if (entry.name !== 'README.md') {
      const stat = fs.statSync(full);
      records.push({ path: path.relative(root, full).replaceAll('\\', '/'), category, size: stat.size, modified: stat.mtime.toISOString() });
    }
  }
}
walk(path.join(work, 'cache'), 'P2-cache');
walk(path.join(work, 'temporary-output'), 'P3-temporary');
walk(path.join(work, 'scratch'), 'P2-scratch');
const lines = ['# Cleanup candidates', '', '> This is a report only. No files were deleted.', '', '| Category | Path | Size (bytes) | Modified |', '|---|---|---:|---|', ...records.map((r) => `| ${r.category} | ${r.path} | ${r.size} | ${r.modified} |`), ''];
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, lines.join('\n'), 'utf8');
console.log(JSON.stringify({ output, candidates: records.length, deleted: 0 }, null, 2));
