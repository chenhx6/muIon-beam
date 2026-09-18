# ADR-008：farmer 紧急停用与恢复熔断

状态：用户确认后执行，2026-09-18。

## 背景

farmer 在容量错误恢复期间出现重复 `[farmer resume]`，用户要求先停止自动恢复并保留现有任务上下文。单靠 `stop` 不够：ProjectSupervisor 或 session hook 可以再次调用 `ensure`，导致停用后重新启动。

## 决定

1. `_work/current/farmer/control.json` 是本机持久 emergency pause 开关。`disabled: true` 优先于 farmer、ProjectSupervisor 和 hooks 的所有自动启动/恢复路径；开关不进入 Git，不改变 Gitee/Drive 内容。
2. 停用期间 farmer 的 `ensure`、`start`、`once`、`retry` 都返回 disabled/paused，不写恢复队列；ProjectSupervisor entry 直接返回 disabled，不能启动 supervisor。现有 dashboard 可单独保留。
3. `max_attempts` 有界，当前默认 3。队列已接受但 watchdog 超时的 event 变成 `queue-stuck` 熔断；同一 `event_key` 不得再次发送。由 farmer 自动发送的恢复消息启动新 `task_started` 时，仍属于同一 recovery chain，不能清零 attempts；只有普通用户新输入或明确 manual retry 才能开始/清除链。
4. `cancelled`、用户暂停和 `manual-attention-required` 状态不能由轮询自动恢复。人工 retry 清除对应 event 的熔断并保留 `retry_of` 链。
5. 当前 Codex CLI 的 `codex queue` 只提供 enqueue，没有可验证的 list/cancel 接口。项目只登记已确认的 farmer 生成 message ID，不猜测删除队列，也不触碰用户手工消息。

## 证据与边界

- incident receipt：`00_project/traceability/incidents/FARMER-INCIDENT-20260918.json`；
- 隔离回归：`tests/farmer.test.mjs`、`tests/farmer-control-cli.test.mjs`；
- 真实项目停用后 farmer 进程数为 0；dashboard 由独立进程保留；
- 当前不能宣称已取消历史 Codex queue，因为宿主 CLI 未提供安全取消接口；停用和未来去重已生效。
