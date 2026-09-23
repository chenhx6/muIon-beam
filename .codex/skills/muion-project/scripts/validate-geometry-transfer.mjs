import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, '../../../..'));
const paths = {
  solidworks_native: '02_models/solidworks/legacy/stage1_3d_feasibility/cad/Stage1_Master_3D.SLDPRT',
  step_transfer: '02_models/solidworks/legacy/stage1_3d_feasibility/cad/Stage1_Master_3D.step',
  comsol_import_check: '02_models/comsol/legacy/stage1_3d_feasibility/comsol/stage1_solidworks_step_import_check.mph',
  transfer_log: '03_runs/formal/run_legacy_smoke_001_stage1_centered/diagnostics/legacy/stage1_3d_feasibility/logs/solidworks_step_import_final.log'
};
const files = {};
const missing = [];
for (const [key, rel] of Object.entries(paths)) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) missing.push(rel);
  else {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    files[key] = { path: rel, bytes: fs.statSync(file).size, sha256: hash };
  }
}
const log = files.transfer_log ? fs.readFileSync(path.join(root, files.transfer_log.path), 'utf8') : '';
const evidence = { step_import_success: /STEP_IMPORT=SUCCESS/.test(log), closed_shell_6: /closed_shell:6/.test(log), manifold_solid_brep_6: /manifold_solid_brep:6/.test(log) };
const result = { schema_version: 1, source: 'current_project_geometry_transfer', status: missing.length === 0 && evidence.step_import_success ? 'passed' : 'blocked', files, missing, evidence, notes: ['STEP is the neutral interface for COMSOL and Geant4 geometry ingestion.', 'Native SLDPRT remains the editable CAD source.', 'This check validates file presence, hashes and recorded transfer evidence; it does not claim a new physical solve.'] };
fs.mkdirSync(path.join(root, '02_models/model-manifests'), { recursive: true });
fs.writeFileSync(path.join(root, '02_models/model-manifests/geometry_transfer_lvl1_mu_ne_001.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === 'passed' ? 0 : 1;
