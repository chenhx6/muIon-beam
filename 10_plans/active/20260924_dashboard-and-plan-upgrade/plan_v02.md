# Dashboard 历史清理、治理收尾与部署交付计划 v02

## 状态

本计划已获用户批准，执行范围为基础设施收尾，不进入正式科研任务。2026-09-24 用户补充：主 checkout 的全部遗留现场和 leader integration 都属于本计划必达范围，不能留给后续任务。当前仍在执行，worker 临时上线不等于最终交付。

## 目标

1. 修复 submitted/blocked worker 无法在用户批准后复用原 worktree 继续工作的生命周期 bug。
2. 完成 20260923 文件治理、主 checkout 归位和 pending-integration 收尾，形成无未登记改动的可用基底。
3. 清理 dashboard 历史展示，只保留当前 session 的未完成工作。
4. 修正 8993 混合 artifact 统计并保留简洁文件治理摘要。
5. 将新版 dashboard 从正式交付入口持久部署到 127.0.0.1:4317，验证 supervisor 重建服务后仍使用同一版本，再完成主分支发布与 Drive 验证。

## 已确认的 session 范围

用户确认本次只有当前 session 有未完成工作：

- 保留：codex-d80b7f12073a98b4eb63-1
- 已由当前 session 接替：Codex thread 01a0cdeb-f9ef-7530-b827-53c1c3177d77
- 其他历史 session 不进入当前 dashboard 主看板。

这不是时间 T0；它是本次 dashboard 的一次历史投影清理决定。原始 receipt、Manifest、Git 历史和科研档案继续保留。该决定只处理现存历史条目，不得实现为永久仅允许当前 session 的白名单；未来新任务和被用户重新打开的任务必须正常进入看板。

## 阶段

### P0：生命周期恢复与计划落盘

- 增加显式 resumeSession 命令。
- submitted、blocked、interrupted、paused worker 在用户批准后复用原 worktree、branch、claim 和 integration receipt。
- 恢复时续租、重新登记 claim、追加 lifecycle event，不创建第二 worktree，不丢弃现场。
- 为 resume 行为增加回归测试。

### P1：治理现场与 integration 收尾

- 复用 20260923 governance plan、MAIN-CHECKOUT-GOVERNANCE-RECEIPT 和 OUTPUT-ARCHIVE-RECEIPT。
- 以逐文件模式重核主 checkout 的 39 M、235 D、504 ?? 基线；记录 Git HEAD、实际内容指纹和已有回执。数量变化逐项解释，不能用目录折叠数冒充文件数。
- 内容改动先登记并保存可恢复副本，再逐文件判定采用、合并、命名迁移或经验证归档。保留用户修改的内容，不以 reset、stash、clean 或批量覆盖制造干净状态。
- 39 M 审查差异后纳入治理交付；235 D 核实旧/新路径及哈希关系；504 ?? 区分已交付源码、正式输出和本地运行文件。生成索引仍由现有脚本重建。
- 收口已有回执中的 64 个未登记输出、2 个日志、1 个 Manifest 哈希漂移及 153 个删除内容变化/未决项。重叠项按路径和内容去重，不累加成新的错误总数；Manifest 修订关联旧版本。
- 对无需继续使用但需要保留的材料完成可恢复归档和明确登记；对有实际风险的未知内容保留阻塞。本计划不能以“仍需审查”或“留给下一次”宣布完成。
- 核对旧治理 worker、旧 dashboard worker 和当前 worker 的提交包含关系；已有内容不重复合并，仍需内容经 leader 锁集成，已替代回执登记 superseded 及替代提交。
- 主 checkout 归位通过受控 leader 流程，源码编辑保留在分配的 worktree；最终主目录 git status --porcelain=v1 --untracked-files=all 必须为空，获准本地保留的 ignored runtime 单独登记。
- P1 验收：基线每项有实际处置证据、内容未丢失、主目录干净、无未解决 Git 冲突及本次相关待集成事项。

### P2：dashboard read model 与历史清理

