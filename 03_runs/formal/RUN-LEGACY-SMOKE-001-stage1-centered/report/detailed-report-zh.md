# 详细版过程汇报：旧工作区迁移冒烟测试

## 1. 任务目标和范围

本次测试使用已经完成的旧工作内容，验证新项目的数据结构和追溯流程。测试不重新运行 COMSOL 或 Geant4。

## 2. 输入、模型和迁移关系

- 旧工作区：`D:\muIon`
- 迁移 Manifest：`90_migration/from-D-muIon/migration-manifest.json`
- 任务 Manifest：`00_project/task-cards/TASK-LEGACY-SMOKE-001.task-manifest.json`
- 模型 Manifest：`02_models/model-manifests/MODEL-LEGACY-SMOKE-001.model-manifest.json`
- 运行 ID：`RUN-LEGACY-SMOKE-001-stage1-centered`

## 3. 历史物理问题

旧报告研究自由 μ− 在 Ne 和均匀轴向磁场中的横向冷却、四环电极场作用和轴向输运。历史报告明确说明：缪原子形成、电子剥离、核俘获、真实 μ− 衰变权重和正式击穿验证尚未纳入。

## 4. 文件和数据验收

- 迁移文件总数：293
- 选中文件总字节数：190563528
- JSON 文件检查：13 个
- CSV 文件检查：29 个
- 图件检查：15 个
- 模型文件检查：7 个
- 文件 SHA256：全部一致

## 5. 变量—行为关系登记

本次从历史报告登记了 Ne 密度—冷却、电场—加速和孔径—局部场/接受度三个分析问题。图件只作为历史证据引用，不重新生成，也不强制将未研究关系扩展为新分析。

详见：

- [figure-manifest.json](figure-manifest.json)
- [behavior-analysis.json](behavior-analysis.json)
- [历史报告](05_reports/interim/legacy/reports/stage1_centered_source_100ns_cooling_extraction_report.md)

## 6. 迁移结论

迁移文件、任务关系、模型关系、运行关系和报告图件索引均已建立。

## 7. 限制

- `scientific_revalidation: not-performed`；
- 历史结果不能直接当作新项目的实验验证；
- 历史报告中的路径仍保留其旧上下文；
- 模型二进制只记录指纹，不在本次测试中打开或重算。

## 8. 后续实例验收

需要人工确认旧任务到新任务、历史模型、运行、报告和图件之间的映射是否符合项目实际含义。
