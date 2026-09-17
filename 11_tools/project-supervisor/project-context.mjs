import fs from 'node:fs';
import path from 'node:path';

export function loadProjectContext(root, scopes = ['automatic_entry', 'parallel_sessions']) {
  const index = JSON.parse(fs.readFileSync(path.join(root, '00_project/decisions/active-adr.json'), 'utf8'));
  const files = [...new Set([index.read_first, ...index.core, ...scopes.flatMap(scope => index.by_scope[scope] || [])])];
  return files.map(file => {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error('ADR path escapes project');
    const content = fs.readFileSync(absolute, 'utf8');
    return { path: file, content };
  });
}
