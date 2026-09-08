---
name: farmer
description: Supervise and recover transiently terminated Codex Desktop sessions for D:\\muIon-beam.
---

# farmer

farmer 只负责 session 监督和瞬态恢复。它不直接发布 Gitee/Drive；只有项目存在 `close_requested=true`、QA 已通过且交付锁可取得时，才向统一的 `muion-project` 关闭入口提交候选。session 异常、取消、暂停和正常完成必须分别记录。

`farmer.mjs` is the project session supervisor. The project workflow calls `farmer:ensure` on entry; users do not need to invoke it for ordinary work.

- Monitor only sessions whose recorded cwd is inside `D:\\muIon-beam`.
- Use rollout JSONL and public `codex queue`; never read or write Codex SQLite.
- Recover only allowlisted transient failures.
- Keep one pending continuation per session and preserve the original thread and model.
- Use the project-local supervision records for audit metadata without storing prompts or credentials.
- Do not perform independent `git add`, commit, push, tag, or Drive upload.
