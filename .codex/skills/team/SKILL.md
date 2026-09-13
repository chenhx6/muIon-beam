---
name: team
description: Coordinate bounded sub-agent work with runtime model discovery and isolation.
---

# team

Use this capability automatically when a goal has genuinely independent lanes. A dispatch starts from the JSON manifest schema at `schemas/dispatch-manifest.schema.json`; run `scripts/dispatch-manifest.mjs` validation before any runtime spawn. Ready waves are derived from completed dependencies, path ownership/read conflicts and exclusive named resources. Unknown independence is serialized. Path claims are normalized case-insensitively and overlapping writers are refused by the session admission layer.

Before dispatch, discover the currently available models and reasoning levels, then apply hard compatibility filtering (freshness, endpoint, context, modalities, tools, allowed models, backend and permissions). Role capabilities from `00_project/config/agent-routing.yaml` affect ranking; model names never imply capabilities. Quality and requested reasoning are considered before context headroom, availability/load and cost/latency tie-breakers. Prefer high capability and `xhigh` when supported; do not use `max` or `ultra` by default. A stale catalog may serve low-risk read-only work as last-known-good, but write/high-risk/fan-out work must refresh or fall back to the parent/blocked.

Record every dispatch in `00_project/traceability/agent-runs/` using `scripts/agent-run-ledger.mjs`. The ledger records the manifest hash, requirements, candidates, selection reason, freshness, permissions, lifecycle, evidence and unresolved items. `scripts/dispatch.mjs` prepares and records a plan; it does not pretend to enforce a subprocess sandbox that the Codex runtime does not expose.

For executable code tasks, use `scripts/evidence-gate.mjs`: tests, builds,
schema checks and repro commands produce evidence, while the command result is
the gate. Reviewer findings remain advisory. For research tasks, use
`scripts/research-evidence.mjs` to collect contract hashes, source references,
numeric comparisons, module reports and read-only physics-review evidence. It
returns `final_verdict: null`; `research-workflow` remains responsible for
scientific interpretation and state updates.

`scripts/session-concurrency.mjs` provides the project-local session boundary:
`begin` creates a private Git worktree and branch for a writer, `check` validates
actual changed paths against its claim, `heartbeat` renews the lease, `submit`
creates an integration receipt, `integrate` is a leader-only serialized gate,
and `reap` recovers only an expired clean session.
Use `shared-read` for read-only work and `shared-write` only for legacy single-
writer tasks. A session with no declared ownership receives a whole-workspace
claim and cannot run beside another writer.

`scripts/telemetry.mjs` summarizes only durable local agent-run observations:
roles, models, families, stale use, fallback, retry, failure and correlation
risk. Provider capacity is reported as `unknown` unless runtime metadata records
it. `scripts/resource-lock.mjs` supplies cooperative named-resource locks for
COMSOL/GUI/solver/shared-build resources; it is not filesystem or worktree
enforcement.

One writer owns each file. Reviewers are read-only by default. A child agent cannot spawn another child by default; the manifest validator rejects that permission unless the root leader explicitly grants it.

Workers never publish directly. The leader owns the delivery plan, Gitee commit/push, Drive archive, result tags and three-end audit. Each worker returns changed paths, tests, SHA256 evidence where relevant, source/result/report references and unresolved items; durable summaries enter the project Manifest or milestone record. Worker checkpoint commits stay on `codex/session/<session_id>` until the leader integration gate accepts them.
