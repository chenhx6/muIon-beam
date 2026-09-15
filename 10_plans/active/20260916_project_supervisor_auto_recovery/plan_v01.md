# 自动 ProjectSupervisor、并行 session、结果归位与三端恢复执行计划

## 计划状态

当前状态：`planning`。本文件只冻结执行路线，不开始代码实现、不创建新的 Gitee 卫星仓库、不清理 Google Drive、不改变科研目标或正式运行结果。

任务卡：`task_project_supervisor_auto_recovery_001`。

## 用户目标

用户只在 Codex session 中提出研究或工程目标。除 `evolution` 外，所有脚本和 skill 都由项目自动按需触发。任务需要修改文件时默认进入独立 worktree；多个可独立任务并行执行，最终由 leader 集成。无法判断独立性时仍使用独立 worktree，并行完成后再集成。`evolution` 涉及底层能力和规则变化，继续保留唯一人工采用边界。

`muIon-beam` 被视为一名需要长期培养的科研同事：文件架构和 Manifest 是记忆，模型是当前推理大脑，脚本与 skill 是可测试的器官，成功和失败都形成经验。每次任务必须保留事实、证据、checkpoint、问题、下一步和可复用教训。

## 规则收口

第一项执行工作不是启动 solver，而是修订项目规则事实。`D:\\muIon` 和 `C:\\AAA\\muIon` 已由用户删除，不能继续被 `AGENTS.md` 或 `muion-project/SKILL.md` 描述为 active legacy workspace。历史迁移 Manifest、旧路径记录和 `90_migration` 仍然保留，作为历史记忆，不作为当前输入。

`AGENTS.md` 只保存必须每次读取的执行宪法：当前工作区、自动触发、模块化边界、科研状态唯一源、Gitee/Drive 恢复职责、experience 规则和 evolution 例外。ADR 保存完整理由、接口、版本和 superseded 关系。Codex 不会自动读取所有 ADR，因此 supervisor 还要读取 active ADR index 并把相关摘要加入 session context。

## 组件边界

`ProjectSupervisor` 是组合根，负责生命周期和依赖注入，不直接实现 farmer、dashboard、session、同步或科研决策。组件责任固定为：

- `ProcessSupervisor` 只负责本地进程 ensure、health、restart 和 stop；
- `FarmerSupervisor` 只调用现有 farmer，监督 allowlisted transient failure，继续原 session，直到任务成功或形成不可恢复状态；
- `DashboardSupervisor` 只确保 dashboard 进程和 `/api/status` 可访问；
- `SessionBootstrapper` 负责 session identity、context、worktree、owner token、lease 和 path claim；
- `DispatchPlanner` 负责任务拆分、依赖、资源、接口端口和并行 wave；
- `WorkerRuntime` 负责 heartbeat、checkpoint、失败分类、恢复和重派；
- `ResourceCoordinator` 负责 COMSOL、SolidWorks、WSL Geant4 和共享构建资源；
- `ArtifactPromoter` 负责发现输出、生成 artifact record、归位、归档和清理资格；
- `ProgressAggregator` 负责显示全部 branch/session/task/artifact/问题/下一步；
- `SyncCoordinator` 负责 Gitee Recovery Core、本地现场、Drive 完整档案和 recovery index；
- `ExperienceRecorder` 负责正向、负向和中性经验及其汇总。

每个组件拥有自己的状态文件和接口。事件只追加，派生视图可重建，组件不能直接改写另一个组件的权威状态。`research-state/state.yaml` 继续是唯一科研状态源。

## 自动生命周期

```text
session-entered
  -> ProcessSupervisor.ensure(farmer, dashboard)
  -> SessionBootstrapper.create_or_resume
  -> 自动 task intake / contract / preflight
  -> DispatchPlanner 生成 worker lanes
  -> SessionBootstrapper 为每个 writer 创建 worktree
  -> WorkerRuntime 并行执行、heartbeat、checkpoint
  -> ArtifactPromoter 登记输出
  -> FarmerSupervisor 处理可恢复中断
  -> ProgressAggregator 更新总进度
  -> leader 串行 integration gate
  -> QA / reports / artifact promotion
  -> SyncCoordinator Gitee + Drive
  -> ExperienceRecorder 记录本轮经验
  -> close 或保留 blocked/recovery 状态
```

用户无需运行上述任何脚本。普通任务入口自动完成调用；如果宿主没有提供原生 session-start hook，项目入口必须在第一次任务动作前完成 bootstrap，并在 bootstrap 失败时阻止 writer 进入主 checkout。

## 并行和冲突策略

