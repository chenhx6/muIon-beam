---
name: geant4-block
description: Independent Geant4 calculation block for bounded particle transport, scoring, statistics and validation.
---

# Geant4 Block MVP

Geant4 is one autonomous professional calculation block in the muon-ion
research system. Its public entry point is `runGeant4(G4Task) -> G4Result`,
implemented in `07_research_system/blocks/geant4/index.mjs`. The block owns Geant4 setup, transport,
scoring, event statistics and local validation; Research Workflow remains the
only owner of research objectives, cross-module routing and final decisions.

## Work sequence

```text
G4 Task
  -> Preflight
  -> physics / geometry sanity check
  -> small smoke or diagnostic run
  -> baseline run
  -> diagnosis
  -> bounded local adjustment when evidence supports it
  -> production run
  -> scoring / statistics
  -> validation
  -> G4Result or IssueReport
```

Do not start a large event count by default. The first run should establish
that the geometry, source, physics list, fields and scoring are actually active.
Increase events only for an identified statistical question or an explicit
task-authorized production run. A repeated failure with unchanged mechanism
stops local exploration and is returned with evidence.

## Internal capabilities

- **setup**: geometry references, materials, particle source, physics list and
  processes, external E/B fields, cuts, step limits and run configuration;
- **transport**: tracking, energy loss, scattering, stopping, decay,
  secondaries and nuclear/particle interactions enabled by the selected model;
- **scoring**: transmission, hit/loss location, energy deposition, spectra,
  position, angle, time, reaction and secondary yield when requested;
- **statistics**: event counts, uncertainty, diagnostic versus baseline versus
  production runs, and bounded convergence/sensitivity checks;
- **g4-validation**: overlap/navigation, process registration, field tracking,
  step/cut settings, numerical stability, basic physical scale and statistical
  sufficiency.

The deterministic helpers live in `scripts/`; the small native fixture in
`tests/fixtures/mvp-smoke/` is a runtime check, not a device model.

## Governance boundary

The block may repair Geant4 C++/CMake, adjust local tracking parameters, add a
diagnostic scorer, compare explicitly reasonable local physics models, and run
small local scans. It must not edit SolidWorks or the 3D Block, redesign a
COMSOL field, change device configuration, change the research objective, or
take over Research Workflow.

When a finding may belong to geometry, a COMSOL field, an upstream source, a
device configuration or a research assumption, return an `IssueReport` with
the observation, evidence, candidate explanations and suggested next checks.
Do not silently change the external input to make the run pass.

## Evidence and references

Record the actual Geant4 version, physics constructor, data environment,
geometry/source references, cuts, field settings, event counts, output hashes
and validation status. `not-yet-validated` and `not-evaluated` are valid explicit
states. They must not be replaced by a success claim.

- Read [references/workflow.md](references/workflow.md) for stage and stopping rules.
- Read [references/smoke-model.md](references/smoke-model.md) for the four MVP smoke scenarios.
- Read [references/official-sources.md](references/official-sources.md) before recording Geant4 facts.
- Read [references/historical-muon-ne.md](references/historical-muon-ne.md) only when using the old μ−–Ne work as read-only context.
- Read [references/boundaries-and-issues.md](references/boundaries-and-issues.md) when a result crosses module ownership.

## Knowledge evolution

An observation enters `experience-candidates/` before it can become a stable
rule:

```text
Observation -> Experience -> Candidate -> evidence/reproduction
           -> validation/regression -> promotion
```

The candidate template requires conditions, evidence, uncertainty and a
verification plan. A single surprising run never changes permanent physics
guidance.
