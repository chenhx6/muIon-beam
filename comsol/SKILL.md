---
name: comsol-block
description: Independent COMSOL calculation block for building, solving, diagnosing and reporting bounded particle and field simulations.
---

# COMSOL Block MVP v0.1

COMSOL Block is an independent professional calculation module. Its public
entry point is `runComsol(ComsolTask) -> ComsolResult`, implemented in
`comsol/index.mjs`. The block owns COMSOL model state and execution settings;
it does not own the global muon-ion research state.

## Frozen architecture principles

1. **High autonomy inside the block.** Physics interfaces, materials,
   boundary and initial conditions, mesh, study, solver, time step, convergence
   recovery, parameter cases, sensitivity probes and trajectory/field analysis
   may be handled locally once the task scope is explicit.
2. **No autonomy across modules.** The block never edits the formal 3D/CAD
   design, invokes Geant4 to advance research, changes the device concept or
   research objective, or promotes a temporary assumption to a solved fact.
   Out-of-scope questions become structured interface messages.
3. **Research Workflow remains the only global owner.** Future routing,
   cross-module decisions, sub-agent scheduling and open/deferred problem
   management are reserved for Research Workflow. This MVP only exposes
   `Issue`, `EscalationRequest` and `ScopeExpansionRequest` records.

## Work stages

`Intake -> Build -> baseline Solve -> Diagnose -> Adaptive Bounded Explore ->
Solve -> Diagnose -> Validation/Report`.

The implementation intentionally keeps one skill and small stage modules. The
COMSOL adapter is injected through a narrow interface, so a real COMSOL Java,
CLI, LiveLink or other adapter can be added after the local environment is
verified. Without an adapter, the workflow is still executable as a planning
and diagnostic run and reports `adapter-unavailable`; it does not fabricate
physics results.

## Task scope

`ComsolTask` requires an explicit `objective`, `inputs`, `assumptions`,
`fixed`, `variable`, `external`, `success_criteria`, `required_outputs` and
`exploration_level`. `fixed`, `variable` and `external` are disjoint lists.
The block may vary only entries in `variable` that are COMSOL-local and
authorized by the task. Formal geometry, aperture dimensions, electrode or
magnet mechanics and other upstream decisions belong in `external`.

## Adaptive Bounded Exploration

The explorer always starts from baseline. It may issue explicitly described,
small diagnostic probes, then expand only when the evidence gives information
gain: objective improvement, a changed failure mechanism or meaningful
sensitivity. Candidate cases are supplied by the task or adapter; the policy
does not invent fixed percentage ranges or a fixed scan size. Persistent
failure with unchanged mechanism stops the exploration and produces an
`Issue`/`EscalationRequest`. A numerical failure is diagnosed before any scan
is enlarged.

An unlisted COMSOL-local variable may receive only a diagnostic probe when it
is not `FIXED` or `EXTERNAL` and the task permits probing. Evidence that it
deserves formal study becomes a `ScopeExpansionRequest`; the block does not
silently add it to the variable scope.

## Adapter contract

An adapter may implement:

```js
{
  kind, version, available, capabilities,
  build(task, context) -> Promise<BuildAdapterResult>,
  solveCase(caseSpec, context) -> Promise<SolveAdapterResult>,
  recoverCase(caseSpec, failure, context) -> Promise<SolveAdapterResult> // optional
}
```

`solveCase` is execution parallelism only. Research parallelism (for example,
one agent changing geometry and another changing source assumptions) is owned
by Research Workflow and must not be scheduled here.

## Validation and evidence

Calculation completion is not physics validation. Every result records solver
convergence, numerical stability, relevant mesh/time-step checks, sanity or
conservation checks when applicable, success-criteria assessment, assumptions,
exploration history and the stopping reason. Missing checks are explicitly
`not-evaluated`. Trajectory envelope, collision coordinates, clearances, field
topology, loss location and time evolution are evidence fields, not automatic
permission to alter another module.

## Project traceability

For a formal numerical run, freeze the selected MPH/CAD/source/code inputs with
the project `create-run-snapshot` entry point before calling `runComsol`, and
pass the resulting run/input snapshot references in `task.traceability`.
`writeResultBundle` records those references and output SHA256 values in
`comsol-result-manifest.json`. The MVP does not replace the project run
Manifest or SQLite index.

## Historical smoke scenario

`comsol/tests/fixtures/100kev-muon-aperture-failure.yaml` documents the former
100 keV, approximately 1 T, radial-injection failure around a 15 mm-scale
gyro/aperture and a near-wall source. The behavioural test uses a labelled
fixture adapter, not a claimed COMSOL numerical run. PASS means baseline loss
is diagnosed, a finite voltage probe is attempted, unchanged failure produces
no blind scan, and an escalation identifies geometry/source/initial-state/
field-configuration candidates. A real adapter can replace the fixture while
retaining the same assertions.
