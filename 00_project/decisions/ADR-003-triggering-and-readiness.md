# ADR-003：Skill 触发边界与研究启动门

状态：审查后确认

## 触发边界

- `evolution` 是唯一用户显式触发的能力。它只发现、评估和报告候选；只有用户明确采用后，候选才可进入项目技能或脚本。
- `06_external_lib/` 是 Codex 查询型参考图书馆，不是日常执行层，不自动导入 `.codex/skills`，不自动运行其中脚本或安装器。
- `muion-project`、`research-workflow`、3D、COMSOL、Geant4 和 farmer 由项目任务阶段自动选择或由模块入口记录状态。npm/Node 命令是实现入口，不代表用户必须逐个手动触发。
- `external-lib-sync` 只负责图书馆清单、哈希、Drive 归档和 Gitee 允许范围；它不代表能力采用。

## 当前可执行链

`task:begin -> preflight -> task card/user confirmation -> run snapshot -> research contract -> module execution -> validation/diagnosis -> reports -> Drive/Gitee sync -> task close`。

Research Workflow 负责合同和统一状态闭环；项目级 `autopilot` 现在负责把一次性启动 intake、顺序共识审查、任务卡、模型检查、run snapshot、双报告、QA 和归档串成可恢复状态机。正式研究必须经过该项目层门禁；直接模块入口只适合受控兼容、诊断和 smoke 场景。

## 启动结论

- F0/F1 的任务卡、合同校验、smoke、诊断和小规模验证可以启动。
- 正式生产运行必须由 autopilot 通过模型指纹检查、run snapshot、双报告、ultraqa、Drive/Gitee 三端校验和关闭请求门。
- 若 3D 任务需要安装 `pywin32`/`comtypes`，当前 `sw_preflight.py` 仍是交互式授权入口；它不应在无人值守自动链中直接运行，除非纳入项目 allowlist 的工具链恢复。
