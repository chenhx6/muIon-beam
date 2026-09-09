---
name: 3d
description: Run the project-owned 3D Modeling Block for native SolidWorks creation, modification, geometry inspection and export at G1 by default.
---

Use the repository-owned 3D Modeling Block at [`07_research_system/blocks/3d/SKILL.md`](../../../07_research_system/blocks/3d/SKILL.md).
The executable entry point is:

```text
node 07_research_system/blocks/3d/index.mjs --task path/to/geometry-task.json
```

Modes are independent:

```text
node 07_research_system/blocks/3d/index.mjs --mode create|modify|inspect|export
```

Keep 3D-local execution autonomous. Return geometry, physical-meaning, COMSOL,
Geant4 and research-objective questions as structured issue records; never
modify COMSOL, Geant4 or Research Workflow state from this block.

The public CLI boundary records direct 3D work through `research-state`.
Reuse a supplied `context_id` when called by Research Workflow. The state hook
records geometry inputs and evidence only; it does not make physics decisions or
edit another module.
