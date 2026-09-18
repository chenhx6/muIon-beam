# 自动监督与并行入口：阶段技术报告

## 实现范围

任务为 task_project_supervisor_auto_recovery_001。P0 的身份、模块边界、active ADR、已删除旧目录事实、源码发布策略和可复现环境契约已落实。ProjectSupervisor 是组合根，服务、session、输出扫描和进度各有独立模块；不改变模型、研究目标、冻结合同或科研状态。

## 自动入口与服务证据

项目 `.codex/hooks.json` 连接 SessionStart（含 resume/compact）和 UserPromptSubmit。宿主未信任新 hook 时可能跳过，因此 AGENTS 要求智能体在第一次任务动作时调用同一个 entry。直接调用测试不等同于宿主投递验收；本报告保留该差异。

entry 启动独立常驻监督器，每 5 秒检查服务。farmer 用 PID 和新心跳判断监督是否活跃；dashboard 同时校验回环端口上的服务身份、项目根目录和 `/api/status`。未知监听者与活着但不健康的进程会被报告，不被盲目杀死。

2026-09-17 的受控恢复观测：dashboard PID 24460 被停止后，监督器拉起 PID 27612，`/api/status` 恢复，farmer PID 3740 保持 healthy。具体 PID 只是观测，不能作为以后进程身份的固定值。

## 并行与保留现场

SessionBootstrapper 绑定宿主 session identity 与内部 session registry。写任务默认私有 worktree；同一宿主续接复用原分支、路径和 lease。已有明确 ownership 的重叠任务拒绝入场；未知独立性只在双方都是私有 worktree 且登记 isolated overlap 时并行，后续集成仍需串行解决冲突。

WorkerRuntime 只对 farmer 观察为运行且 ownership 检查通过的任务续租，停止或失联任务保留现场。ArtifactCatalog 扫描私有 worktree 的未跟踪和忽略文件，不删除原件；ProgressAggregator 派生分支、租约、阻塞和下一步，不能改写科研 state.yaml。

本次维护续接既有脏主目录，登记为 maintenance leader。新普通任务不得复制这一过渡模式。交付只纳入本任务明确拥有的文件；混合文件中的既有 WSL、命名和模型指纹修改应留在用户工作树。

## 测试范围

已执行本地完整 Node 测试、语法检查、Manifest/计划校验和 skill validator。定向用例覆盖并发 ensure 只启动一次、服务退出后恢复、异项目端口拒绝接管、双方 worktree 修改同一文件而主目录不变、中文/空格路径、worker 拒绝二进制 checkpoint、leader 保留无关已暂存修改和忽略输出可见性。发布候选还需独立 checkout 验证，证据与交付 receipt 分开记录。

独立只读 reviewer 三次遇到模型容量错误，未获得审查结论；本轮不计为独立审查通过。第一次 farmer skill validator 因 Windows 默认 GBK 读取 UTF-8 文件失败，使用 Python UTF-8 模式后通过；未安装新依赖。

## 余项

## 已提交检查点的归档补充

`bf5f06e4a49b651a7ab163b9d205c59169cef53c` 已在 Gitee main 发布。对应 H: 映射盘快照保存 1074 个文件、61116242 字节，逐文件 SHA256 与 Git blob 一致，receipt 位于 `00_project/traceability/project-snapshots/SNAPSHOT-bf5f06e4a49b.json`。只复制 Git 已提交内容，未提交用户修改、运行现场和派生 SQLite 不在本次范围内。

Google Drive connector 按快照名和精确 archive 根目录查询未找到对应云端目录，原因尚未确定；因此本次只能确认映射盘数据校验，不能宣称云端上传已完成。后续 P4 必须核对云端可见性再进行旧目录清理。

恢复观察另发现 farmer 首个心跳写出前的短暂启动状态被误判 degraded；已增加 starting 状态和有界等待，验证不会重复拉起服务。

## 后续验收

1. 新宿主任务原生 hook 投递与信任状态的实际验收。
2. 根据任务完成证据触发 checkpoint、输出分类/归位、leader 集成和关闭；当前只有底层门与运行状态，不能把一次 turn 结束当成任务完成。
3. P4 Drive 清点、目录对齐、恢复索引和恢复演练。当前仅做代码检查点备份，不宣称完整现场恢复。
4. P5 的跨机器 CAS 与 Windows 任意子进程写入隔离。

当前 Node 协议无法阻止一个绕开入口的任意进程写错绝对路径。入口上下文、claim 检查和私有 worktree 是现有约束；OS 级强制边界仍按 P5 处理。

## 2026-09-18 farmer 事故处置

用户报告 farmer 无限发送 `[farmer resume]`。已先写入 `_work/current/farmer/control.json` 的持久 `disabled` 开关，再停止 farmer 和 project-supervisor；dashboard 由独立 Node 进程保留，健康接口返回 `muion-research-dashboard`。普通 entry、hooks、`ensure`、`start`、`once` 和 `retry` 均不会解除开关或产生新的 queue 调用。

随后隔离测试发现，若自动恢复消息触发了新的 `task_started`，简单按 turn 清零 attempts 仍会允许跨 turn 无限循环。现在 farmer 解析最近用户消息，只有精确匹配其 recovery message 才视为自动恢复链；该链保留 attempts 和熔断，普通用户输入才重置链。

两条已确认的 farmer 自动消息 ID 写入 incident receipt。安装的 `codex queue --help` 仅有 enqueue 参数，没有 list/cancel 接口，因此没有对未知队列做猜测性删除，也没有触碰人工消息；这部分保持 `not_supported_by_installed_cli`，不能宣称历史消息已取消。

回归测试在隔离临时项目完成：null attempts 使用安全上限 3；同一 event 的 watchdog `queue-stuck` 不重发；显式 manual retry 才清除熔断；停用 CLI 和 supervisor entry 不创建 daemon。真实项目 farmer 进程数验收为 0。Farmer 必须保持停用，直到用户明确允许 enable 并完成 incident review。
