import fs from 'node:fs';
import { makeIssue, makeWarning } from '../interface/index.mjs';
import { detectInstalledComsolBatch } from '../adapters/batch.mjs';

export const DEFAULT_NAMED_SELECTIONS = [
  'muon_injection_surface',
  'central_aperture',
  'outer_wall',
  'electrode_01',
  'target_region'
];

export function createUnavailableAdapter(reason = 'No verified COMSOL adapter was supplied') {
  return {
    kind: 'unavailable',
    version: null,
    available: false,
    capabilities: { build: false, solve: false, parallel_cases: false },
    unavailable_reason: reason,
    runtime: detectInstalledComsolBatch()
  };
}

export function detectComsolAdapter(env = process.env) {
  const configured = env.COMSOL_BATCH || env.COMSOL_JAVA_API || env.COMSOL_MPH_ADAPTER;
  if (!configured) {
    const runtime = detectInstalledComsolBatch();
    return createUnavailableAdapter(runtime.detected ? 'COMSOL Batch is installed, but no explicit repository adapter command is configured' : 'COMSOL_BATCH/COMSOL_JAVA_API/COMSOL_MPH_ADAPTER is not configured');
  }
  if (configured && fs.existsSync(configured)) return createUnavailableAdapter(`Adapter path exists but no repository adapter is registered for ${configured}`);
  return createUnavailableAdapter(`Configured COMSOL adapter was not found: ${configured}`);
}

function geometryPlan(task) {
  const geometry = task.inputs.geometry;
  if (!geometry) return { status: 'missing', source: null, action: 'await-explicit-geometry-reference' };
  if (typeof geometry === 'string') return { status: 'declared', source: geometry, action: 'import-explicit-geometry-reference' };
  const source = geometry.ref || geometry.path || geometry.model_id || null;
  return source ? { status: 'declared', source, action: 'import-explicit-geometry-reference' } : { status: 'invalid', source: null, action: 'await-explicit-geometry-reference' };
}

function namedSelectionPlan(task) {
  const requested = Array.isArray(task.inputs.named_selections) ? task.inputs.named_selections : [];
  const names = requested.map((value) => typeof value === 'string' ? value : value?.name).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
  return { names: [...new Set([...DEFAULT_NAMED_SELECTIONS, ...names])], requested };
}

export async function buildComsolModel(task, { adapter = createUnavailableAdapter(), logger = null } = {}) {
  const geometry = geometryPlan(task);
  const selections = namedSelectionPlan(task);
  const namedSelections = selections.names;
  const steps = [
    'geometry import',
    'domain / boundary identification',
    'boundary and initial conditions',
    'semantic named selections',
    'materials',
    'physics interfaces',
    'particle source and conditions',
    'mesh',
    'study and solver preparation'
  ];
  const warnings = [];
  const issues = [];
  if (geometry.status === 'missing' || geometry.status === 'invalid') issues.push(makeIssue({
    code: 'geometry-reference-missing',
    title: 'Geometry input is not explicit',
    observation: 'Build cannot choose a CAD or MPH geometry without an input reference.',
    evidence: [geometry.status === 'missing' ? 'task.inputs.geometry is absent' : 'task.inputs.geometry has no ref/path/model_id'],
    affected_scope: ['external'],
    recommended_action: 'Research Workflow or the task author must provide the intended geometry reference.'
  }));
  if (!task.inputs.named_selections?.length) warnings.push(makeWarning({
    code: 'named-selections-defaulted',
    message: 'No named selections were supplied; the build plan uses semantic selection names for adapter implementation.',
    phase: 'build',
    evidence: namedSelections
  }));
  if (!task.inputs.named_selection_verification) warnings.push(makeWarning({
    code: 'named-selection-verification-pending',
    message: 'Named selection stability after geometry changes is a required adapter check and has not been evidenced by Intake.',
    phase: 'build',
    evidence: ['boundary/domain IDs are not treated as stable interface names']
  }));

  const base = {
    phase: 'build',
    status: adapter.available ? 'ready-for-adapter' : 'adapter-unavailable',
    geometry,
    named_selections: namedSelections,
    named_selection_specs: selections.requested,
    steps,
    material_inputs: task.inputs.materials || [],
    physics_inputs: task.inputs.physics || task.inputs.field_configuration || {},
    source_inputs: task.inputs.particle_source || {},
    adapter: { kind: adapter.kind || 'unknown', version: adapter.version || null, available: Boolean(adapter.available), capabilities: adapter.capabilities || {} },
    warnings,
    issues
  };
  if (!adapter.available || typeof adapter.build !== 'function') return base;
  try {
    const adapterResult = await adapter.build(task, { namedSelections, geometry, steps, logger });
    if (adapterResult?.status === 'adapter-not-executed') {
      return {
        ...base,
        status: 'adapter-plan-only',
        adapter_result: adapterResult,
        warnings: [...warnings, makeWarning({ code: 'build-not-executed', message: 'The adapter did not execute a model build; supply a previous model explicitly or a build command before solving.', phase: 'build' })],
        issues: [...issues, makeIssue({ code: 'build-not-executed', title: 'Model build is only a plan', observation: 'No model build command ran, so solving is blocked unless an explicit previous_model is supplied.', evidence: ['adapter.build returned adapter-not-executed'], affected_scope: ['comsol-local', 'inputs.previous_model'], recommended_action: 'Provide build_command_template or an explicit previous model reference.' })]
      };
    }
    return { ...base, status: 'built', adapter_result: adapterResult || null };
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      issues: [...issues, makeIssue({
        code: 'build-adapter-failure',
        title: 'COMSOL model build failed',
        observation: error.message,
        evidence: ['adapter.build threw an exception'],
        affected_scope: ['comsol-local'],
        recommended_action: 'Diagnose the adapter/build input before changing task variables.'
      })]
    };
  }
}
