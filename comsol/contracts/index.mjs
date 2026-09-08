const LEVELS = new Set(['none', 'diagnostic', 'bounded']);
const SCOPE_NAMES = ['fixed', 'variable', 'external'];

function asArray(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`ComsolTask.${field} must be an array`);
  return value;
}

function scopeEntry(value, field, index) {
  if (typeof value === 'string') return { name: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`ComsolTask.${field}[${index}] must be a string or object`);
  }
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) throw new Error(`ComsolTask.${field}[${index}] requires name`);
  return { ...value, name };
}

function assumptionEntry(value, index) {
  if (typeof value === 'string') return { id: `assumption-${index + 1}`, statement: value, status: 'provisional' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`ComsolTask.assumptions[${index}] must be a string or object`);
  const statement = typeof value.statement === 'string' ? value.statement.trim() : '';
  if (!statement) throw new Error(`ComsolTask.assumptions[${index}] requires statement`);
  return { id: value.id || `assumption-${index + 1}`, status: value.status || 'provisional', ...value, statement };
}

export function normalizeTask(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ComsolTask must be an object');
  const required = ['task_id', 'objective', 'inputs', 'assumptions', ...SCOPE_NAMES, 'success_criteria', 'required_outputs', 'exploration_level'];
  for (const field of required) if (!(field in input)) throw new Error(`ComsolTask missing ${field}`);
  if (typeof input.task_id !== 'string' || !input.task_id.trim()) throw new Error('ComsolTask.task_id must be a non-empty string');
  if (typeof input.objective !== 'string' || !input.objective.trim()) throw new Error('ComsolTask.objective must be a non-empty string');
  if (!input.inputs || typeof input.inputs !== 'object' || Array.isArray(input.inputs)) throw new Error('ComsolTask.inputs must be an object');
  if (!LEVELS.has(input.exploration_level)) throw new Error(`ComsolTask.exploration_level must be one of ${[...LEVELS].join(', ')}`);

  const task = {
    schema_version: input.schema_version || '0.1.0',
    ...input,
    task_id: input.task_id.trim(),
    objective: input.objective.trim(),
    inputs: { ...input.inputs },
    assumptions: asArray(input.assumptions, 'assumptions').map(assumptionEntry),
    fixed: asArray(input.fixed, 'fixed').map((v, i) => scopeEntry(v, 'fixed', i)),
    variable: asArray(input.variable, 'variable').map((v, i) => scopeEntry(v, 'variable', i)),
    external: asArray(input.external, 'external').map((v, i) => scopeEntry(v, 'external', i)),
    success_criteria: asArray(input.success_criteria, 'success_criteria'),
    required_outputs: asArray(input.required_outputs, 'required_outputs'),
    exploration_level: input.exploration_level,
    resources: input.resources && typeof input.resources === 'object' ? { ...input.resources } : {},
    diagnostic_cases: asArray(input.diagnostic_cases, 'diagnostic_cases'),
    exploration_cases: asArray(input.exploration_cases, 'exploration_cases')
  };

  const owners = new Map();
  for (const field of SCOPE_NAMES) {
    for (const entry of task[field]) {
      const key = entry.name.toLowerCase();
      if (owners.has(key)) throw new Error(`ComsolTask scope overlap: ${entry.name} in ${owners.get(key)} and ${field}`);
      owners.set(key, field);
    }
  }
  return task;
}

export function validateTask(input) {
  try {
    const task = normalizeTask(input);
    const warnings = [];
    if (!Object.keys(task.inputs).length) warnings.push('inputs is empty; Build cannot infer a model');
    if (!task.assumptions.length) warnings.push('no assumptions recorded; confirm that no upstream question is hidden');
    if (!task.required_outputs.length) warnings.push('required_outputs is empty');
    return { valid: true, task, errors: [], warnings };
  } catch (error) {
    return { valid: false, task: null, errors: [error.message], warnings: [] };
  }
}

export function isInternalVariable(task, entry) {
  const name = String(entry?.name || '').toLowerCase();
  if (!name) return false;
  const fixed = new Set(task.fixed.map((v) => v.name.toLowerCase()));
  const external = new Set(task.external.map((v) => v.name.toLowerCase()));
  const owner = String(entry.owner || entry.scope || '').toLowerCase();
  const allowedOwners = new Set(['', 'comsol', 'comsol-local', 'comsol-block']);
  return !fixed.has(name) && !external.has(name) && allowedOwners.has(owner);
}

export function validateCaseScope(task, caseSpec) {
  const fixed = new Map(task.fixed.map((v) => [v.name.toLowerCase(), v]));
  const variable = new Set(task.variable.map((v) => v.name.toLowerCase()));
  const external = new Set(task.external.map((v) => v.name.toLowerCase()));
  const errors = [];
  for (const name of Object.keys(caseSpec.parameters || {})) {
    const key = name.toLowerCase();
    if (external.has(key)) errors.push(`${name} is EXTERNAL and cannot be changed by COMSOL`);
    else if (!variable.has(key)) {
      const discoveredProbe = caseSpec.kind === 'discovered-diagnostic-probe' && caseSpec.probe_only === true && String(caseSpec.discovered_variable?.name || '').toLowerCase() === key && isInternalVariable(task, caseSpec.discovered_variable);
      if (!discoveredProbe) errors.push(`${name} is not an authorized VARIABLE for this case`);
    }
  }
  if (caseSpec.kind !== 'baseline') {
    for (const [parameterName, parameterValue] of Object.entries(caseSpec.parameters || {})) {
      const fixedEntry = fixed.get(parameterName.toLowerCase());
      if (fixedEntry && parameterValue !== fixedEntry.value) errors.push(`${parameterName} is FIXED and cannot be changed by COMSOL`);
    }
  }
  return { valid: errors.length === 0, errors };
}
