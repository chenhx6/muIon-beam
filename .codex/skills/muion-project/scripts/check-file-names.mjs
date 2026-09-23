import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, '../../../..'));
const ignored = new Set(['.git', '.codex', 'node_modules', '_work', '90_migration']);
const forbidden = /(^|[-_])(latest|final2|new|revised|修正版)([-_.]|$)/i;
const timestamped = /^\d{8}_\d{4}-[a-z][a-z0-9_]*-[a-z][a-z0-9_]*-[a-z][a-z0-9_]*-v\d{2}-[a-z]{2}\.[a-z0-9]+$/;
const findings = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (forbidden.test(entry.name)) findings.push({ type: 'forbidden_token', path: path.relative(root, file) });
    else if (/^\d{8}[-_]\d{4}-/.test(entry.name) && !timestamped.test(entry.name)) findings.push({ type: 'invalid_timestamped_name', path: path.relative(root, file) });
  }
}
walk(root);
console.log(JSON.stringify({ valid: findings.length === 0, findings }, null, 2));
process.exitCode = findings.length ? 1 : 0;
