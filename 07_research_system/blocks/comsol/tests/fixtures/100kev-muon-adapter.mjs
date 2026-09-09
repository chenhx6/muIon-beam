// Labelled historical behaviour fixture. It is not a COMSOL numerical result.
export function createHistorical100keVFixtureAdapter() {
  return {
    kind: 'documented-behavioural-fixture',
    version: 'smoke-scenario-0.1',
    available: true,
    capabilities: { build: true, solve: true, parallel_cases: true },
    async build() {
      return { model_handle: { fixture: true }, named_selection_check: 'documented-only' };
    },
    async solveCase(caseSpec) {
      return {
        status: 'complete',
        outputs: {
          solver_convergence: true,
          transmission_fraction: 0,
          failure_mode: 'electrode_or_wall_collision',
          physical_evidence: ['historical case reports persistent collision before downstream target'],
          trajectory_envelope: 'gyro-orbit scale is comparable to the approximately 15 mm aperture scale',
          collision_coordinates: 'central aperture/electrode or outer-wall loss region (qualitative fixture)',
          wall_clearance: 'insufficient (qualitative fixture)',
          aperture_clearance: 'insufficient (qualitative fixture)',
          field_topology: 'not re-solved by fixture',
          parameter_sensitivity: { variable: Object.keys(caseSpec.parameters), meaningful: false },
          loss_location: 'electrode_or_outer_wall',
          time_evolution: 'loss occurs before downstream entry',
          candidate_causes: ['geometry', 'source', 'initial_state', 'field_configuration']
        },
        validation: { solver_convergence: true, numerical_stability: 'fixture-only', sanity_checks: ['fixture labels are present'] }
      };
    }
  };
}

