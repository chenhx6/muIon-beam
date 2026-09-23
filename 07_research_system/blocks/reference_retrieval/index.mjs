import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, '../../../..'));
const index = path.join(root, '08_references/catalog/reference_index.json');
if (!fs.existsSync(index)) throw new Error('reference index is missing; run npm run reference:index');
const value = JSON.parse(fs.readFileSync(index, 'utf8'));
const query = process.argv.slice(3).join(' ').trim().toLowerCase();
const results = [];
for (const item of value.records || []) {
  const metadataMatch = !query || [item.reference_id, item.original_filename, item.title, ...(item.topics || [])].join(' ').toLowerCase().includes(query);
  const evidence = [];
  if (query && item.text_path && fs.existsSync(path.join(root, item.text_path))) {
    const text = fs.readFileSync(path.join(root, item.text_path), 'utf8');
    const pages = text.split(/\r?\n\r?\n--- page (\d+) ---\r?\n\r?\n/);
    for (let index = 1; index < pages.length; index += 2) {
      const page = Number(pages[index]); const body = pages[index + 1] || ''; const at = body.toLowerCase().indexOf(query);
      if (at >= 0) evidence.push({ page, excerpt: body.slice(Math.max(0, at - 160), Math.min(body.length, at + query.length + 240)).replace(/\s+/g, ' ').trim() });
      if (evidence.length >= 5) break;
    }
  }
  if (metadataMatch || evidence.length) results.push({ ...item, metadata_match: metadataMatch, evidence });
}
console.log(JSON.stringify({ query, count: results.length, results }, null, 2));
