---
name: evolution
description: Manually discover and safely absorb useful external skills, workflows, scripts, and templates.
---

# evolution

This skill is manual-only. `$evolution` may be invoked without a target; in that case inspect project history, failures, reports, tests, capability-map, and logs to generate exploration directions. Search across GitHub and other relevant public ecosystems for useful workflows, skills, scripts, templates, and research tooling. Rank candidates by relevance, activity, stars/forks, license, tests, compatibility, and safety.

Download candidates into `_work/cache/evolution/`, pin source commits/tags, compare against `00_project/traceability/capability-map.yaml`, add only incremental compatible changes, run project checks, and record sources, licenses, hashes, decisions, and tests under `00_project/traceability/evolution/`. Do not execute unknown install hooks, overwrite user changes, change research goals, delete unique source data, or publish externally.

If a required tool is missing, use `scripts/ensure-toolchain.mjs` for an allowlisted user-level recovery. It verifies the downloaded artifact integrity, updates only the user PATH, records the recovery event, and retries the original project command. It must not install arbitrary packages or execute unknown installer hooks.
