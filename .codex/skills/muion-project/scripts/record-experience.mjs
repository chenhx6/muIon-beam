import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, projectRootFromHere, ensureDirectory, jsonRead, jsonWrite, nowIso } from './project-utils.mjs';

const EXPERIENCE_DIR = '00_project/traceability/experiences';
const POLARITIES = new Set(['positive', 'negative', 'neutral']);

function safeId(value) {
  return typeof value === 'string' && /^EXP-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

export function validateExperience(record) {
  if (!record || typeof record !== 'object') throw new Error('experience record must be an object');
  if (!safeId(record.experience_id)) throw new Error('experience_id must match EXP-<safe-id>');
  if (!POLARITIES.has(record.polarity)) throw new Error('polarity must be positive, negative, or neutral');
  for (const field of ['category', 'title', 'observation', 'reusable_value']) if (typeof record[field] !== 'string' || !record[field].trim()) throw new Error(`${field} is required`);
  const normalized = {
    schema_version: record.schema_version || '1.0.0',
    record_type: 'experience-record',
    experience_id: record.experience_id,
    recorded_at: record.recorded_at || nowIso(),
    status: record.status || 'recorded',
    polarity: record.polarity,
    category: record.category,
    title: record.title,
    observation: record.observation,
    evidence: asArray(record.evidence),
    impact: asArray(record.impact),
    reusable_value: record.reusable_value,
    actions: asArray(record.actions),
    tags: asArray(record.tags),
    related_paths: asArray(record.related_paths),
    related_commits: asArray(record.related_commits),
  };
  return normalized;
}

export function recordExperience(root, record) {
  const normalized = validateExperience(record);
  const file = path.join(root, EXPERIENCE_DIR, `${normalized.experience_id}.json`);
  if (fs.existsSync(file)) throw new Error(`experience already exists: ${normalized.experience_id}`);
  jsonWrite(file, normalized);
  return { file, record: normalized };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.project_root || projectRootFromHere());
  if (!args.record_file) throw new Error('provide --record-file');
  const input = path.resolve(root, args.record_file);
  const result = recordExperience(root, jsonRead(input));
  console.log(JSON.stringify({ status: 'recorded', path: path.relative(root, result.file).replaceAll('\\', '/'), experience_id: result.record.experience_id, polarity: result.record.polarity, category: result.record.category }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
