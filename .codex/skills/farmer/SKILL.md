---
name: farmer
description: Supervise and recover transiently terminated Codex Desktop sessions for D:\\muIon-beam.
---

# farmer

farmer 只负责 session 监督和瞬态恢复。它不调用任务关闭、发布或同步入口；这些由项目编排层根据任务完成与 QA 证据调度。session 异常、取消、暂停和正常完成必须分别记录。

`farmer.mjs` is the project session supervisor. The project workflow calls `farmer:ensure` on entry; users do not need to invoke it for ordinary work.

- Monitor only sessions whose recorded cwd is inside `D:\\muIon-beam`.
- Use rollout JSONL and public `codex queue`; never read or write Codex SQLite.
- Recover only allowlisted transient failures.
- Keep one pending continuation per session and preserve the original thread and model.
- Use the project-local supervision records for audit metadata without storing prompts or credentials.
- Do not perform independent `git add`, commit, push, tag, or Drive upload.
