# muIon-beam

这是 muon-ion beam 新项目的唯一工作区。项目目标是围绕 μ⁻ 的形成、俘获、电荷态转换、快速抽取、加速、输运和靶反应建立可追溯的物理、模型、运行和报告体系。

## 当前边界

- 新项目工作区：`D:\muIon-beam`
- 旧工作区：`D:\muIon`，已完成任务，按精选规则 copy-only 迁移并保留原件
- 已废弃工作区：`C:\AAA\muIon`
- Gitee：`https://gitee.com/chx6/muIon-beam.git`
- Google Drive：`H:\我的云端硬盘\muIon_archive`

## 当前模块入口

- 研究系统统一位于 `07_research_system/`，按 `control/`（contracts、research-state、research-workflow）和 `blocks/`（3d、COMSOL、Geant4）分层。
- 3D Block：[`07_research_system/blocks/3d/SKILL.md`](07_research_system/blocks/3d/SKILL.md)，Codex 入口为 `.codex/skills/3d/`。
- COMSOL Block：[`07_research_system/blocks/comsol/SKILL.md`](07_research_system/blocks/comsol/SKILL.md)，可执行入口为
  `node 07_research_system/blocks/comsol/index.mjs --task path/to/task.json`；当前适配器边界见
  [`07_research_system/blocks/comsol/adapters/README.md`](07_research_system/blocks/comsol/adapters/README.md)。
- Geant4 Block：[`07_research_system/blocks/geant4/SKILL.md`](07_research_system/blocks/geant4/SKILL.md)，可执行入口为
  `node 07_research_system/blocks/geant4/index.mjs --task path/to/task.yaml`；四项轻量原生 smoke
  位于 `07_research_system/blocks/geant4/tests/fixtures/mvp-smoke/`。当前 WSL smoke 使用 Geant4
  11.2.2，不能直接替代历史 11.3.2 μ−–Ne 结果。
- Research Workflow 控制层：[`07_research_system/control/research-workflow/SKILL.md`](07_research_system/control/research-workflow/SKILL.md)，负责目标、物理推理、routing、合同、诊断和下一项研究决策。
- Research State：[`07_research_system/control/research-state/index.mjs`](07_research_system/control/research-state/index.mjs)，是 3D、COMSOL、Geant4、validation 和 Research Workflow 共享的当前科研状态边界；直接入口也必须记录 context。

## 使用顺序

1. 读取 `AGENTS.md`。
2. 使用 `.codex/skills/muion-project` 的 `plan` 或 `fast-run` 模式创建任务记录。
3. 运行 `preflight` 检查当前路径、用户修改、模型版本和大文件。
4. 正式运行放入 `03_runs/formal`，快速任务放入 `03_runs/fast-track`。
5. 运行结束后生成 `summary-report-zh.md` 和 `detailed-report-zh.md`。
6. 由 Manifest 生成 SQLite、Markdown/CSV 索引。
7. 归档到 Google Drive 并完成 Gitee 标签和中文说明。

## 自动工作流入口

进入本项目任务时，项目会幂等确保 farmer 监督进程运行。可使用：

    node .codex/skills/farmer/farmer.mjs ensure
    node .codex/skills/muion-project/scripts/up.mjs .

工作流阶段由项目 skill 自动衔接；只有需要主动发现和吸收外部能力时才调用 evolution。常用检查命令包括 farmer:status、farmer:once、test:agent-routing 和 test:evolution。

## 物理区域

`R01` 至 `R06` 只用于物理定义和索引。一次运行涉及多个区域时，在运行 Manifest 的 `physical_regions` 中列出多个区域，不复制运行文件。

## 重要约定

Manifest 是事实源，生成的索引不是事实源。变量目录使用 `00_project/traceability/variable-catalog.yaml`，其人读视图为自动生成的 `VARIABLE_CATALOG.md`。
