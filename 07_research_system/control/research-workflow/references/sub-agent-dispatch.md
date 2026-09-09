# Sub-agent dispatch

Dispatch receives a frozen contract and returns a structured result report. The
executor owns local implementation choices only. It cannot change research
goals, another module's inputs, or fixed/forbidden contract fields. Workflow
passes an existing `context_id` so a module call does not create a second
foreground task.
