# ADR-001：项目边界和归档职责

状态：已确认

## 决定

- `D:\muIon-beam` 是新项目唯一工作区。
- `D:\muIon` 的旧任务已完成，允许精选复制和校验；原件在迁移验收完成前保持不变。
- `C:\AAA\muIon` 废弃。
- Gitee 保存源码、Manifest、索引、报告和重要小型结果。
- Google Drive `H:\我的云端硬盘\muIon_archive` 保存完整模型、原始输出和大型过程资料。
- Manifest 是事实源，SQLite 和 Markdown/CSV 都由 Manifest 生成。

## 影响

旧工作区迁移使用独立 Manifest；迁移不会改变旧工作区原件，也不会把历史结果自动视为新物理验证。
