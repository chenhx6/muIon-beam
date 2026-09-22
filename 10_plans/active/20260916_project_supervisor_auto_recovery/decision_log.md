# 决策日志

## 2026-09-18：farmer 事故停用与恢复熔断

- 用户报告 farmer 无限发送 `[farmer resume]`，要求优先停止并将修复纳入本任务。
- 已写入 `_work/current/farmer/control.json`，`disabled=true`；真实 farmer 与 project-supervisor 进程数均为 0。独立 dashboard PID 21100 保留并通过 `/api/health` 验证。
- `farmer ensure/start/once/retry`、ProjectSupervisor entry 和 hooks 在停用开关下均不启动恢复或写入队列；普通任务入口不会清除开关。
- `max_attempts` 改为 3；`null` 仍在 recoveryStep 使用安全上限 3。watchdog 触发 `queue-stuck` 熔断，同一 event_key 不再重发；显式 retry 才清除。
- 已确认 farmer 生成的 queue message ID：`01a0ad8f-f159-7171-b08f-8ae25ac82991`（当前线程）和 `01a0ae34-5ed5-7773-ae23-81e277fb2536`（farmer incident thread）。`codex queue --help` 只有 enqueue，没有 list/cancel，因此没有猜测性取消，也没有触碰人工消息；事件记录为 `not_supported_by_installed_cli`。
- 隔离回归测试通过；真实停用路径不向 Codex queue 投递。

## 2026-09-17：P0 到自动监督与 session bootstrap 的执行检查点

- 新增独立 ProjectSupervisor、ProcessSupervisor、FarmerService、DashboardService、ProjectContext、SessionBootstrapper、WorkerRuntime、ArtifactCatalog 和 ProgressAggregator；farmer 不再调用 task-close。
- 本机 Codex CLI 报告 hooks stable true；已配置项目 SessionStart/UserPromptSubmit。宿主新 hook 的信任和实际投递尚未实测，AGENTS 自动调用入口作为后备。未修改宿主信任数据库或绕过信任检查。
- 实际 entry 启动 farmer 和 dashboard 并通过健康检查；停止本次拥有的 dashboard PID 24460 后，监督器自动拉起 PID 27612，状态接口恢复。PID 是当时观测，不是固定配置。
- 修复目录 claim 尾斜杠、Git porcelain 中文/空格路径解析，以及碰撞拒绝前误创建 worktree 的问题。
- 新任务默认私有 worktree；未知独立性的双方可显式登记 isolated overlap 后并行，明确重叠 ownership 仍拒绝，共享 writer 不享受例外。本次已有脏主工作树登记为 maintenance leader 续接，不接管其他任务修改。
- 修复 preflight 只认主目录的问题，接受由该项目 common Git directory 登记的 worktree。
- 源码上传判定覆盖 worker、leader 和旧 workflow model checkpoint；模型源码可以进入主库，二进制、输出目录、NUL/非 UTF-8 伪装和超限内容继续拒绝。
- 独立只读审查三次受到模型容量错误，保持原模型，未获得审查结论；不能宣称独立审查通过。
- P4 清理依据 ADR-007：可删除确认无用且不被重建链依赖的设计期原型生成物；保留必要设计/经验和删除 receipt。本检查点未删除 Drive 文件。

## 2026-09-16：进入执行计划制作

- 用户确认：除 `evolution` 外，所有项目脚本和 skill 必须由任务入口自动按需触发，不能要求用户手动调用。
- 用户确认：监督职责模块化；farmer 只监督可恢复中断并继续任务，不承担 dashboard、dispatch、同步或结果归位。
- 用户确认：`muIon-beam` 按可培养科研同事/学生建设，经验、建议、行为、成功和失败都属于长期记忆。
- 用户确认：Gitee 必须提供可重建核心；必要时可评估一个或两个卫星库，但必须受容量、版本和哈希约束。
- 用户确认：Google Drive 是无缝恢复的完整档案；现有混乱目录先保留，后续 copy-only 重整和校验后再讨论清理。
- 事实核对：`D:\\muIon` 和 `C:\\AAA\\muIon` 当前不存在；旧 AGENTS/skill 描述需要在 P0 修订。
- 事实核对：farmer 当前运行；dashboard 端口 4317 当前未监听。

## 未决事项

