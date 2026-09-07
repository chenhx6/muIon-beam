import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, ensureDirectory, relativePath, sha256File, csvEscape, nowIso, walkFiles } from './project-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const source = path.resolve(args.source || 'D:/muIon');
const projectRoot = path.resolve(args.project_root || path.resolve(import.meta.dirname, '../../../..'));
const outputDir = path.resolve(args.output || path.join(projectRoot, '90_migration/from-D-muIon/source-index'));
if (!fs.existsSync(source)) throw new Error(`legacy source does not exist: ${source}`);
ensureDirectory(outputDir);

const p3Extensions = new Set(['.class', '.exe', '.dll', '.obj', '.pdb', '.ilk', '.lock', '.recover', '.tmp', '.bak', '.autosave']);
const sourceExtensions = new Set(['.md', '.py', '.java', '.cs', '.yaml', '.yml', '.json', '.csv', '.txt', '.sh', '.ps1', '.cmake', '.xml', '.toml']);
const modelExtensions = new Set(['.mph', '.sldasm', '.sldprt', '.slddrw', '.step', '.stp', '.x_t', '.iges', '.igs']);
const figureExtensions = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.svg', '.pdf']);

function classify(file, rel) {
  const lower = rel.toLowerCase();
  const ext = path.extname(file).toLowerCase();
  const segments = lower.split('/');
  if (segments.some((part) => ['temporary', 'build', 'build_debug', 'cmakefiles'].includes(part)) || p3Extensions.has(ext) || /(^|[/\\])[~$]/.test(rel)) return { retention_level: 'P3', reason: 'rebuildable-or-temporary' };
  if (!lower.startsWith('muion_archive/muon-ion_beam/')) return { retention_level: 'P3', reason: 'outside-selected-project-scope' };
  if (modelExtensions.has(ext)) return { retention_level: 'P1', reason: 'model-candidate' };
  if (sourceExtensions.has(ext)) {
    if (fs.statSync(file).size <= 10 * 1024 * 1024) return { retention_level: 'P0', reason: 'readable-source-or-metadata' };
    return { retention_level: 'P2', reason: 'large-readable-intermediate' };
  }
  if (figureExtensions.has(ext)) return { retention_level: 'P2', reason: 'figure-candidate' };
  return { retention_level: 'P2', reason: 'review-required' };
}

const files = walkFiles(source, { ignoredDirectories: [] });
const records = [];
let index = 0;
for (const file of files) {
  index += 1;
  const rel = relativePath(source, file);
  const classification = classify(file, rel);
  const stat = fs.statSync(file);
  const record = {
    legacy_file_id: `LEGACY-FILE-${String(index).padStart(5, '0')}`,
    legacy_source_path: file,
    relative_path: rel,
    file_name: path.basename(file),
    extension: path.extname(file).toLowerCase(),
    size: stat.size,
    modified_at: stat.mtime.toISOString(),
    sha256: null,
    source_section: rel.split('/')[0] || '',
    candidate_retention_level: classification.retention_level,
    migration_decision: classification.retention_level === 'P3' ? 'exclude' : 'candidate',
    exclusion_reason: classification.retention_level === 'P3' ? classification.reason : null,
    selected_destination: null
  };
  // Hashing is deliberately sequential to keep memory bounded for multi-gigabyte legacy files.
  record.sha256 = sha256File(file);
  records.push(record);
  if (index % 100 === 0) process.stderr.write(`indexed ${index}/${files.length}\n`);
}

const summary = {};
for (const record of records) {
  const key = record.candidate_retention_level;
  summary[key] = summary[key] || { files: 0, bytes: 0 };
  summary[key].files += 1;
  summary[key].bytes += record.size;
}
const result = {
  inventory_id: `LEGACY-INVENTORY-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`,
  generated_at: nowIso(),
  source_workspace: source,
  selected_project_root: path.join(source, 'muIon_archive', 'muon-ion_beam'),
  copy_only: true,
  preserve_source: true,
  file_count: records.length,
  total_bytes: records.reduce((sum, item) => sum + item.size, 0),
  summary,
  files: records
};
const jsonPath = path.join(outputDir, 'legacy-source-index.json');
fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
const columns = ['legacy_file_id', 'legacy_source_path', 'relative_path', 'file_name', 'extension', 'size', 'modified_at', 'sha256', 'source_section', 'candidate_retention_level', 'migration_decision', 'exclusion_reason', 'selected_destination'];
const csvPath = path.join(outputDir, 'legacy-source-index.csv');
fs.writeFileSync(csvPath, `${columns.join(',')}\n${records.map((r) => columns.map((c) => csvEscape(r[c])).join(',')).join('\n')}\n`, 'utf8');
const summaryLines = ['# Legacy workspace inventory', '', `Source: \`${source}\``, `Generated: ${result.generated_at}`, `Files: ${result.file_count}`, `Bytes: ${result.total_bytes}`, '', '| Candidate level | Files | Bytes |', '|---|---:|---:|', ...Object.entries(summary).sort().map(([level, value]) => `| ${level} | ${value.files} | ${value.bytes} |`), '', 'The inventory is read-only. Migration decisions are applied by `migrate-legacy-selected.mjs`; source files are preserved.'];
fs.writeFileSync(path.join(outputDir, 'legacy-inventory-summary.md'), `${summaryLines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ json: jsonPath, csv: csvPath, file_count: result.file_count, total_bytes: result.total_bytes, summary }, null, 2));
