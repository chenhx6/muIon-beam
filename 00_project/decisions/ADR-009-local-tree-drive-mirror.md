# ADR-009：Google Drive 采用本地项目树镜像

状态：用户确认设计方向，2026-09-22。细化 ADR-006/007 的 Drive 布局，不立即执行删除。

## 决定

Google Drive 的 canonical backup 直接镜像当前 `D:\muIon-beam` 项目的相对目录结构。Drive 不再为每个 Git commit 复制一份完整项目树；版本历史由 Gitee Git history 保存，Drive 只保存当前可恢复镜像、必要的大型文件和一份同步 Manifest。

目标布局：

```text
H:\我的云端硬盘\muIon_archive\muIon-beam\
  .codex/                # skills、hooks、schemas 等 durable assets
  00_project/            # ADR、Manifest、计划、索引、经验、sync receipt
  01_physics/
  02_models/             # 源码和需要 Drive 快速恢复的大型模型
  03_runs/               # 已登记运行和需要恢复的输出
  04_results/
  05_reports/
  06_external_lib/
  07_research_system/
  08_references/
  09_catalog/
  10_plans/
  11_tools/
  90_migration/          # 历史迁移资料
  AGENTS.md
  README.md
  REPRODUCIBILITY.md
  drive-mirror-manifest.json
```

以下内容不进入 Drive 镜像：`.git/`、`_work/`、缓存、临时文件、session lock、未验证 outbox、node_modules、构建目录和可重建的中间产物。大型模型和完整运行结果不因体积大而改变相对路径；是否进入镜像由 Manifest 和 retention policy 决定。

## 为什么不再复制完整 snapshot 树

Git 已经保存 durable project assets 的版本历史；Drive 的目标是本地磁盘损坏后直接恢复工作树。每个 commit 复制一份完整项目会产生大量重复文件，旧的 `project-management/project-snapshots/` 与新的 `project/snapshots/` 并存就是当前复杂度的主要来源。新方案保留必要的 sync receipt 和 Gitee commit 指针，避免把备份目录变成第二套版本控制系统。

## 迁移与清理门

现有 `project-management/project-snapshots/`、`project/snapshots/`、`legacy-from-D-muIon/` 和其他目录先保持不变。先生成 local-tree mirror plan，复制并逐文件校验到 `muIon-beam/`，确认 Google Drive connector 能看到镜像根、Manifest 和 recovery index，再将确认重复的旧 snapshot 树移动到 `legacy/` 或 `quarantine/`。删除仍需数量、大小、SHA256、依赖和唯一内容检查，并保存 deletion receipt。

在 Google Drive 云端可见性未确认前，不得把 H: 映射盘存在当作云端备份成功，也不得删除旧目录。

2026-09-22 用户授权清理历史垃圾后，已将旧 `project-management/project-snapshots` 和 canonical mirror 中不再属于当前 retention policy 的 runtime/state 内容移入 `quarantine/DRIVE-QUARANTINE-20260922`。这是可恢复隔离，不是永久删除；永久删除仍需云端可见性、无索引内容复核和 receipt 校验。

## 影响

- 恢复入口变成“clone Gitee + 从 Drive 取同一相对路径的项目镜像”，不需要猜测 `project-management`、`simulation-runs` 和多层 snapshot 的关系。
- Gitee 与 Drive 的目录可以直接对照；差异由 `drive-mirror-manifest.json` 和 Git commit 标识。
- 历史 snapshot 仍可保留为审计证据，但不再是新任务的活动输入。