- Codex Desktop/CLI 可用的 session-start hook 形式，需要在 P1 宿主适配器中验证；在验证前不宣称全自动宿主隔离完成。
- Gitee 当前单文件、仓库和卫星库容量，需要在 P4 用实际配额和候选 artifact 清单测量。
- Drive canonical layout 的最终目录名和历史重复项归并，需要在 P4 生成 reorganization Manifest 后确认。
- 大型历史模型是否发布到 Gitee satellite，按恢复价值、容量和可重建性逐项决定。

## 2026-09-22：本地树 canonical Drive 镜像

- 采用 ADR-009：Drive 接续入口改为 `H:\\我的云端硬盘\\muIon_archive\\muIon-beam`，与 `D:\\muIon-beam` 保持相同相对路径；Gitee 保存版本历史，Drive 保存当前接续副本。
- 自动生成并执行 `drive-mirror-plan.mjs` / `drive-mirror-sync.mjs`。按当前 retention policy，本地 canonical 镜像包含 1225 个文件、448590357 字节，逐文件数量、大小和 SHA256 校验通过；`.git`、`_work`、状态目录、缓存、日志、构建目录和临时文件未复制。旧宽策略镜像中的 1251 个文件被标为 stale candidate，继续保留，未删除。
- Drive 根目录已写入 `drive-mirror-manifest.json`，标记 `mapped-drive-count-size-sha256-verified`；该文件不把映射盘存在误写成云端可见。
- Google Drive connector 仍找不到 `muIon-beam` 或 `drive-mirror-manifest.json`，只能看到不相关的 `mu-ion beam` 文件夹及其 `无标题文档`；因此云端上传仍为 `unverified`，旧归档目录继续保留，未执行删除或移动。
- 新任务的 `sync-project-snapshot`、`sync-three-end`、`audit-three-end`、`task-close` 和外部库归档默认均通过 `drive-layout.mjs` 指向本地树镜像；显式旧路径只用于历史 receipt，不会再次生成旧目录。
- 用户授权清理历史垃圾后，已将 canonical mirror 中 1251 个旧 runtime/state 文件和 `project-management/project-snapshots` 的 26 个历史快照整体移入 `quarantine/DRIVE-QUARANTINE-20260922`；状态文件逐个 SHA256 校验通过，23 个快照有 Gitee ancestor，3 个无索引，永久删除仍等待云端可见性和人工可追溯审查。
- DriveFS-linked 浏览器账号随后读回 `muIon_archive/muIon-beam`、`drive-mirror-manifest.json`、traceability quarantine receipt 和 quarantine 目录；云端可见性已验证。下一步永久删除 23 个有 Gitee ancestor 的重复快照、runtime/state 和旧 dashboard 版本，保留 3 个无索引快照。
- 云端读回确认后，已永久删除 23 个有 Gitee ancestor 的重复快照、1251 个 runtime/state 文件和旧 dashboard 版本；3 个无索引快照仍在 quarantine，未自动删除。
- 用户要求“统统清理”后，3 个无索引快照、外部库重复副本、references 重复副本、旧 framework 和最后 quarantine 顶层均已删除；当前仅保留 canonical `muIon-beam`、latest project recovery snapshot、legacy migration evidence 和必要的恢复记录。

## 2026-09-16：主库源码优先和 Drive 清理边界

- 远端 `origin/main` 测量：约 1045 个 tracked files，Git tree 约 61 MB；源码/配置/Manifest/文档约 734 个文件、约 16.2 MB。
- Gitee 帮助中心公开配额参考：免费版单仓库约 500 MB、单文件约 50 MB；当前规模无需卫星库。
- 决定：所有可重建的模型构建源码、模拟源码、宏、配置、测试、Manifest 和文档优先进入 `muIon-beam` 主库；生成二进制、完整原始输出和大型模型按 Drive 归档。
- 决定：只有主库接近软阈值、单文件接近限制、clone/push 失败或有清晰独立生命周期时，才评估一个用途明确的卫星库；卫星库必须由主库固定 ref/commit/hash 并可自动 bootstrap。
- 用户授权：P4 最终重建阶段允许删除已经确认冗余的旧 Drive 目录；删除前必须完成 copy-only、去重、唯一内容检查、数量/大小/SHA256 验证和 recovery-index 写入。

## 停止条件

- 发现科研目标、冻结 contract 或登记模型被意外改写；
- 发现 Drive 唯一档案需要删除才能继续；
- 发现自动触发会绕过 AGENTS、active ADR、Manifest 或 research-state；
- 发现 Gitee satellite 造成版本漂移或无法验证固定 commit；
- 发现 worker 会写入主 checkout 或另一个 worktree。
