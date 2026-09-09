# 能力对照表

由 capability-map.yaml 生成，请勿手工编辑。

| 能力 | 决策 | 触发模式 | 执行类型 | 主要入口 | 原因 |
|---|---|---|---|---|---|
| plan | extend | automatic | skill | muion-project:plan | 保留任务卡入口，增加澄清与共识门 |
| preflight | merge | unspecified | unspecified | npm run preflight | doctor 复用既有 preflight 和模型检查 |
| report-and-sync | reuse | unspecified | unspecified | npm run publish:and-sync | 已有发布、归档和三端审计闭环 |
| deep-interview | extend | automatic | control-script | npm run deep-interview | 一次性启动 intake、可恢复 handoff 和任务卡 skip |
| consensus-plan | new | automatic | control-script | npm run consensus-plan | 持久化 Planner/Architect/Critic 顺序审查与执行交接 |
| ultragoal | new | automatic | control-script | npm run ultragoal | 补充持久目标和检查点 ledger |
| ultraqa | new | automatic | gate-wrapper | npm run ultraqa | 将架构、Manifest 和变量校验形成可追溯 QA 门 |
| autopilot | extend | automatic | orchestrator | npm run autopilot | 固定阶段顺序、恢复 RUNNING 尝试并串联项目门禁 |
| team | extend | automatic | skill | node .codex/skills/team/scripts/dispatch.mjs | 在既有 team capability 上增加 dispatch manifest、ready-wave 冲突检查、角色/能力路由、stale fallback、durable ledger、evidence gate、科研证据 bundle、本地 telemetry 和 cooperative resource lock；不新建 orchestration system |
| farmer | new | automatic | supervisor | farmer | 项目专属 Codex Desktop session 监督 |
| evolution | new | manual | skill | evolution | 手动触发的跨项目能力发现和增量接入 |
| comsol-block | new | automatic | execution-block | node 07_research_system/blocks/comsol/index.mjs --task path/to/task.json | 建立独立 COMSOL 计算模块；保留现有历史 COMSOL 资产并通过显式 adapter 接入 |
| geant4-block | new | automatic | execution-block | node 07_research_system/blocks/geant4/index.mjs --task path/to/task.yaml | 建立单一 Geant4 主 Skill，覆盖 setup/transport/scoring/statistics/validation，并以小规模 smoke 优先 |
| research-state | new | automatic | control-layer | node 07_research_system/control/research-state/index.mjs status | Shared current research state for workflow, direct modules, validation and diagnosis |
| research-workflow | new | automatic | control-layer | node 07_research_system/control/research-workflow/index.mjs execute | Single research decision layer over existing 3D, COMSOL and Geant4 Blocks |
| toolchain-recovery | new | unspecified | unspecified | npm run toolchain:ensure | Routine allowlisted user-scoped dependency recovery is separate from manual evolution |
| sync-receipt-audit | new | unspecified | unspecified | npm run sync:receipt:audit | Precisely verify and adopt historical sync receipts without bypassing baseline protection |
