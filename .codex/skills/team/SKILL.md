---
name: team
description: Coordinate bounded sub-agent work with runtime model discovery and isolation.
---

# team

Use this capability automatically when a goal has genuinely independent lanes. Before dispatch, discover the currently available models and reasoning levels, then choose by capability fit, context/tool compatibility, and availability. Prefer high capability and `xhigh` when supported; do not use `max` or `ultra` by default. Record every dispatch in `00_project/traceability/agent-runs/`.

One writer owns each file. Reviewers are read-only by default. A child agent does not spawn another child unless the parent goal explicitly grants that permission.
