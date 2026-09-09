# Research Workflow MVP

The executable control entry point is:

```text
node 07_research_system/control/research-workflow/index.mjs validate --contract 07_research_system/control/contracts/comsol-task.yaml
node 07_research_system/control/research-workflow/index.mjs dispatch --contract 07_research_system/control/contracts/comsol-task.yaml
node 07_research_system/control/research-workflow/index.mjs execute --contract 07_research_system/control/contracts/comsol-task.yaml --dry-run
node 07_research_system/control/research-workflow/index.mjs status
```

The workflow can call the existing 3D, COMSOL and Geant4 entry points, but it
does not redesign them. Direct module entry points also record a context in
`research-state`. Contracts are immutable once dispatched and all IDs are
generated automatically.
