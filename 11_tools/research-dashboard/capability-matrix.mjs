const modes = new Set(['new','extend','merge','reference-only','reject']);
export function compareCapability(local = {}, candidate = {}) {
  const evidence = ['revision','license','hash','tests'].filter((k) => candidate[k]);
  const eligible = evidence.length >= 3 && Boolean(candidate.license);
  const existing = Boolean(local.capability_id && candidate.capability_id === local.capability_id);
  return { capability_id: candidate.capability_id || null, eligible, existing, adoption_modes: [...modes], recommended: existing ? 'reference-only' : 'new', evidence, manual_adoption_required: true, install_executed: false };
}
