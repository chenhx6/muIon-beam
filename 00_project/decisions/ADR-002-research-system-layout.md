# ADR-002：研究系统目录布局

状态：已确认

研究控制层与执行 Block 统一放置于 `07_research_system/`，内部按 `control/` 与 `blocks/` 分层。旧根目录入口退役；`.codex/skills/` 仅保留发现包装器。`00_project/` 继续只负责治理、Manifest、Schema、索引和归档。

`control/research-state/state.yaml` 是唯一当前科研状态源；`control/contracts/instances/` 保存不可变合同实例。历史 Manifest、报告和迁移记录保留其原始路径字符串，不因目录迁移而改写。
