---
name: muion-project
description: Manage the muon-ion beam project workflow from task planning and model checks through simulation, dual reports, traceability, archiving, and safe cleanup inside D:\\muIon-beam.
metadata:
  short-description: muon-ion beam project workflow
---

# muion-project

Use this project skill for tasks inside `D:\muIon-beam` involving physics planning, SolidWorks geometry, COMSOL simulation, Geant4 transport, result reporting, Gitee publication, Google Drive archiving, or local file lifecycle management.

## Hard boundaries

- Read the repository `AGENTS.md` before acting.
- The legacy workspace `D:\muIon` is active again. Retain the already migrated baseline and read `00_project/decisions/legacy-source-change-decision.json` for the user's keep-original decision. Do not adopt subsequent source changes or start incremental migration until the user confirms phase completion. Preserve all source files.
- Treat Manifest files as the source of truth. SQLite and Markdown/CSV are generated views.
- Preserve user changes. Never reset or overwrite an unregistered model or code change.
- Before the first formal run, pause when a task-related model differs from its registered version.
- After the user confirms the task card, continue within that task scope without asking for approval at every parameter sweep.

## Choose a mode

- `plan`: create and report a task card with initial conditions, targets, variables, outputs, and acceptance criteria.
- `preflight`: check path, Git state, user changes, model fingerprints, large files, and archive availability.
- `fast-run`: record an urgent or externally assigned task with the minimum traceability fields before delivery.
- `simulate`: create a run snapshot, execute the requested model workflow, and register outputs.
- `cad-check`: validate SolidWorks exports and COMSOL import geometry.
- `report`: maintain the concise and detailed Chinese reports and registered figures.
- `figure-qa`: validate code-bound figure manifests, source/output hashes, SVG/PDF policy and figure QA records.
- `formalize`: convert a fast-track task into a formal run without rewriting source outputs.
- `archive-and-tag`: verify Drive archive, generate indexes, publish selected Gitee content, and create a tag with Chinese notes.
- `review`: check traceability and report consistency.
- `cleanup-report`: produce safe cleanup candidates; only explicitly temporary files may be auto-deleted.
- `sqlite-index`: build the rebuildable SQLite index from Manifest files.
- `legacy-inventory`: classify the completed legacy workspace without changing it.
- `legacy-migrate`: copy selected legacy P0/P1/P2 files and write migration hashes.
- `smoke-test`: create and validate a legacy-import task, model, run, and dual reports.
- `check-model-changes`: compare registered and current model fingerprints.
- `create-run-snapshot`: freeze the actual inputs used by a run.
- `publish-gitee`: dry-run or publish an annotated tag with a Chinese result note.
- `sync-three-end`: archive and verify the local, Gitee, and Drive state.
- `publish-and-sync`: publish a tagged result, archive its run, write sync state, and push the verified state record.
- `audit-three-end`: perform a read-only drift audit.
- `sync-project`: archive the tracked project and derived SQLite snapshots to a versioned Drive snapshot.
- `audit-project`: read-only audit of the project snapshot against local Git and Gitee.
- `cache-audit`: index cache files and generate safe cleanup candidates.
- `retry-sync`: retry pending three-end sync records idempotently and clear only successfully verified outbox entries.
- `install-nature-figure`: install or inspect the pinned external figure skill.
- `up`: read current workflow, farmer, model and synchronization state.
- `deep-interview`: turn a fuzzy research request into a durable requirements handoff.
- `consensus-plan`: require Architect and Critic evidence before execution.
- `autopilot`: route the approved task through execution, review, QA, report, tag and synchronization.
- `ultragoal`: maintain durable goals, checkpoints and handoffs under `00_project/state`.
- `team`: dispatch isolated sub-agent lanes using runtime model discovery.
- `physics-review`: check dimensions, boundaries, conservation, ranges and interpretation.
- `ultraqa`: run project, traceability, physics and report gates.
- `best-practice-research`: gather cited upstream evidence before architecture decisions.
- `autoresearch`: run bounded validator-gated research experiments.
- `research-loop`: connect hypotheses, campaigns, runs, figures, reports and decisions.
- `farmer`: ensure the project-local Codex Desktop session supervisor is running.
- `evolution`: manual-only discovery and safe incremental adoption of external skills and scripts.
- `auto-publish`: after validation, automatically commit and push only task-owned files; result tags require finalized reports and verified Drive/three-end state.

Read only the relevant reference file for the selected mode. Do not load every reference by default.

## Automatic project lifecycle

When a task is opened inside `D:\\muIon-beam`, ensure `farmer:ensure` has run and read lightweight project status. The workflow may select other modes automatically as the task moves through phases; users do not need to invoke each phase separately. `evolution` is manual-only and must never be started by ordinary project work.

At task start, record the Git baseline with `begin-task.mjs`. After task-owned changes pass validation, run `auto-commit-push.mjs --baseline <baseline>`; it refuses pre-existing user changes, protected model/output paths and missing baselines. Create an annotated result tag only after the report, Drive receipt and three-end audit are verified, and generate its Chinese note automatically.

## Required project artifacts

Every formal run needs a `run-manifest.yaml`, a model snapshot, source/input references, a concise report, a detailed report, and figure metadata when figures are produced. Use the templates under `00_project/templates`.

For new scientific figures, follow `references/figure-workflow.md`: every figure must
be generated by a traceable script, retain only lightweight references and hashes in
the figure manifest, and pass the project `figure-qa` gate before entering a report.

## Project-owned figure workflow

Use the project-owned `figure-workflow.md`, Manifest schema and `figure-qa` entry
point for all new figures. The pinned `nature-figure` copy under
`.codex/external-skills/nature-figure/upstream-skill` is reference material and a
source of already-adopted QA implementations; do not expose a second user-facing
workflow or edit the vendored copy during ordinary project work. Never let an
external plotting reference change physical inputs, result criteria, or retention
levels.
