import path from 'node:path';
export const SYSTEM_ROOT = '07_research_system';
export const CONTROL_ROOT = `${SYSTEM_ROOT}/control`;
export const BLOCKS_ROOT = `${SYSTEM_ROOT}/blocks`;
export const CONTROL = { contracts: `${CONTROL_ROOT}/contracts`, researchState: `${CONTROL_ROOT}/research-state`, researchWorkflow: `${CONTROL_ROOT}/research-workflow` };
export const BLOCKS = { threeD: `${BLOCKS_ROOT}/3d`, comsol: `${BLOCKS_ROOT}/comsol`, geant4: `${BLOCKS_ROOT}/geant4` };
export function systemPath(root = process.cwd(), relative = '') { return path.join(root, SYSTEM_ROOT, relative); }
export function controlPath(root = process.cwd(), relative = '') { return systemPath(root, path.join('control', relative)); }
export function blockPath(root = process.cwd(), block, relative = '') { return systemPath(root, path.join('blocks', block, relative)); }
export function contractsPath(root = process.cwd(), relative = '') { return controlPath(root, path.join('contracts', relative)); }
export function researchStatePath(root = process.cwd(), relative = '') { return controlPath(root, path.join('research-state', relative)); }
