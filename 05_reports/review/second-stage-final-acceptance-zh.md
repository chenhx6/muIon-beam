# muon-ion beam 第二阶段最终验收报告

## 验收范围

本报告验收 `D:\muIon-beam` 的文件夹框架、任务分流、文件生命周期、精选迁移、Manifest、SQLite、模型指纹、Nature 绘图、Gitee 发布和三端同步。`D:\muIon` 只作为迁移来源读取，未被删除、整理或重命名。

## 已通过

- 项目目录、`AGENTS.md` 和 `muion-project` skill：通过。
- 精选迁移：293 个文件、约 190.6 MB，源文件 SHA256、目标文件 SHA256 和 Drive 文件 SHA256 一致。
- 迁移安全：`copy_only: true`、`preserve_source: true`，旧工作区原件保留。
- 历史冒烟实例：`TASK-LEGACY-SMOKE-001`、`MODEL-LEGACY-SMOKE-001`、`RUN-LEGACY-SMOKE-001-stage1-centered` 已建立。
- 历史冒烟实例：JSON/CSV、任务关系、模型关系、运行关系、报告和图件引用检查通过。
- SQLite：已由 Manifest 重建，当前索引包含任务、模型、运行、artifact、图和行为分析记录。
- Nature 绘图：`nature-figure` 已固定 commit `287ee37542620711a56c7c58a73f44ef5c2bede0`；Python 图源代码检查通过，PDF 文字审计通过，碰撞审计通过。
- 运行级三端同步：`r1-framework-acceptance` 对应运行返回 `three-way-verified`，230 个运行文件无 Drive 哈希差异。
- 项目级三端同步：上一版项目快照 `SNAPSHOT-a732427` 返回 `three-way-verified`；最终状态整理提交后需要在 Gitee 推送成功后创建新的项目快照。
- 缓存审计：当前没有满足清理条件的候选文件，未删除正式结果。

## 条件通过和待处理

- Gitee 历史发布标签已经存在，当前最终状态整理提交尚未推送。
- 最近一次 Git 推送返回 `Incorrect username or password`。网页登录状态没有被当前命令行 Git 凭据管理器接受。
- 本地当前提交：`fe448c6`。
- 当前远端 `main` 仍停留在上一提交，尚未包含 `fe448c6`。
- `r1-framework-acceptance` 标签已经存在并可验证，但它指向内容提交，后续状态整理提交需要在凭据恢复后推送。
- 历史科学结果仍标记为 `scientific_revalidation: not-performed`；本报告不把旧 COMSOL/Geant4 结果当作新的物理验证。

## 验收结论

项目框架、精选迁移、Manifest/SQLite、报告、图表和 Drive 运行快照已经具备结构验收条件。最终三端验收还差一个外部步骤：使用可用的 Gitee 命令行凭据推送本地 `fe448c6`，创建对应的最新 Drive 项目快照，然后重新执行 `audit-project-snapshot` 和 `audit-three-end`。

恢复命令：

```powershell
git -C D:\muIon-beam push origin HEAD:main
node D:\muIon-beam\.codex\skills\muion-project\scripts\sync-project-snapshot.mjs `
  --snapshot-id SNAPSHOT-fe448c6 `
  --tag r1-framework-acceptance `
  --drive-path H:\我的云端硬盘\muIon_archive\project-management\project-snapshots\SNAPSHOT-fe448c6
node D:\muIon-beam\.codex\skills\muion-project\scripts\audit-project-snapshot.mjs `
  --drive-path H:\我的云端硬盘\muIon_archive\project-management\project-snapshots\SNAPSHOT-fe448c6
node D:\muIon-beam\.codex\skills\muion-project\scripts\audit-three-end.mjs `
  --run-dir D:\muIon-beam\03_runs\formal\RUN-LEGACY-SMOKE-001-stage1-centered `
  --run-id RUN-LEGACY-SMOKE-001-stage1-centered `
  --tag r1-framework-acceptance `
  --drive-path H:\我的云端硬盘\muIon_archive\legacy-from-D-muIon\selected-migration-20260907-stage1\smoke-run\RUN-LEGACY-SMOKE-001-stage1-centered
```

如果推送后远端提交与本地一致，项目状态改为最终 `three-way-verified`。在此之前，不删除或清理任何正式迁移文件。
