# 文件保留和清理

Gitee/Drive 交付分层：P0 durable project assets 进入 Gitee 并同步 Drive；P1/P2 大型模型、运行和有价值结果完整进入 Drive；P3 runtime state 只保留本地。`task-baseline.json`、farmer lock、session state、`00_project/state/3d-smoke/` 和未验证 outbox 不属于项目发布内容。

## 等级

- `P0`：规则、skill、schema、Manifest、变量目录、任务卡、源码和索引脚本。Gitee、Drive、本地都保留，永不自动删除。
- `P1`：正式模型、正式运行、里程碑结果、双版本报告和关键图。Drive 保留完整文件，本地保留当前版本和重要里程碑，不自动删除。
- `P2`：中间扫描、诊断日志、可再生网格和失败但有价值的结果。普通文件只列候选，可再生缓存按 LRU 和空间阈值动态清理。
- `P3`：锁文件、自动恢复文件、编译目录、临时导出、空输出和重复临时文件。无活动进程和锁文件后可自动删除。

正常任务结束只生成清理候选，不做全盘扫描。只有磁盘低于 20%、缓存超过上限或用户主动维护时，才执行定向缓存清理。
