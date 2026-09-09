---
name: geant4
description: Run bounded Geant4 setup, transport, scoring, statistics and validation tasks through the repository Geant4 MVP.
---

Use the repository-owned Geant4 Block at [`geant4/SKILL.md`](../../../geant4/SKILL.md).
The executable entry point is:

```text
node geant4/index.mjs --task path/to/task.yaml
```

Keep Geant4-local changes autonomous and return geometry, COMSOL field, source,
device-configuration and research-assumption questions as structured
IssueReport evidence for Research Workflow.

The public CLI boundary records direct Geant4 work through `research-state`.
Reuse a supplied `context_id` when called by Research Workflow; do not create a
second foreground task. The state hook records inputs, results and validation
references without changing Geant4 transport policy.
