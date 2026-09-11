export function inspectPhysicsContract(contract = {}) {
  const checks = [
    ['objectives', contract.objective || contract.observables || contract.targets],
    ['initial_conditions', contract.initial_conditions],
    ['boundary_conditions', contract.boundary_conditions || contract.boundaries],
    ['validation', contract.validation_requirements || contract.validation]
  ];
  const missing = checks.filter(([, value]) => value == null || (Array.isArray(value) && value.length === 0)).map(([name]) => name);
  return { status: missing.length ? 'proposal-required' : 'ready-for-module-validation', missing, preserves_contract: true, note: 'Advisory preflight; does not modify contract or research-state.' };
}
