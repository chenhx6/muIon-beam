# Durable Plans

`10_plans/inbox` is the user drop zone for ideas and unclassified requests.
`10_plans/active` contains plans currently being discussed or executed.
`10_plans/archive` contains completed, rejected, or superseded plans.

Each active plan must include a descriptive directory name, `plan_index.json`,
the current human plan, the machine plan, a decision log, and agent handoffs.
Workflow state remains authoritative under
`07_research_system/control/research-state/workflows`.
