# 经验汇总：runtime-supervision

- 生成时间：2026-09-29T19:42:36.694Z
- 经验条数：6
- 正向：1；负向：5；中性：0

## 可共享结论

- **[negative] 项目任务进入时 dashboard 未自动启动**：进程存活、状态可读和 dashboard 可访问必须分别验收；farmer 正常不能推断 dashboard 已启动。
- **[positive] 独立监督器启动并恢复 dashboard**：服务健康、session 恢复和科研决策分别拥有接口与状态；真实退出恢复演练可验证启动链。
- **[negative] 自动恢复必须有持久停用开关和 event 熔断**：所有可恢复循环都必须同时具备持久 operator pause、bounded attempts、event-key breaker、watchdog 不重发和显式人工 retry；停止单个进程不足以构成停用。
- **[negative] 恢复成功后仍持续投递 farmer resume**：恢复队列必须有跨进程原子锁、queue 前持久 reservation、成功后的 recovery-chain 关闭和旧事件时间戳保护；queue accepted 不等于 turn started，历史重复消息不能靠轮询撤回。
- **[negative] 恢复 turn 启动后仍按旧失败链重复投递**：task_started 是一次恢复成功证据；同一 recovered turn 后续失败不能重新开启自动恢复链，新用户 turn 才能开始新的恢复资格。
- **[negative] Project 启动 hook 两次失败与 NUL 运行态**：把宿主 hook 的失败事件与项目入口、运行态文件和成功 receipt 分层核对；对仅含 NUL 的派生状态先保留证据再重建，绝不把后续 claim/长路径阻塞误记为已证实的 hook 根因。

## 记录明细

| 时间 | 极性 | 状态 | 标题 | 证据/动作 |
|---|---|---|---|---|
| 2026-09-15T12:51:20.462Z | negative | recorded | 项目任务进入时 dashboard 未自动启动 | 11_tools/research-dashboard/server.mjs:25 仅在 server.mjs 作为进程启动时监听 4317；package.json 的 research-dashboard 入口没有自动启动钩子；2026-09-15 项目内检查：127.0.0.1:4317 无监听进程并返回 ERR_CONNECTION_REFUSED；farmer status 显示 farmer running；P1 增加独立 ProcessSupervisor，自动 ensure farmer 和 dashboard；dashboard 不可访问时在 supervisor 状态和总进度中显式显示 blocked；补充 session-entry、dashboard health 和失败恢复测试 |
| 2026-09-17T03:48:21.882Z | positive | recorded | 独立监督器启动并恢复 dashboard | 11_tools/project-supervisor/README.md；tests/project-supervisor.test.mjs；05_reports/review/20260917_project_supervisor/detailed_report_zh.md；保留 hook 信任和宿主投递的待验收状态，不把 handler 测试冒充端到端验收 |
| 2026-09-18T05:22:00Z | negative | recorded | 自动恢复必须有持久停用开关和 event 熔断 | 00_project/traceability/incidents/FARMER-INCIDENT-20260918.json；tests/farmer.test.mjs；tests/farmer-control-cli.test.mjs；codex queue --help；farmer 读取 control.json；ProjectSupervisor/hooks 尊重 disabled；max_attempts 默认 3；queue-stuck 只允许新 turn 或 manual retry 清除 |
| 2026-09-22T00:00:00Z | negative | recorded | 恢复成功后仍持续投递 farmer resume | 00_project/traceability/incidents/FARMER-INCIDENT-20260918.json；_work/current/farmer/state.json；.codex/skills/farmer/farmer.mjs；tests/farmer.test.mjs；git commit 3d05b34；增加 recovery.lock，串行化 farmer queue evaluator；在调用 codex queue 前写入 queue reservation，崩溃后由 watchdog 熔断；task_complete 成功时关闭 recovery_chain_active；忽略时间戳早于已处理事件的旧失败事件；增加并发锁、reservation、乱序事件和成功后不再恢复的回归测试；保持 emergency pause，待用户 review 后再做受控 live canary |
| 2026-09-23T04:02:00Z | negative | recorded | 恢复 turn 启动后仍按旧失败链重复投递 | 当前 session rollout：01a0c2b5-5c91-7d33-9d15-ba73a6cc5a8a；2026-09-23 03:37:01、03:38:28、03:38:38 的三条 [farmer resume]；_work/current/farmer/state.json：attempts=3、recovery_chain_active=true；farmer live status：owner process 已停止，pause 已恢复；npm test：199 项通过；task_started 后写入 recovery_satisfied=true、recovered_turn_id，并关闭 recovery_chain_active；同一 recovered_turn_id 的后续 transient failure 记录 failure-after-recovery，不再 queue；记录 rollout mtime、rollout size 和 process_health，区分 running、writing、complete、not-observed；未再观察到的旧 active state 标记为 session-unavailable，避免伪装成正常运行；继续保持 emergency pause，待用户 review 修复后的 canary 结果后再恢复正常监督 |
| 2026-09-29T19:42:36.633Z | negative | recorded | Project 启动 hook 两次失败与 NUL 运行态 | 00_project/traceability/incidents/HOOK-INCIDENT-20260930.json；00_project/traceability/incidents/HOOK-INCIDENT-20260930-screenshot.png；_work/current/project-supervisor/events.jsonl；11_tools/project-supervisor/runtime-store.mjs；已保留损坏运行态文件、恢复 farmer、回收过期且干净的 claim、启用仓库局部 Git 长路径并验证后续真实 UserPromptSubmit receipt；未来再现时先收集展开的 Hook Stats stderr/exit/time，再按 README 的受限恢复顺序处理；若 NUL 复发，再实现带测试的派生状态隔离恢复 |

## 高频标签

- farmer: 4
- circuit-breaker: 2
- project-supervisor: 2
- recovery-loop: 2
- autostart: 1
- bootstrap: 1
- dashboard: 1
- evidence-boundary: 1
- hooks: 1
- incident-containment: 1
- live-canary: 1
- nul-json: 1
- process-health: 1
- queue-deduplication: 1
- queue-race: 1
- runtime-gap: 1
- success-after-recovery: 1
- task-started: 1
