# 自动 supervisor、并行 session 与三端恢复规划

## 规划状态

本计划只冻结设计，不开始实现，不清理 Google Drive，不改变科研目标、模型、contract 或正式运行结果。

## 目标

用户只在 Codex session 中提出任务。除 `evolution` 外，项目自动完成 farmer、dashboard、session bootstrap、worktree、dispatch、资源锁、worker 监督、结果归位、经验记录、QA、提交和三端同步。

## 阶段

### P0：契约冻结

- 冻结 `ProjectSupervisor` 及各模块接口；
- 冻结 session、worker、artifact、progress、experience、sync-recovery schema；
- 冻结权威状态归属和事件顺序；
- 明确 `evolution` 是唯一人工采用边界；
- 为每个自动动作定义成功、阻塞、失败、恢复和停止条件。

### P1：自动启动与可见性

- session 进入项目时自动 ensure farmer；
- 自动 ensure dashboard，端口默认 `127.0.0.1:4317`；
- dashboard 显示 research state、workflow、farmer、session、branch、worktree、阻塞和下一步；
- 将 session/thread identity 绑定到项目 session registry；
- 失败时明确显示“进程未启动/端口不可用/状态读取失败”，不把空页面当作正常。

### P2：自动并行执行

- 写任务自动创建独立 worktree；
- 自动生成 path claim 和 resource lease；
- 自动处理可证明并行、未知独立性和显式依赖；
- 自动 heartbeat、checkpoint、失败分类和原 session 恢复；
- 任务级 claim 使用 owner、token、version 和 lease；
- 将每个分支状态写入可重建的 worker ledger。

### P3：自动结果归位与总进度

- 识别 worktree 新输出并创建 artifact record；
- 将代码、运行、报告、轻量结果、大型原始输出提升到规范目录或 Drive；
- 对未登记输出保留、标记和阻塞清理；
- 生成按 session、branch、task、问题簇和 artifact 的 progress overview；
- 自动生成下一步和可复用经验。

### P4：自动集成、发布和恢复

- leader 在 integration/delivery lock 下顺序集成；
- 合并冲突保留现场并自动创建修复队列；
- 运行架构测试、任务测试、QA 和报告门；
- 普通代码自动 commit/push；
- 正式结果在双报告、Drive SHA256 和三端审计通过后创建结果 tag；
- 写入 recovery index，保证 Gitee clone + Drive snapshot 可以接续。

### P5：跨机器和进程级防护

- Gitee ref 或中央 registry 的远端 CAS claim；
- session/host/branch 全局唯一；
- Windows 子进程写入边界；
- worktree 外写入失败闭合；
- 磁盘、CPU、IOPS 和 solver slot 的自适应并发上限。

## 验收门

- 用户不需要运行任何非-evolution 脚本；
- 打开项目任务会自动启动/复用 farmer 和 dashboard；
- 写任务自动隔离，未知并行性也不回退到共享主 checkout；
- 所有 branch 都能在总进度中看到状态、阻塞原因、问题和下一步；
- 未登记输出不会丢失，也不会无限期隐藏在 `_work`；
- Gitee 提供可重建历史，Drive 提供完整项目和运行恢复副本；
- 自动化失败时留下可接续 checkpoint 和经验记录；
- `evolution` 之外不需要用户手动触发脚本或 skill。

## 当前已知缺口

- dashboard 目前只提供 Node server，未接入 supervisor 自动启动；
- farmer 已有 ensure/recovery，但只负责 session 监督；
- session-concurrency 已有 worktree/claim/delivery 基础，但仍需由 supervisor 自动调用；
- `sync-project-snapshot` 与 `sync-three-end` 尚未生成统一 recovery index；
- Drive 现有历史目录需要另行整理，不能在本计划中直接清理。
