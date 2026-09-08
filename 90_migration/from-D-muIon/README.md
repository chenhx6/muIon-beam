# 旧工作区迁移占位

`D:\muIon` 正在继续气体密度—冷却关系图任务。用户已决定保留原迁移版本，后续源文件修改暂不采用；当前允许只读核对，暂停增量复制。原件不删除、不整理、不重命名。

`MIGRATION-LEGACY-20260907-STAGE1` 已产生一批迁移实例，但整体迁移状态为 `awaiting-legacy-phase-completion`，人工最终验收尚未完成。版本选择及观测哈希见 `00_project/decisions/legacy-source-change-decision.json`。待用户确认旧任务阶段完成后，再按以下顺序处理增量：

```text
source-index
  → selected-tasks
  → imported-runs
  → migration-notes
  → formalize
```

迁移时保留原始路径、原始时间、来源文件、已知版本和缺失字段。不能根据文件名猜测历史参数。
