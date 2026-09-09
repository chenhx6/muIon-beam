# Research Workflow MVP

The executable control entry point is:

```text
node research-workflow/index.mjs validate --contract contracts/comsol-task.yaml
node research-workflow/index.mjs dispatch --contract contracts/comsol-task.yaml
node research-workflow/index.mjs execute --contract contracts/comsol-task.yaml --dry-run
node research-workflow/index.mjs status
```

The workflow can call the existing 3D, COMSOL and Geant4 entry points, but it
does not redesign them. Direct module entry points also record a context in
`research-state`. Contracts are immutable once dispatched and all IDs are
generated automatically.
