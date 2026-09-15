# 经验汇总：runtime-supervision

- 生成时间：2026-09-15T12:52:22.651Z
- 经验条数：1
- 正向：0；负向：1；中性：0

## 可共享结论

- **[negative] 项目任务进入时 dashboard 未自动启动**：进程存活、状态可读和 dashboard 可访问必须分别验收；farmer 正常不能推断 dashboard 已启动。

## 记录明细

| 时间 | 极性 | 状态 | 标题 | 证据/动作 |
|---|---|---|---|---|
| 2026-09-15T12:51:20.462Z | negative | recorded | 项目任务进入时 dashboard 未自动启动 | 11_tools/research-dashboard/server.mjs:25 仅在 server.mjs 作为进程启动时监听 4317；package.json 的 research-dashboard 入口没有自动启动钩子；2026-09-15 项目内检查：127.0.0.1:4317 无监听进程并返回 ERR_CONNECTION_REFUSED；farmer status 显示 farmer running；P1 增加独立 ProcessSupervisor，自动 ensure farmer 和 dashboard；dashboard 不可访问时在 supervisor 状态和总进度中显式显示 blocked；补充 session-entry、dashboard health 和失败恢复测试 |

## 高频标签

- autostart: 1
- dashboard: 1
- farmer: 1
- project-supervisor: 1
- runtime-gap: 1
