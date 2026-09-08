import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseJsonFile } from './common.mjs';

const MUON_MASS_KG = 1.883531627e-28;
const ELEMENTARY_CHARGE_C = 1.602176634e-19;
const SPEED_OF_LIGHT = 299792458;

export function larmorRadius({ kinetic_energy_ev, magnetic_field_t, mass_kg = MUON_MASS_KG, charge_c = ELEMENTARY_CHARGE_C }) {
  if (!(kinetic_energy_ev > 0) || !(Math.abs(magnetic_field_t) > 0)) return null;
  const restEnergyJ = mass_kg * SPEED_OF_LIGHT ** 2;
  const kineticJ = kinetic_energy_ev * ELEMENTARY_CHARGE_C;
  const momentum = Math.sqrt((kineticJ + restEnergyJ) ** 2 - restEnergyJ ** 2) / SPEED_OF_LIGHT;
  return momentum / (Math.abs(charge_c) * Math.abs(magnetic_field_t));
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function check(name, passed, detail, status = passed ? 'pass' : 'fail') { return { name, passed, status, detail }; }

export function validateSmokeResult(payload, { scenario = payload?.scenario, tolerance = 0.05 } = {}) {
  const checks = [];
  if (!payload || typeof payload !== 'object') return { status: 'not-evaluated', scenario, checks: [check('result', false, 'No JSON result was produced.', 'not-evaluated')] };
  checks.push(check('scenario', typeof scenario === 'string' && scenario.length > 0, scenario || 'missing scenario'));
  checks.push(check('geant4-version', typeof payload.geant4_version === 'string' && payload.geant4_version.length > 0, payload.geant4_version || 'missing Geant4 version', payload.geant4_version ? 'pass' : 'not-yet-validated'));
  if (scenario === 'runtime') {
    checks.push(check('events', Number.isInteger(payload.events) && payload.events > 0, `events=${payload.events}`));
    checks.push(check('tracks', Number.isInteger(payload.tracks) && payload.tracks > 0, `tracks=${payload.tracks}`));
  } else if (scenario === 'geometry') {
    checks.push(check('navigation', payload.navigation_completed === true, `navigation_completed=${payload.navigation_completed}`));
    const expected = payload.expected_overlap === true;
    checks.push(check('overlap', payload.overlap_detected === expected, `expected=${expected}, observed=${payload.overlap_detected}`));
  } else if (scenario === 'uniform-magnetic-field') {
    const expected = payload.analytic_larmor_radius_m;
    const measured = payload.measured_radius_m;
    const relative = finite(expected) && expected > 0 && finite(measured) ? Math.abs(measured - expected) / expected : null;
    checks.push(check('trajectory', relative != null && relative <= tolerance, `measured=${measured}, analytic=${expected}, relative_error=${relative}`, relative == null ? 'not-evaluated' : undefined));
  } else if (scenario === 'material') {
    checks.push(check('path-length', finite(payload.path_length_m) && payload.path_length_m > 0, `path_length_m=${payload.path_length_m}`));
    checks.push(check('energy-deposition', finite(payload.total_edep_j) && payload.total_edep_j >= 0, `total_edep_j=${payload.total_edep_j}`));
    checks.push(check('primary-energy-deposition', finite(payload.primary_edep_j) && payload.primary_edep_j >= 0, `primary_edep_j=${payload.primary_edep_j}`));
    checks.push(check('energy-recorded', finite(payload.initial_energy_ev) && finite(payload.final_energy_ev), `initial=${payload.initial_energy_ev}, final=${payload.final_energy_ev}`));
    checks.push(check('energy-loss-direction', finite(payload.initial_energy_ev) && finite(payload.final_energy_ev) && payload.final_energy_ev <= payload.initial_energy_ev, `initial=${payload.initial_energy_ev}, final=${payload.final_energy_ev}`));
  }
  const failed = checks.some((value) => value.status === 'fail' || value.passed === false);
  const pending = checks.some((value) => value.status === 'not-yet-validated' || value.status === 'not-evaluated');
  return { status: failed ? 'failed' : pending ? 'partial' : 'passed', scenario, checks, tolerance };
}

export function validateRunResult(result) {
  const issues = [];
  if (!result || typeof result !== 'object') issues.push({ category: 'g4-local', code: 'missing-result', message: 'No run result was supplied.' });
  if (result && result.status === 'failed') issues.push({ category: 'g4-local', code: 'run-failed', message: 'The Geant4 executable returned a failed run.' });
  return { status: issues.length ? 'failed' : 'passed', issues, calculation_finished: issues.length === 0, note: 'Calculation completion does not by itself establish physical validity.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) throw new Error('usage: node geant4/scripts/validate.mjs --input result.json [--scenario name]');
  const result = validateSmokeResult(parseJsonFile(path.resolve(args.input)), { scenario: args.scenario || undefined });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'failed' ? 2 : 0;
}
