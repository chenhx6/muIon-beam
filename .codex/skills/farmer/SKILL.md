---
name: farmer
description: Supervise and recover transiently terminated Codex Desktop sessions for D:\\muIon-beam.
---

# farmer

farmer 只负责 session 监督和瞬态恢复。它不调用任务关闭、发布或同步入口；这些由项目编排层根据任务完成与 QA 证据调度。session 异常、取消、暂停和正常完成必须分别记录。

### Emergency pause and recovery circuit breaker

- `_work/current/farmer/control.json` is an operator pause switch. When `disabled: true`, `ensure`, `start`, `once`, and `retry` are no-ops and must not queue a message. ProjectSupervisor and repo hooks read the same switch; ordinary task entry cannot clear it. Only an explicit `farmer.mjs enable` changes it.
- `00_project/config/farmer.json` uses a bounded `max_attempts` default. A `queue-stuck`, `manual-attention-required`, or blocked event is a circuit breaker: the same `event_key` cannot be queued again. A new turn or an explicit manual retry is required.
- Queue acceptance is not completion. Watchdog timeout records the event and leaves the original session evidence in place. Do not send a second recovery to test a stuck queue.
- The installed Codex CLI exposes `codex queue` as enqueue-only; it has no list/cancel subcommand. Incident handling must record confirmed farmer-generated message IDs and leave user-authored messages untouched rather than guessing at cancellation.

`farmer.mjs` is the project session supervisor. The project workflow calls `farmer:ensure` on entry; users do not need to invoke it for ordinary work.

- Monitor only sessions whose recorded cwd is inside `D:\\muIon-beam`.
- Use rollout JSONL and public `codex queue`; never read or write Codex SQLite.
- Recover only allowlisted transient failures.
- Keep one pending continuation per session and preserve the original thread and model.
- Use the project-local supervision records for audit metadata without storing prompts or credentials.
- Do not perform independent `git add`, commit, push, tag, or Drive upload.
