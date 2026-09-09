import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readAgentRun, recordVerification, updateAgentRun } from './agent-run-ledger.mjs';

const MAX_OUTPUT = 12000;
const safeId = (value, label) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(value || ''))) throw new Error(`unsafe ${label}`);
  return String(value);
};
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const hash = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
const trim = (value) => String(value || '').slice(0, MAX_OUTPUT);

function normalizeChecks(verification = {}) {
  if (Array.isArray(verification.checks)) return verification.checks;
  if (verification.executable) return [{ check_id: verification.check_id || 'verification', executable: verification.executable, args: verification.args || [], cwd: verification.cwd, expected_exit: verification.expected_exit ?? 0 }];
  if (verification.command) return [{ check_id: verification.check_id || 'verification', command: verification.command, shell: verification.shell === true, cwd: verification.cwd, expected_exit: verification.expected_exit ?? 0 }];
  return [];
}

function executeCheck(root, check) {
  const expected = check.expected_exit ?? 0;
  if (check.executable) {
    const result = spawnSync(check.executable, check.args || [], { cwd: path.resolve(root, check.cwd || '.'), encoding: 'utf8', timeout: check.timeout_ms || 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    return { check_id: check.check_id || check.executable, status: result.status === expected ? 'passed' : 'failed', exit_code: result.status, signal: result.signal || null, stdout: trim(result.stdout), stderr: trim(result.stderr), expected_exit: expected };
  }
  if (check.command && check.shell === true) {
    const result = spawnSync(check.command, { cwd: path.resolve(root, check.cwd || '.'), shell: true, encoding: 'utf8', timeout: check.timeout_ms || 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    return { check_id: check.check_id || 'shell-verification', status: result.status === expected ? 'passed' : 'failed', exit_code: result.status, signal: result.signal || null, stdout: trim(result.stdout), stderr: trim(result.stderr), expected_exit: expected, shell: true };
  }
  return { check_id: check.check_id || 'verification', status: 'blocked', exit_code: null, stdout: '', stderr: 'structured executable/args required; shell commands need shell:true', expected_exit: expected };
}

export function runEvidenceGate({ root = process.cwd(), verification = {}, execute = true, metadata = {} } = {}) {
  const checks = normalizeChecks(verification);
  const evidence_id = metadata.evidence_id || `EVIDENCE-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const results = execute ? checks.map((check) => executeCheck(root, check)) : checks.map((check) => ({ check_id: check.check_id || check.executable || 'verification', status: 'planned', expected_exit: check.expected_exit ?? 0 }));
  const verdict = !checks.length ? 'not-evaluated' : !execute ? 'planned' : results.every((result) => result.status === 'passed') ? 'passed' : results.some((result) => result.status === 'blocked') ? 'blocked' : 'failed';
  const evidence = { schema_version: 1, evidence_id, gate_type: verification.gate_type || 'oracle', oracle: verification.oracle || 'local-command', deterministic_oracle: verification.deterministic_oracle !== false, verdict, checks: results, reviewer_evidence: verification.reviewer_evidence || [], metadata, generated_at: new Date().toISOString() };
  evidence.evidence_hash = hash(evidence);
  return evidence;
}

export function writeEvidence(root, evidence) {
  const dir = path.join(root, '00_project', 'traceability', 'evidence'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safeId(evidence.evidence_id, 'evidence_id')}.json`); fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n'); return file;
}

export function recordEvidenceGate(root, runId, evidence) {
  const file = writeEvidence(root, evidence); const record = recordVerification(root, runId, { gate: evidence.verdict, evidence_id: evidence.evidence_id, evidence_path: file, evidence_hash: evidence.evidence_hash, tests: evidence.checks || [] });
  if (record.lifecycle_state === 'running' && evidence.verdict === 'passed') return updateAgentRun(root, runId, 'succeeded', { output_reference: file });
  if (record.lifecycle_state === 'running' && evidence.verdict === 'failed') return updateAgentRun(root, runId, 'failed', { failure_reason: 'evidence gate failed', output_reference: file });
  return record;
}
