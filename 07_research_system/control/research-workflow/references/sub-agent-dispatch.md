# Sub-agent dispatch

Dispatch receives a frozen contract and returns a structured result report. The
executor owns local implementation choices only. It cannot change research
goals, another module's inputs, or fixed/forbidden contract fields. Workflow
passes an existing `context_id` so a module call does not create a second
foreground task.

Sub-agent fan-out is a team concern. A team dispatch manifest may reference the
contract hash and immutable input snapshot, but it cannot edit the frozen
contract or choose the scientific objective. The team validator only checks
dependency/ownership/resource safety, role permissions, model compatibility and
evidence routing; research-workflow remains the owner of research goals,
physics interpretation and contract changes.

For reviewer results, `team/scripts/research-evidence.mjs` may collect the
frozen contract hash, source references, numerical comparisons, module reports
and read-only physics-review evidence into
`00_project/traceability/evidence/`. The bundle deliberately keeps
`final_verdict: null`; Research Workflow validates and interprets it without
mutating the dispatched contract or creating a second research-state source.
