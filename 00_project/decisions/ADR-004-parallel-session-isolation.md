# ADR-004：并行 session 的隔离、认领与集成

## 决策

项目采用“独立 worktree + 路径 claim + leader 集成门”的并行模型。

- 写任务默认创建 `_work/current/worktrees/<session_id>`，分配 `codex/session/<session_id>` 分支。
- 显式适配器的写任务声明 `ownedPaths`；省略时默认认领整个 checkout。2026-09-17 的自动 SessionBootstrapper 对未知独立性使用 `isolated_overlap`：只有双方都是私有 worktree 且均声明这种模式，才容许重叠 claim，冲突留到串行集成门解决。
- 有明确 ownership 的 active session 对重叠文件或目录 claim 直接拒绝。共享 checkout writer 始终不适用 overlap 例外。大小写、`..`、目录尾斜杠和 glob 别名先规范化，避免 Windows 路径别名绕过检查。
- worktree 创建、session registry、ownership registry 和 leader integration 分别使用项目本地锁。
- worker 只在自己的 branch 上 checkpoint；只有 leader 在 `leader-integration` 和 `leader-delivery` 锁下合并、测试、提交、推送或归档。
- 合并冲突保留 worker worktree 和分支，写入 blocked receipt，不使用 `ours/theirs` 静默覆盖。
- `research-state/state.yaml` 继续是唯一科研状态源；并行 session 的运行账本属于 `_work/current`，不形成第二科研状态。

## 来源比较

本决策吸收了固定版本 oh-my-codex v0.21.4（MIT，commit `304fb3b4825c4132c273732b14d2d5e86b54f8e3`）的默认 worker worktree、带 token 的 session lease、任务锁、canonical state root 和顺序集成设计，也吸收了 claude-fleet（MIT，commit `453d58376ec5b5dd5901092042ee31f60b401d0b`）的“不相交是启动前置条件”、串行创建 worktree、顺序 merge gate、崩溃回收和远端 CAS 认领思想。任务级 expected-version queue 尚未移植；当前 Node 层的并发边界是 session owner token + path claim。

不复制上游 launcher、tmux、shell 安装器、外部 agent runtime、OS sandbox 或自动 `ours/theirs` 冲突解决。Windows/Node 环境目前能可靠提供的是本地原子锁、Git worktree 隔离、路径 claim、提交边界和 leader 集成门；任意子进程写入的 OS 级 sandbox 仍是后续能力。

## 运行边界

`session-concurrency.mjs` 是项目自己的薄适配层，负责 admission、baseline、heartbeat、检查、提交回执和集成门。它不替换 `research-workflow`，不改变冻结 contract，也不自动启动 Codex Desktop 子进程。

状态、baseline、claim 和 lock 均是可恢复的本地 runtime 数据；关闭前必须确认 worktree clean，脏 worktree 不能被自动回收。

## 验证

`tests/session-concurrency.test.mjs` 覆盖路径别名、独立 worktree、同文件拒绝、不同文件并行、legacy whole-workspace claim、越权写入检查和脏 worktree 提交门。
