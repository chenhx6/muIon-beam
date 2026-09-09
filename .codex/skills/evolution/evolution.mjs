import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function evaluateCandidate(candidate, existing = []) {
  const reasons = [];
  if (!candidate.source_url || !candidate.commit) reasons.push('source must be pinned');
  if (!['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'CC0-1.0'].includes(candidate.license)) reasons.push('license requires review');
  if (candidate.install_hooks) reasons.push('unknown install hooks');
  if (existing.includes(candidate.capability_id)) reasons.push('duplicate capability: extend or merge instead');
  return { accepted: reasons.length === 0, reasons, score: (candidate.relevance || 0) * 10 + Math.log10(1 + (candidate.stars || 0)) + (candidate.tests ? 2 : 0) + (candidate.active ? 1 : 0) };
}
export const hashContent = (content) => crypto.createHash('sha256').update(content).digest('hex');
export function discoverLocalSignals(root) {
  const paths = ['AGENTS.md', 'README.md', 'package.json', '00_project/roadmap', '00_project/traceability', '03_runs', '04_results', '05_reports', 'tests'];
  const signals = [];
  for (const relative of paths) {
    const target = path.join(root, relative);
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    signals.push({ path: relative.replaceAll('\\\\', '/'), kind: stat.isDirectory() ? 'directory' : 'file', modified_at: stat.mtime.toISOString(), size: stat.size });
  }
  return signals;
}
export function writeEvolutionRecord(root, record) {
  const dir = path.join(root, '00_project/traceability/evolution');
  fs.mkdirSync(dir, { recursive: true });
  const id = record.evolution_id || `EVOLUTION-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(id))) throw new Error('evolution_id contains unsafe path characters');
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, evolution_id: id, ...record }, null, 2) + '\n');
  return file;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || '.');
  console.log(JSON.stringify({ mode: 'discover', root, signals: discoverLocalSignals(root), message: 'Use web/GitHub search for candidates, then evaluateCandidate before adoption.' }, null, 2));
}
