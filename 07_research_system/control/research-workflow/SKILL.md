---
name: research-workflow
description: Coordinate muon-ion research goals, physics reasoning, bounded routing, immutable contracts, execution results, diagnosis and state updates across 3D, COMSOL and Geant4.
---

# Research Workflow

This is the single research decision layer for the muon-ion project. It owns
scientific goals, questions, routing, contract decisions, cross-module
interpretation and next-task selection. It does not own solver, transport or
CAD implementation details.

`07_research_system/control/research-state` is an independent shared persistence boundary. Every workflow
operation and every direct 3D, COMSOL, Geant4, validation or diagnosis entry
must create or reuse a state context. `state.yaml` is the current-state source;
NOW, chat status and optional checklists are derived views.

The normal path is:

```text
question -> physics reasoning -> routing -> frozen contract -> execution
-> result-issue-report -> validation/diagnosis -> decision -> state update
```

Project-level execution is supervised by `npm run autopilot`. Its durable chain is
`deep-interview -> consensus-plan/ralplan -> preflight -> snapshot -> contract ->
execute -> validate -> report -> ultraqa -> archive -> close`. Direct module entry
points remain appropriate for smoke and diagnosis and cannot publish or close a
project workflow.

Read only the relevant reference for the current stage. Keep one foreground
task, use finite retries, never alter a dispatched contract, and return a
proposal when a fixed or forbidden condition must change.

- Goal alignment: [goal-management.md](references/goal-management.md)
- Physics reasoning: [physics-reasoning.md](references/physics-reasoning.md)
- Routing: [task-routing.md](references/task-routing.md)
- Dispatch: [sub-agent-dispatch.md](references/sub-agent-dispatch.md)
- Diagnosis: [failure-diagnosis.md](references/failure-diagnosis.md)
- Open problems: [open-problem-tracking.md](references/open-problem-tracking.md)
- Reports: [research-report.md](references/research-report.md)

