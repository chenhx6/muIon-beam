import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, '../../../..'));
const index = path.join(root, '09_catalog/catalog_index.json');
if (!fs.existsSync(index)) { console.error('catalog index is missing'); process.exit(1); }
const value = JSON.parse(fs.readFileSync(index, 'utf8')); const missing = []; const changed = [];
for (const item of value.records || []) {
  const file = path.join(root, item.path);
  if (!fs.existsSync(file)) { missing.push(item.path); continue; }
  const stat = fs.statSync(file); if (stat.size !== item.bytes) changed.push(item.path);
}
const result = { valid: missing.length === 0 && changed.length === 0, missing, changed, indexed_count: value.records?.length || 0 };
console.log(JSON.stringify(result, null, 2)); process.exitCode = result.valid ? 0 : 1;
