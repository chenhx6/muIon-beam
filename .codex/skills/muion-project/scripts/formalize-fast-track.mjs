import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve(process.argv[2] || '03_runs/fast-track/example-task');
const destination = path.resolve(process.argv[3] || '03_runs/formal/RUN-YYYYMMDD-NNN-formalized-task');
if (!fs.existsSync(source)) throw new Error(`source fast-track directory not found: ${source}`);
if (fs.existsSync(destination)) throw new Error(`destination already exists: ${destination}`);
fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
const note = path.join(destination, 'formalize-note.md');
fs.writeFileSync(note, `# Formalize note\n\nSource fast-track: ${path.relative(process.cwd(), source).replaceAll('\\', '/')}\n\nOriginal files were copied without rewriting. Missing historical fields must remain marked as unknown, not-recorded, or to-be-filled.\n`, 'utf8');
console.log(JSON.stringify({ source, destination, originalPreserved: true }, null, 2));
