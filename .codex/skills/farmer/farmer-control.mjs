import fs from 'node:fs';
import path from 'node:path';

export function controlPath(root) { return path.join(root, '_work', 'current', 'farmer', 'control.json'); }
export function readControl(root) {
  try { return JSON.parse(fs.readFileSync(controlPath(root), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { schema_version: 1, disabled: false }; throw error; }
}
export function isDisabled(root) { return readControl(root).disabled === true; }
export function writeControl(root, patch = {}) {
  const current = readControl(root);
  const next = { schema_version: 1, ...current, ...patch, changed_at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(controlPath(root)), { recursive: true });
  const temp = `${controlPath(root)}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8'); fs.renameSync(temp, controlPath(root));
  return next;
}
