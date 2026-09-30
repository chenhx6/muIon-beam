import fs from 'node:fs';
import path from 'node:path';

const runtimeSegments = new Set(['.git', '_work', 'node_modules', '__pycache__', '.pytest_cache', '.cache', '.venv', 'venv', 'venvs', '.tox', 'private', 'playwright', 'browser-use']);
const runtimePrefixes = [
  '00_project/web-research/downloads/',
  '00_project/web-research/evidence-outbox/',
  '00_project/state/3d-smoke/',
  '00_project/traceability/sync-outbox/',
];
const quarantineRoot = '90_migration/quarantine';

export function normalizeArtifactPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '').toLowerCase();
}

export function classifyLocalArtifactPath(value) {
  const relative = normalizeArtifactPath(value);
  if (!relative) return null;
  if (relative === quarantineRoot || relative.startsWith(quarantineRoot + '/')) {
    return path.posix.basename(relative).includes('manifest') ? 'quarantine-manifest' : 'quarantine';
  }
  if (relative.split('/').some(part => runtimeSegments.has(part)) || runtimePrefixes.some(prefix => relative.startsWith(prefix))) return 'local-runtime';
  if (relative === '00_project/state/task-baseline.json' || relative.startsWith('00_project/state/task-close-')) return 'local-runtime';
  return null;
}

export function readQuarantineManifestEntries(root) {
  const base = path.join(path.resolve(root), quarantineRoot);
  const entries = new Map();
  if (!fs.existsSync(base)) return entries;
  const pending = [base];
  while (pending.length) {
    const directory = pending.pop();
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) pending.push(file);
      else if (item.isFile() && /manifest.*\.json$/i.test(item.name)) {
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const record of Array.isArray(manifest.items) ? manifest.items : []) {
          const relative = normalizeArtifactPath(record.quarantine_path);
          if (!relative.startsWith(quarantineRoot + '/') || !/^[a-f0-9]{64}$/i.test(String(record.sha256 || '')) || !Number.isSafeInteger(Number(record.bytes))) continue;
          const value = { bytes: Number(record.bytes), sha256: String(record.sha256).toLowerCase(), manifest: path.relative(root, file).replaceAll('\\', '/') };
          const previous = entries.get(relative);
          if (previous && (previous.bytes !== value.bytes || previous.sha256 !== value.sha256)) throw new Error(`conflicting quarantine manifests for ${relative}`);
          entries.set(relative, value);
        }
      }
    }
  }
  return entries;
}

export function matchesQuarantineManifest(entries, relative, bytes, sha256) {
  const expected = entries.get(normalizeArtifactPath(relative));
  return Boolean(expected && expected.bytes === Number(bytes) && expected.sha256 === String(sha256 || '').toLowerCase());
}
