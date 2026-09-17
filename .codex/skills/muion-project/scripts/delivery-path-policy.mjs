import path from 'node:path';

const under = (file, prefix) => file === prefix.replace(/\/$/, '') || file.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
const inList = (file, values = []) => values.some(value => under(file, value.toLowerCase()));

// One policy evaluator for delivery plans, worker checkpoints and leader publication.
// A model-source exception bypasses only its own directory exclusion, never a
// binary extension, runtime directory or byte budget.
export function evaluateDeliveryPath(input, policy) {
  const file = String(input).replaceAll('\\', '/');
  if (!file || file.includes('\0') || path.posix.isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.split('/').includes('..')) {
    return { allowed: false, reason: 'invalid-project-path' };
  }
  const normalized = path.posix.normalize(file).toLowerCase();
  const segments = normalized.split('/');
  if (segments.some(value => ['.git', '_work', 'node_modules', '__pycache__'].includes(value))) {
    return { allowed: false, reason: 'runtime-or-git-path' };
  }
  if ((policy.deny_extensions || []).some(ext => normalized.endsWith(ext.toLowerCase()))) {
    return { allowed: false, reason: 'protected-binary-extension' };
  }
  const source = policy.model_sources;
  if (source && under(normalized, source.prefix.toLowerCase())) {
    if (segments.some(value => source.excluded_directory_names.includes(value))) {
      return { allowed: false, reason: 'generated-model-output' };
    }
    const admitted = source.extensions.includes(path.posix.extname(normalized)) || source.filenames.includes(path.posix.basename(normalized));
    // Only this directory's blanket deny may be waived, not a more specific deny.
    const otherDeny = (policy.deny_prefixes || []).filter(prefix => prefix.toLowerCase() !== source.prefix.toLowerCase());
    if (inList(normalized, otherDeny)) return { allowed: false, reason: 'protected-path' };
    return { allowed: admitted, reason: admitted ? 'model-rebuild-source' : 'model-file-not-source', text_required: admitted };
  }
  if (inList(normalized, policy.deny_prefixes)) return { allowed: false, reason: 'protected-path' };
  const allowed = inList(normalized, policy.allow_prefixes);
  return { allowed, reason: allowed ? 'project-asset' : 'outside-allowlist' };
}
