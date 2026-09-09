---
name: 3d
description: Run the project-owned 3D Modeling Block for native SolidWorks creation, modification, geometry inspection and export at G1 by default.
---

Use the repository-owned 3D Modeling Block at [`3d/SKILL.md`](../../../3d/SKILL.md).
The executable entry point is:

```text
node 3d/index.mjs --task path/to/geometry-task.json
```

Modes are independent:

```text
node 3d/index.mjs --mode create|modify|inspect|export
```

Keep 3D-local execution autonomous. Return geometry, physical-meaning, COMSOL,
Geant4 and research-objective questions as structured issue records; never
modify COMSOL, Geant4 or Research Workflow state from this block.
