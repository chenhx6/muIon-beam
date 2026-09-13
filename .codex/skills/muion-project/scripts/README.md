# 项目脚本

脚本使用工作区依赖中的 Node.js，无需额外 npm 包：

```powershell
node .codex/skills/muion-project/scripts/preflight.mjs .
node .codex/skills/muion-project/scripts/validate-manifest.mjs
node .codex/skills/muion-project/scripts/validate-variable-catalog.mjs
node .codex/skills/muion-project/scripts/build-variable-catalog-view.mjs
node .codex/skills/muion-project/scripts/build-index.mjs .
node .codex/skills/muion-project/scripts/build-detailed-report.mjs <run-directory>
node .codex/skills/muion-project/scripts/generate-cleanup-report.mjs .
node .codex/skills/muion-project/scripts/figure-qa.mjs --manifest <run-directory>/report/figure-manifest.json
```

`figure-qa.mjs` checks new code-bound figure entries, source/input/output SHA256
values, SVG presence, the final-figure PDF requirement, and historical-import
exceptions. Add `--for-report` when a figure is about to enter a report; that mode
requires a separate compact QA record proving machine and visual review passed. It
does not copy source data or image binaries. Selected pinned `nature-figure` audit
implementations are absorbed under `scripts/figure_checks`; the vendored source is
reference-only and is not a second user-facing workflow.

所有清理相关脚本默认只生成报告。`formalize-fast-track.mjs` 拒绝覆盖已有目标目录。

## 保留原迁移版本期间

- `verify-legacy-migration.mjs` 为只读校验：分别报告旧源变化、本地副本和 Drive 副本的原始哈希一致性。`valid=true` 只表示本次技术检查通过，不能替代 `migration_complete` 或人工签收。
- 用户的 `legacy-source-change-decision.json` 生效时，`legacy-migrate` 和冒烟实例重建在写入前返回状态 `awaiting-legacy-phase-completion`（退出码 2）。
- `acceptance:finalize` 只读返回待定状态，不修改 Manifest，不自动写入 `structural-accepted`、`verified` 等成功标志。
- 调用统一参数解析器的入口在 `--help` 时提前退出，不执行迁移、发布、数据库构建或同步。
- 验证命令：`node --test tests/legacy-version-policy.test.mjs`。测试只使用 `_work/scratch` 下隔离样例。

## 可恢复项目编排

```powershell
node .codex/skills/muion-project/scripts/autopilot.mjs plan --task-id TASK-ID
node .codex/skills/muion-project/scripts/deep-interview.mjs answer --workflow-run-id WF-ID --answers-file intake.json
node .codex/skills/muion-project/scripts/consensus-plan.mjs record-review --workflow-run-id WF-ID --role architect --review-file architect.json
node .codex/skills/muion-project/scripts/consensus-plan.mjs record-review --workflow-run-id WF-ID --role critic --review-file critic.json
node .codex/skills/muion-project/scripts/ultragoal.mjs status --workflow-run-id WF-ID
node .codex/skills/muion-project/scripts/ultraqa.mjs run --workflow-run-id WF-ID
node .codex/skills/muion-project/scripts/autopilot.mjs resume --workflow-run-id WF-ID
```

工作流账本写入 `07_research_system/control/research-state/workflows/`，`state.yaml`
仍是当前状态唯一事实源；`_work/current/` 只保留临时执行输出和兼容镜像。

## 并行 session 与文件隔离

写任务使用项目自己的 session 边界，不直接共用默认 checkout：

```powershell
node .codex/skills/team/scripts/session-concurrency.mjs begin --project-root D:\muIon-beam --session-id geometry-a --task-id TASK-GEOMETRY --owned-path 07_research_system/blocks/3d/**
node .codex/skills/team/scripts/session-concurrency.mjs check --project-root D:\muIon-beam --session-id geometry-a
node .codex/skills/muion-project/scripts/auto-commit-push.mjs --project-root D:\muIon-beam --session-id geometry-a --message "checkpoint geometry"
node .codex/skills/team/scripts/session-concurrency.mjs integrate --project-root D:\muIon-beam --session-id geometry-a
```

`begin` 会创建 `_work/current/worktrees/<session_id>` 和
`codex/session/<session_id>`，并在中央 runtime registry 记录私有 baseline、
heartbeat 和路径 claim。两个 active session 的 claim 重叠时会在启动前拒绝；
没有声明路径的 writer 自动得到整个 checkout 的 claim。`shared-read` 允许并行
读取，`shared-write` 只用于 legacy 单 writer 兼容路径。worker checkpoint 不会
推送 `main`，leader 需要在干净 checkout 中执行锁定的集成步骤。脏 worktree、越权
路径和合并冲突都会保留现场并阻塞该 session，不自动覆盖文件。
