import fs from 'node:fs';
import path from 'node:path';
import { readWorkflowState } from './workflow-state.mjs';

const root = path.resolve(process.argv[2] || '.');
const farmerState = path.join(root, '_work/current/farmer/state.json');
const lock = path.join(root, '_work/current/farmer/lock.json');
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
console.log(JSON.stringify({
  project_root: root,
  workflow: readWorkflowState(root),
  farmer: { lock: read(lock, null), state: read(farmerState, {}) },
  next: readWorkflowState(root).phase === 'idle' ? 'deep-interview' : 'continue-current-phase'
}, null, 2));
