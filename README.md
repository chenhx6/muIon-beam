# muIon-beam

这是 muon-ion beam 新项目的唯一工作区。项目目标是围绕 μ⁻ 的形成、俘获、电荷态转换、快速抽取、加速、输运和靶反应建立可追溯的物理、模型、运行和报告体系。

## 当前边界

- 新项目工作区：`D:\muIon-beam`
- 旧工作区：`D:\muIon`，当前任务继续在那里执行，暂不迁移
- 已废弃工作区：`C:\AAA\muIon`
- Gitee：`https://gitee.com/chx6/muIon-beam.git`
- Google Drive：`H:\我的云端硬盘\muIon_archive`

## 使用顺序

1. 读取 `AGENTS.md`。
2. 使用 `.codex/skills/muion-project` 的 `plan` 或 `fast-run` 模式创建任务记录。
3. 运行 `preflight` 检查当前路径、用户修改、模型版本和大文件。
4. 正式运行放入 `03_runs/formal`，快速任务放入 `03_runs/fast-track`。
5. 运行结束后生成 `summary-report-zh.md` 和 `detailed-report-zh.md`。
6. 由 Manifest 生成 SQLite、Markdown/CSV 索引。
7. 归档到 Google Drive 并完成 Gitee 标签和中文说明。

## 物理区域

`R01` 至 `R06` 只用于物理定义和索引。一次运行涉及多个区域时，在运行 Manifest 的 `physical_regions` 中列出多个区域，不复制运行文件。

## 重要约定

Manifest 是事实源，生成的索引不是事实源。变量目录使用 `00_project/traceability/variable-catalog.yaml`，其人读视图为自动生成的 `VARIABLE_CATALOG.md`。
