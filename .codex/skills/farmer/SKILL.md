---
name: farmer
description: Supervise and recover transiently terminated Codex Desktop sessions for D:\\muIon-beam.
---

# farmer

`farmer.mjs` is the project session supervisor. The project workflow calls `farmer:ensure` on entry; users do not need to invoke it for ordinary work.

- Monitor only sessions whose recorded cwd is inside `D:\\muIon-beam`.
- Use rollout JSONL and public `codex queue`; never read or write Codex SQLite.
- Recover only allowlisted transient failures.
- Keep one pending continuation per session and preserve the original thread and model.
- Use the project-local supervision records for audit metadata without storing prompts or credentials.
