import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ensureDirectory, relativePath, runGit, sha256File } from './project-utils.mjs';

const ID = /^[A-Za-z0-9._-]+$/;
const protectedRoots = ['02_models/', '03_runs/', '04_results/', '05_reports/', '_work/current/outbox/'];
function validId(id) { if (!ID.test(String(id || ''))) throw new Error(`invalid workflow id: ${id}`); }
function cleanPaths(root, paths) {
  return [...new Set((paths || []).map(String).map(p => p.replaceAll('\\', '/').replace(/^\.\//, '')))].sort();
}
function safePath(root, p) {
  const abs = path.resolve(root, p); if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error(`path escapes project: ${p}`); return abs;
}
function hashPaths(root, paths) {
  const out = {}; for (const p of paths) { const f = safePath(root, p); out[p] = fs.existsSync(f) && fs.statSync(f).isFile() ? sha256File(f) : null; } return out;
}
function dir(root, id) { validId(id); return path.join(root, '_work/current/workflows', id); }
export function createWorkflowOwnership(root, id, taskId, ownedPaths = []) {
  const d = dir(root, id); ensureDirectory(d); const paths = cleanPaths(root, ownedPaths);
  for (const p of paths) { safePath(root, p); if (protectedRoots.some(x => p === x.slice(0,-1) || p.startsWith(x))) throw new Error(`protected path cannot be owned: ${p}`); }
  const wfRoot = path.join(root, '_work/current/workflows');
  for (const other of fs.existsSync(wfRoot) ? fs.readdirSync(wfRoot, {withFileTypes:true}).filter(e=>e.isDirectory() && e.name !== id) : []) {
    const f = path.join(wfRoot, other.name, 'owned_paths.json'); if (!fs.existsSync(f)) continue;
    const theirs = JSON.parse(fs.readFileSync(f, 'utf8')); const overlap = paths.filter(p => (theirs.paths || theirs).some(q => p === q || p.startsWith(`${q}/`) || q.startsWith(`${p}/`)));
    if (overlap.length) throw new Error(`ownership conflict with ${other.name}: ${overlap.join(', ')}`);
  }
  const head = runGit(root, ['rev-parse','HEAD'], {allowFailure:true}).stdout?.trim() || null;
  const baseline = { schema_version:'1.0.0', workflow_run_id:id, task_id:taskId ?? null, head, paths, hashes:hashPaths(root, paths), created_at:new Date().toISOString() };
  fs.writeFileSync(path.join(d,'task-baseline.json'), JSON.stringify(baseline,null,2)+'\n');
  fs.writeFileSync(path.join(d,'owned_paths.json'), JSON.stringify({schema_version:'1.0.0',workflow_run_id:id,task_id:taskId??null,paths},null,2)+'\n');
  return baseline;
}
export function loadWorkflowOwnership(root, id) {
  const d = dir(root,id), f = path.join(d,'task-baseline.json'), o = path.join(d,'owned_paths.json');
  if (!fs.existsSync(f) || !fs.existsSync(o)) throw new Error(`ownership record missing for ${id}`);
  const baseline=JSON.parse(fs.readFileSync(f,'utf8')), owned=JSON.parse(fs.readFileSync(o,'utf8'));
  if (baseline.workflow_run_id !== id || owned.workflow_run_id !== id) throw new Error('ownership id mismatch');
  for (const p of owned.paths || []) safePath(root,p);
  return { ...baseline, owned_paths:owned.paths || [] };
}
export function commitOwnedPaths(root,id,{message,push=false}={}) {
  if (!message) throw new Error('commit message required'); const own=loadWorkflowOwnership(root,id), paths=own.owned_paths;
  if (!paths.length) return { committed:false, reason:'empty-owned-paths' };
  const changed=runGit(root,['status','--porcelain=v1','-z']).stdout || ''; // reject paths outside ownership only for safety audit
  const listFile=path.join(dir(root,id),`pathspec-${crypto.randomUUID()}.txt`); fs.writeFileSync(listFile, paths.join('\n')+'\n');
  try {
    runGit(root,['add','--pathspec-from-file',listFile]);
    const result=runGit(root,['commit','--only','--pathspec-from-file',listFile,'-m',message],{allowFailure:true});
    if (result.status!==0 && !/nothing to commit/i.test(result.stdout||'')) throw new Error((result.stderr||result.stdout).trim());
    if (push) runGit(root,['push']);
    return {committed:result.status===0, commit:runGit(root,['rev-parse','HEAD']).stdout.trim(), changed_before:changed.length};
  } finally { try { fs.unlinkSync(listFile); } catch {} }
}
