import fs from 'node:fs';
import path from 'node:path';
import { sha256File } from '../../.codex/skills/muion-project/scripts/project-utils.mjs';

const projectRoots = ['.codex/', '00_project/', '01_physics/', '02_models/', '04_results/', '05_reports/', '07_research_system/', '08_references/', '09_catalog/', '10_plans/', '11_tools/', '90_migration/'];
const textExtensions = new Set(['.md','.txt','.json','.yaml','.yml','.csv','.tsv','.py','.mjs','.js','.ts','.c','.cc','.cpp','.cxx','.h','.hpp','.java','.cs','.cmake','.mac','.gdml','.toml','.xml','.ini','.cfg','.sh','.ps1','.bat']);
const binaryExtensions = new Set(['.mph','.sldprt','.sldasm','.slddrw','.step','.stp','.root','.h5','.hdf5','.vtk','.bin','.exe','.dll','.pyd','.zip','.7z']);
const normalize = value => String(value || '').replaceAll('\\','/').replace(/^\.\//,'');
const pathInside = (file, root) => { const absolute = path.resolve(root, file); return absolute === path.resolve(root) || absolute.startsWith(`${path.resolve(root)}${path.sep}`); };

export function classifyArtifact(artifact = {}) {
  const file = normalize(artifact.path); const lower = file.toLowerCase(); const ext = path.posix.extname(lower);
  if (!file || file.startsWith('_work/') || file.split('/').includes('.git')) return { status: 'retained-blocked', reason: 'runtime-or-git-output', next_action: 'keep in triage until explicitly classified' };
  if (binaryExtensions.has(ext)) return { status: 'drive-required', target: file, reason: 'large-or-commercial-binary', next_action: 'register Manifest and archive to Drive before cleanup' };
  if (lower.startsWith('03_runs/')) return { status: 'formal-run', target: file, reason: 'already-canonical-run-root', next_action: 'attach artifact Manifest and run receipt' };
  if (lower.startsWith('04_results/') || lower.startsWith('05_reports/')) return { status: lower.startsWith('05_reports/') ? 'report' : 'lightweight-result', target: file, reason: 'already-canonical-result-root', next_action: 'verify Manifest/hash and retain' };
  if (projectRoots.some(prefix => lower.startsWith(prefix.toLowerCase())) && (textExtensions.has(ext) || !ext)) return { status: 'project-asset', target: file, reason: 'durable-project-source', next_action: 'run shared delivery policy and leader checkpoint' };
  return { status: 'retained-blocked', reason: 'unregistered-destination', next_action: 'assign a canonical project/run/report/result target before promotion' };
}

export function buildPromotionPlan(root, record = {}) {
  const sourceRoot = path.resolve(record.worktree_path || root); const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
  return {
    schema_version: 1, record_type: 'artifact-promotion-plan', session_id: record.session_id || null, task_id: record.task_id || null,
    created_at: new Date().toISOString(), source_root: sourceRoot,
    artifacts: artifacts.map(artifact => ({ path: normalize(artifact.path), bytes: artifact.bytes ?? null, sha256: artifact.sha256 ?? null, ...classifyArtifact(artifact), approved: false }))
  };
}

export function applyApprovedPromotion(root, plan, { approvedPaths = [] } = {}) {
  const projectRoot = path.resolve(root); const allowed = new Set(approvedPaths.map(normalize)); const results = [];
  for (const item of plan.artifacts || []) {
    const source = path.resolve(plan.source_root, item.path); const target = path.resolve(projectRoot, item.target || item.path);
    if (!allowed.has(item.path) || item.status === 'retained-blocked' || item.status === 'drive-required') { results.push({ ...item, promotion: 'blocked' }); continue; }
    if (!pathInside(item.path, plan.source_root) || !pathInside(item.target || item.path, projectRoot)) throw new Error(`artifact promotion path escaped project: ${item.path}`);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) { results.push({ ...item, promotion: 'missing-source' }); continue; }
    const actual = sha256File(source); if (item.sha256 && actual !== item.sha256) throw new Error(`artifact hash changed before promotion: ${item.path}`);
    if (fs.existsSync(target)) {
      if (sha256File(target) !== actual) throw new Error(`promotion destination differs: ${item.target}`);
      results.push({ ...item, promotion: 'already-verified', target }); continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
    if (sha256File(target) !== actual) throw new Error(`promotion SHA256 mismatch: ${item.target}`);
    results.push({ ...item, promotion: 'promoted', target });
  }
  return { ...plan, completed_at: new Date().toISOString(), results };
}
