import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const localDir = path.resolve(process.argv[2] || '.');
const archiveDir = process.argv[3] ? path.resolve(process.argv[3]) : null;
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (!entry.name.endsWith('.sha256')) files.push(full);
  }
}
if (!fs.existsSync(localDir)) throw new Error(`local directory not found: ${localDir}`);
walk(localDir);
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const localRecords = files.map((file) => ({ relative: path.relative(localDir, file), size: fs.statSync(file).size, sha256: digest(file) }));
const result = { localDir, archiveDir, localFileCount: localRecords.length, valid: true, mismatches: [] };
if (archiveDir) {
  if (!fs.existsSync(archiveDir)) { result.valid = false; result.mismatches.push(`archive directory not found: ${archiveDir}`); }
  else {
    for (const record of localRecords) {
      const candidate = path.join(archiveDir, record.relative);
      if (!fs.existsSync(candidate)) result.mismatches.push(`${record.relative}: missing in archive`);
      else {
        const stat = fs.statSync(candidate);
        const hash = digest(candidate);
        if (stat.size !== record.size || hash !== record.sha256) result.mismatches.push(`${record.relative}: size or SHA256 mismatch`);
      }
    }
    result.valid = result.mismatches.length === 0;
  }
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.valid ? 0 : 1;
