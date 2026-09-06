# ADR-001：项目边界和归档职责

状态：已确认

## 决定

- `D:\muIon-beam` 是新项目唯一工作区。
- `D:\muIon` 当前仍在执行旧任务，不在本次架构实施和迁移范围内。
- `C:\AAA\muIon` 废弃。
- Gitee 保存源码、Manifest、索引、报告和重要小型结果。
- Google Drive `H:\我的云端硬盘\muIon_archive` 保存完整模型、原始输出和大型过程资料。
- Manifest 是事实源，SQLite 和 Markdown/CSV 都由 Manifest 生成。

## 影响

旧工作区的迁移必须作为后续独立任务，不能因为新项目初始化而改变旧任务的当前状态。
