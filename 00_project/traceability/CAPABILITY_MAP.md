# 能力对照表

由 capability-map.yaml 生成，请勿手工编辑。

| 能力 | 决策 | 主要入口 | 原因 |
|---|---|---|---|
| plan | extend | muion-project:plan | 保留任务卡入口，增加澄清与共识门 |
| preflight | merge | npm run preflight | doctor 复用既有 preflight 和模型检查 |
| report-and-sync | reuse | npm run publish:and-sync | 已有发布、归档和三端审计闭环 |
| deep-interview | new | deep-interview | 补充可恢复的需求澄清阶段 |
| ultragoal | new | ultragoal | 补充持久目标和检查点 ledger |
| team | new | team | 补充子 agent 派发与动态模型路由规范 |
| farmer | new | farmer | 项目专属 Codex Desktop session 监督 |
| evolution | new | evolution | 手动触发的跨项目能力发现和增量接入 |
| comsol-block | new | node comsol/index.mjs --task path/to/task.json | 建立独立 COMSOL 计算模块；保留现有历史 COMSOL 资产并通过显式 adapter 接入 |
| geant4-block | new | node geant4/index.mjs --task path/to/task.yaml | 建立单一 Geant4 主 Skill，覆盖 setup/transport/scoring/statistics/validation，并以小规模 smoke 优先 |
| research-state | new | node research-state/index.mjs status | Shared current research state for workflow, direct modules, validation and diagnosis |
| research-workflow | new | node research-workflow/index.mjs execute | Single research decision layer over existing 3D, COMSOL and Geant4 Blocks |
