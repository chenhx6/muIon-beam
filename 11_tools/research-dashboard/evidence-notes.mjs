const levels = new Set(['confirmed', 'inferred', 'unverified']);
export function validateEvidenceNote(note = {}) {
  const errors = [];
  for (const field of ['facts', 'evidence', 'conclusion']) if (!Array.isArray(note[field])) errors.push(`${field} must be an array`);
  if (note.conclusion_level && !levels.has(note.conclusion_level)) errors.push('conclusion_level must be confirmed, inferred or unverified');
  if (!Array.isArray(note.risks)) errors.push('risks must be an array');
  if (!Array.isArray(note.next_steps)) errors.push('next_steps must be an array');
  return { valid: errors.length === 0, errors, conclusion_level: note.conclusion_level || 'unverified' };
}
