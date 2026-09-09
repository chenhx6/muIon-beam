---
name: research-workflow
description: Coordinate muon-ion research goals, contracts, execution routing and evidence across the project modules.
---

Use the repository-owned control layer at `research-workflow/`. It coordinates
goals, physics reasoning, routing and immutable contracts while keeping 3D,
COMSOL and Geant4 execution autonomous. All direct and routed work records a
context through `research-state/`.

Executable entry point:

```text
node research-workflow/index.mjs validate|dispatch|execute|status
```
