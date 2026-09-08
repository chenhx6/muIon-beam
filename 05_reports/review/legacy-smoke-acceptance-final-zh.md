# 历史迁移实例验收记录（待人工签收）

状态：保留原迁移版本；技术副本校验通过；人工签收待定；整体迁移等待旧工作区阶段完成。

## 本轮核对

- 运行：`RUN-LEGACY-SMOKE-001-stage1-centered`。
- 已迁移本地副本：293/293 与原迁移 SHA256 一致。
- 已迁移 Drive 副本：293/293 与原迁移 SHA256 一致。
- 旧工作区继续修改的文件：`BuildCenteredCoolingModel.java`、`RunCenteredCoolingScan.java`、`make_centered_cooling_threshold_plot.ps1` 和 `scripts/README.md`。
- 按用户决定，上述后续变化均未采用；已迁移副本和已发布版本保持原样。
- 未复制新版本，未改变原迁移哈希；校验工具未对旧源执行写入。
- 科学重新验证：未进行。副本一致性不代表物理模型有效性或最终人工验收通过。

证据：[本轮只读校验](evidence/retained-baseline-20260908.json)。

## 后续签收条件

1. 用户确认旧工作区的气体密度—冷却关系图阶段任务完成。
2. 重新盘点增量，提供旧迁移版本与新版本的对照及明确选用范围。
3. 按确认范围建立新修订，保留历史版本和父子关系。
4. 验证报告、图表、模型和运行映射后，由用户完成最终签收。

当前 `migration_complete=false`、`human_acceptance=pending`。不自动删除旧原件。
