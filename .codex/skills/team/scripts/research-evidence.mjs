import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readContractFile, validateContract } from '../../../../07_research_system/control/contracts/index.mjs';
import { isPathInside, relativePath, sha256File } from '../../muion-project/scripts/project-utils.mjs';

const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];

function normalizeSourceEvidence(root, values) {
  return asArray(values).map((item, index) => {
    const entry = typeof item === 'string' ? { reference: item } : { ...(item || {}) };
    if (!entry.reference && !entry.path && !entry.url) throw new Error(`source evidence ${index + 1} requires reference, path or url`);
    if (entry.path) {
      const absolute = path.resolve(root, entry.path);
      if (!isPathInside(absolute, root)) throw new Error(`source evidence path escapes project root: ${entry.path}`);
      entry.path = relativePath(root, absolute);
      entry.exists = fs.existsSync(absolute);
      if (entry.exists && !entry.sha256) entry.sha256 = sha256File(absolute);
    }
    return entry;
  });
}

function normalizeReviewers(values, producerFamily = null) {
  return asArray(values).map((item, index) => {
    const entry = { ...(item || {}) };
    if (!entry.run_id) throw new Error(`physics reviewer ${index + 1} requires run_id`);
    if (!String(entry.evidence || entry.findings || '').trim()) throw new Error(`physics reviewer ${entry.run_id} requires evidence`);
    if (entry.read_only === false) throw new Error(`physics reviewer ${entry.run_id} must be read-only`);
    const reviewerFamily = entry.model_family || null;
    return { ...entry, correlated_review_risk: Boolean(producerFamily && reviewerFamily && producerFamily === reviewerFamily), family_known: Boolean(reviewerFamily) };
  });
}

export function collectResearchEvidence({ root = process.cwd(), contract_path, contract_sha256 = null, source_evidence = [], numerical_comparisons = [], module_reports = [], physics_reviewers = [], producer_model_family = null, unresolved_items = [], evidence_id } = {}) {
  if (!contract_path) throw new Error('contract_path is required');
  const absoluteContract = path.resolve(root, contract_path);
  if (!isPathInside(absoluteContract, root)) throw new Error('contract_path escapes project root');
  const contract = readContractFile(absoluteContract);
  const validation = validateContract(contract);
  const actualHash = sha256File(absoluteContract);
  const hashMatches = !contract_sha256 || contract_sha256 === actualHash;
  const sources = normalizeSourceEvidence(root, source_evidence);
  const reviewers = normalizeReviewers(physics_reviewers, producer_model_family);
  const comparisons = asArray(numerical_comparisons).map((entry, index) => ({ comparison_id: entry.comparison_id || `comparison-${index + 1}`, status: entry.status || 'not-evaluated', ...entry }));
  const unresolved = [...asArray(unresolved_items), ...(validation.valid ? [] : validation.errors), ...(!hashMatches ? ['contract SHA256 does not match expected frozen value'] : [])];
  const result = {
    schema_version: 1,
    evidence_id: evidence_id || `RESEARCH-EVIDENCE-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`,
    status: validation.valid && hashMatches ? 'evidence-collected' : 'blocked',
    final_verdict: null,
    deterministic_oracle_available: false,
    contract: { contract_id: contract.contract_id || null, task_id: contract.task_id || null, path: relativePath(root, absoluteContract), sha256: actualHash, expected_sha256: contract_sha256, hash_matches: hashMatches, validation },
    source_evidence: sources,
    numerical_comparisons: comparisons,
    module_reports,
    physics_reviewers: reviewers,
    correlated_review_risk: reviewers.some((reviewer) => reviewer.correlated_review_risk),
    unresolved_items: unresolved,
    research_workflow_owner: true,
    generated_at: new Date().toISOString()
  };
  result.evidence_hash = digest(result);
  return result;
}

export function writeResearchEvidence(root, evidence) {
  const dir = path.join(root, '00_project', 'traceability', 'evidence'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${evidence.evidence_id}.json`); fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n'); return file;
}