已知 ownership 不相交的任务自动并行。已知相交的 writer 在 admission 阶段拒绝或排队。无法证明独立性的任务仍各自进入 worktree 并行，冲突在 leader 集成阶段暴露；冲突分支、worktree、receipt 和问题都保留。

主工作树只给 leader 使用。worker 不直接 push `main`，不修改另一个 worker 的 worktree，不使用自动 `ours/theirs` 覆盖。共享科研状态和独占 solver/GUI 资源串行化。脏 worktree 不能被自动回收。

## 结果、未登记输出和总进度

worker 生成的代码、配置和文档在集成后进入原有项目相对路径。正式运行结果必须根据 artifact Manifest 进入 `03_runs/formal/<run_id>`，报告进入 `05_reports`，轻量结果进入 `04_results`，大型模型和完整原始输出进入 Drive 运行归档。`_work` 只保存 session、lease、checkpoint、receipt、缓存和未验证 outbox。

未登记输出进入：

```text
unregistered -> classified -> promoted / archived / retained-blocked
```

任何未登记文件都要保存路径、所属 session、branch、大小、SHA256、时间、推测目标、阻塞原因和下一步。`ProgressAggregator` 按 branch、task、问题簇和 artifact 显示，避免多个阻塞只压缩成一个 `BLOCKED`。

## Gitee Recovery Core

Gitee 主库 `muIon-beam` 必须包含可重建核心：规则、active ADR、skill、脚本、schema、测试、任务卡、计划、Manifest、报告、索引、经验和小型可复现实验输入。新设备或接班人只 clone 主库，也应该能够恢复项目身份、重建索引、运行 QA、继续新任务和查询历史。

只有当主库容量或单文件限制确实无法满足时，才考虑一个或两个用途明确的卫星库，例如 `muIon-beam-assets` 或 `muIon-beam-repro-inputs`。卫星库必须由主库中的固定 URL、ref、commit 和 SHA256 绑定，并由 bootstrap 自动 clone；不能依赖人工猜测多个库的版本。

Gitee-only 的保证范围是“可重建项目和继续新工作”。某个历史运行如果依赖尚未发布到 Gitee 的大型二进制模型或原始输出，必须在 recovery index 中明确标为 `drive-required`，不能伪称已经完整复现。以后将根据实际 Gitee 单文件/仓库容量和运行输入清单决定是否扩大上传范围。

## Google Drive 恢复档案

Drive 的目标是本地损坏后可以直接继续，而不是让 Codex 从杂乱历史目录猜测项目结构。目标布局为：

```text
muIon_archive/
  project/snapshots/
  project/recovery-index/
  project/manifests/
  runs/<run_id>/
  models/<model_id>/<version>/
  references/
  external-libraries/
  legacy/
  quarantine/
```

现有 `project-management`、`legacy-from-D-muIon`、`external-libraries` 和 `references` 先全部保留。整理时先清点 sync-state、Manifest、文件数量、大小和 SHA256；再用 copy-only 写入 canonical 目录；新目录验证完成后切换 supervisor；旧目录进入 `legacy` 或 `quarantine`。唯一内容不得自动删除。

`SyncCoordinator` 需要生成顶层 recovery index，串联：最新 Gitee commit、最新 project snapshot、各 run archive、未关闭 task/session、经验汇总、未登记 artifact 和下一步。这样从 Drive 可以直接恢复工作状态，从 Gitee 可以重建项目核心。

## 经验和行为档案

每次自动触发成功、失败、恢复、ownership 冲突、结果提升、同步验证和用户纠正都要自动生成 `EXP-*` 记录。行为误用、工具链问题、并行协调问题和物理模型问题分开归类。同一类别累计后，自动检查是否需要更新门禁、测试、skill 或 supervisor。

本轮已记录：

- 正向经验：把 muIon-beam 按可培养科研同事建设；
- 负向经验：farmer 已恢复但 dashboard 未随任务自动启动。

## 阶段验收

P0 先冻结规则、ADR index、模块接口和自动触发契约。P1 接入 farmer/dashboard/session bootstrap。P2 接入 worktree、claim、worker lease、并行和恢复。P3 接入 artifact promotion、unregistered triage、总进度和经验。P4 建立 Gitee Recovery Core、可选卫星库策略、Drive canonical archive 和 recovery index。P5 再考虑跨机器 CAS 和 Windows 进程级写边界。

每个阶段都必须有结构测试、行为测试、失败注入和可恢复证据。只有满足“用户不运行非-evolution 脚本”以及三端恢复门后，才可把阶段标记为完成。
