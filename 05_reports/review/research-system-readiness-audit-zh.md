# 研究启动前基础设施审计

审计范围包括 `.codex/skills/`、`07_research_system/`、`00_project` 项目脚本、任务关闭与归档脚本、`06_external_lib` 参考图书馆和现有测试。

## 触发方式

| 层级 | 入口 | 触发方式 | 实际职责 |
|---|---|---|---|
| Codex Skill | `muion-project` | 项目任务自动选择 | 任务卡、preflight、运行、报告、归档和交付策略 |
| Codex Skill | `research-workflow` | 研究目标或模块路由自动选择 | 合同、路由、状态、诊断和下一项研究决策 |
| Codex Skill | `3d`、`comsol`、`geant4` | 任务类型自动选择或直接 CLI | 各自自治的几何、场和输运执行 |
| Session supervisor | `farmer` | 项目进入时 `ensure`，之后周期检查 | 瞬态 session 恢复；不发布、不改目标 |
| 参考图书馆 | `06_external_lib` | Codex 查询；不是执行入口 | 外部资料、能力边界和设计思想参考 |
| 外部能力采用 | `evolution` | 仅用户显式触发 | 候选发现、许可证/哈希/测试审查和采用建议 |
| 交付事件 | `sync-project`、`sync-three-end`、`task-close` | 由项目编排阶段调用 | Drive/Gitee/本地状态校验 |

## 已修复的问题

- Git 重命名状态现在通过 `--porcelain=v1 -z` 统一解析；任务基线、delivery plan、自动提交和同步收据不再把 `old -> new` 当成单一路径。
- Research Workflow 和直接模块入口在冻结合同前检查前台 context，冲突时不再留下孤立合同实例。
- 合同和任务 ID 拒绝路径穿越字符；Evolution 记录 ID 同样受安全字符约束。
- Evolution 记录写入真实换行，历史无效记录已修正为合法 JSON。
- 项目索引器忽略本地 `3d-smoke` 状态，并在 durable 文件解析失败时返回失败；当前索引和 SQLite 构建无解析错误。
- Drive 运行归档遇到同名不同哈希文件时停止并进入 pending，不再覆盖已有归档。
- `up`/workflow 状态读取不再初始化存储；损坏的 research-state 返回 `blocked/state-audit`，不会被伪装成 idle。
- preflight 增加 canonical `07_research_system` 布局和 research-state 可读性检查。

## 仍需在正式生产运行前处理的门

1. `autopilot`、`deep-interview`、`consensus-plan`/`ralplan`、`ultragoal` 和 `ultraqa` 已有项目原生可执行入口，并通过 workflow ledger 与 research-state 事件恢复；`autoresearch`、`best-practice-research` 等仍是 Skill 路由能力。
2. autopilot 现在强制把 task card、模型指纹、run snapshot、不可变 contract、双报告、QA 和归档收据作为连续阶段门；直接模块入口仍不具备发布和关闭权限。
3. `task-close` 请求只在通过 ultraqa、报告和三端同步校验后生成，`qa_passed` 来自实际 QA artifact。
4. 3D `sw_preflight.py` 对 `pywin32`/`comtypes` 使用交互式安装确认，尚未接入项目 allowlist 工具链恢复。无人值守 3D 正式任务应先解决这一点。
5. 模型指纹检查目前是独立命令 `models:check`，不是基础 `preflight` 的阻断门；正式运行前必须显式运行并记录其结果。

## 结论

当前基础设施适合开始 F0/F1 任务卡、合同校验、smoke、诊断和小规模验证。正式生产研究的启动条件是：一次性 intake 已确认、共识 handoff 完整、模型指纹无未处理变化、run snapshot 已固定、合同已冻结、双报告和 ultraqa 证据齐全、Drive/Gitee/本地收据通过，并由统一关闭流程生成可追溯的关闭记录。

本审计未修改模型、研究目标、物理参数或历史运行结论。
