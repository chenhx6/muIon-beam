# 工作流

## 任务开始

1. 确认当前路径是 `D:\muIon-beam`。
2. 判断任务来源：外部交办、自主研究或维护。
3. 生成任务卡。
4. 汇报初始条件、目标、变量、输出和成功判据。
5. 用户核实后继续任务范围内的模拟和建模。

## 运行

任务关闭前生成 delivery plan。源代码、skill、schema、测试、Manifest、报告和轻量里程碑默认进入 Gitee，并同步到 Drive 项目快照；模型、完整运行输出和大型图集进入 Drive；本地基线、锁、缓存和生成环境不进入交付。

运行开始前固定输入、参数、代码和模型快照。运行目录只能引用已经登记的版本。用户在运行期间修改原始模型时，当前运行继续使用快照，新版本进入下一次运行。

## 报告

每个正式运行同时维护：

- `summary-report-zh.md`：任务完成后的简洁总结，与 Gitee 标签说明保持一致；
- `detailed-report-zh.md`：过程汇报、调试节点、变量行为和最终设计分析。

## 归档

Drive 归档验证成功后，再生成索引、提交 Gitee 中应保存的内容、创建中文标签说明，并把 commit/tag 写回归档记录。

任务完成、报告定稿、迁移完成和发布完成后调用 `sync-three-end`。失败状态写入 `sync-outbox`，由 `retry-sync-outbox.mjs` 在下一次明确触发时重试；只读漂移检查使用 `audit-three-end.mjs`。

若需要一键闭环，使用 `publish-and-sync.mjs`；它按“发布 → Drive 归档 → 三端状态 → Gitee 状态提交”的顺序执行。

普通项目更新不创建科学结果 tag。正式结果必须在双报告、Drive SHA256、Gitee ref 和三端审计全部通过后创建 tag。任一必需动作失败时任务保持 pending，并由 outbox 记录下一步。

从 Gitee 或 Drive 恢复时，必须能够读取最新任务、里程碑、Manifest、报告和源文件引用，并重建轻量结果；每个重要里程碑记录 source commit、result/report files、SHA256 和 rebuild commands。

项目规则、skill、Manifest 和 SQLite 快照使用 `sync-project-snapshot.mjs` 写入 `project-management/project-snapshots/SNAPSHOT-<commit>`；运行资料使用 `sync-three-end.mjs` 写入 `simulation-runs/RUN-...`。两类快照都可由对应的只读 audit 脚本检查。
