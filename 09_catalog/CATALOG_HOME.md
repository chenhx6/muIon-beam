# Project Catalog

This directory is the library-style navigation layer for durable project
artifacts. It does not duplicate scientific files. Use the generated views to
find the canonical path, then open the file in its owning module.

## Lookup path

```text
module -> artifact type -> topic -> task/run -> canonical path
```

Examples:

- Geant4 data: `views/by_module/geant4.md`
- Reports: `views/by_artifact/reports.md`
- A task: `views/by_task/`
- A formal run: `views/by_run/`
- A plan: `views/by_plan/`

Generated views also include `by_artifact`, `by_topic`, `by_task`, and
`by_run`. The catalog is rebuilt from durable roots and manifests; it is not a
second copy of project data.

The index is generated from task, model, run, figure, report and reference
manifests. Run `node .codex/skills/muion-project/scripts/catalog-build.mjs .`
to refresh it and `catalog-check.mjs` to detect drift.
