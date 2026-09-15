# Handoffs

本目录保存各阶段的机器交接物。每个交接物必须包含：

- 输入 commit、Manifest 或 contract 引用；
- 产生它的 session、branch 和 worktree；
- changed paths、文件数量和 SHA256；
- 测试、QA、阻塞原因和下一步；
- 是否可以继续、需要恢复、需要 leader 集成或需要用户决定。

P0 计划阶段暂不创建执行 handoff。P1 以后由 `ProjectSupervisor` 自动写入。
