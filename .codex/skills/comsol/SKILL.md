---
name: comsol
description: Route COMSOL Block work through the repository-owned COMSOL MVP.
---

Use the repository-owned COMSOL Block at `comsol/`. Read
[`comsol/SKILL.md`](../../../comsol/SKILL.md) for the frozen boundaries,
`ComsolTask`/`ComsolResult` contracts, adapter interface and smoke behaviour.

The executable entry point is:

```text
node comsol/index.mjs --task path/to/task.json
```

Keep COMSOL-local execution autonomous, return cross-module issues as
structured records, and never modify the established 3D Block or implement
Geant4/Research Workflow routing here.