- dashboard 只保留“正在执行”和“需要处理”两个区域。
- 本次历史清理后仅当前 session 有未完成工作；未来任务自动纳入，不能靠固定 session 白名单隐藏新工作。
- 移除旧 research-state 页面、历史 FAILED、旧计划列表、累计 agent、raw JSON 和历史 session 卡片。
- 已完成或没有明确未完成工作的 session 不再渲染。
- 8993 不再作为总数显示；ignored venv/private/runtime 文件不计入 durable 未登记异常。
- 底部可保留简洁的文件治理摘要：durable 未登记、blocked 输出、Manifest/Drive 待核对。必须以去重、当前有效的治理事实计算；promotion 候选、私有 runtime 和旧扫描不能充当未解决输出。当前观察到的 blocked 5465 / ignored 64729 不能作为治理完成证据，需核正来源。
- 删除已被替代的 dashboard 查询、渲染与无调用代码及相应旧测试，保留跨模块仍有调用的功能和清理回执。

### P3：实际部署

- 集成 dashboard 相关文件与生命周期修复。
- 运行 session-concurrency、dashboard、progress、architecture 和 project-supervisor 回归测试。
- 正式入口运行已交付版本；当前由 worker 启动并被 supervisor 健康检查接受只是临时上线，不满足持久部署验收。
- 验证停止并由 supervisor 重新创建 dashboard 后仍使用新版本，不能回退到主目录旧页面；用户不用手工启动服务。
- 校验 api/health 项目根、served HTML/JS hash 和 api/status 投影。
- 浏览器验收页面并保存截图；覆盖当前任务、未来新任务、正常结束、中断及等待信息，不能仅测试 handler 或靠删历史记录使测试通过。
- submitted resume 修复纳入正式入口和交付说明，验证保留现场、旧 receipt 不被误集成；不得要求用户另开任务解决项目内部生命周期问题。
- 已安装工具核对长期项目内入口和路径，避免清理 worktree 后丢失仅存于其中的 venv/私有环境；不扩展工具、不做科研调用。

### P4：交付与关闭

- 用户已将 778 项现场治理纳入本任务；完成逐文件审查和登记后，按明确清单交付采用内容。未经登记的修改不得夹带提交。
- 更新 plan、治理增量 receipt、integration receipt 和 dashboard deployment receipt。
- 必须完成 origin/main 发布、主 checkout 与交付提交对齐、Drive canonical mirror 数量/大小/SHA256 验证及云端 manifest/recovery index 读回；不创建科研结果 tag，不把映射盘存在当作云端验证。
- 做一次与本次改动相关的恢复验收：项目入口复用正确工作区、session 能继续、服务可自动启动、交付文件可从 Git/Drive 对照恢复。通过后停止扩展基础设施。
- 本计划关闭时明确记录本 session 未执行正式科研任务。

## 明确不做

不启动 COMSOL、Geant4、SolidWorks 或任何正式科研任务；不安装新工具；不删除唯一原始数据；不修改科研目标；不建立时间 T0。

## 完成条件

- 用户批准后可在同一 session 复用原 worktree 继续工作。
- dashboard 实际运行版本与集成文件一致。
- dashboard 只显示当前未完成 session。
- 历史内容和 8993 混合统计不再出现。
- 778 项基线及执行中新差异全部闭环；不能只有分类回执而未处理主目录。
- 主 checkout 无未提交改动、无未解决合并冲突；本次相关 worker 集成或有证据的替代处理完成，无遗留 pending-integration。
- 服务重建后仍运行正式交付版本，未来新 session 正常展示，不依赖当前 worktree 的临时 dashboard 进程。
- 本次交付已进入 origin/main，Drive 验证完成，必要私有 runtime 留在明确的项目本地路径。
- 测试、浏览器页面和 127.0.0.1:4317 实际检查全部通过。

## 关闭门

上述完成条件逐项有证据后才将计划标记 completed。任何文件处置、集成、发布、持久部署或同步仍待完成时，计划保持 executing，并写清下一步。本计划只验收基础设施可继续工作，不代表物理模型通过科学验证或已开始研究。
