# muIon-beam 项目规则

本文件是 `D:\muIon-beam` 的长期项目规则。项目内的 `muion-project` skill 负责把这些规则落实为任务、模拟、报告和归档流程。

## 项目身份与当前设计阶段

- `muIon-beam` 是由长期档案、事实账本、脚本、skill 和通用大模型共同组成的科研协作系统。按培养科研同事/学生的方式积累经验：任务开始前查相关档案和用户建议，结束后记录事实、成功、失败、主意图偏差及下一步。
- 当前阶段是基础设施设计，核心资产是架构、行为规则、源码、skill、测试、决策和经验。允许为清晰模块边界重构，不能为保持小 diff 堆积重复实现；也不能丢弃用户尚未登记的修改。
- 模块化、封装、明确接口、单一职责、组合和资源生命周期管理是全项目基础原则；借鉴 C++ 设计思想，不要求把所有模块改写成 C++。
- 除 `evolution` 外，脚本和 skill 必须由任务入口按需自动调用；常驻服务有可观测健康状态。用户不承担手动启动、心跳、合并、归档和恢复步骤。自动化是否已经接通必须由端到端证据说明，不能从 SKILL 文字推断。
- farmer 只监督可恢复中断并继续原任务；dashboard、并行分配、交付和同步由独立组件负责。
- 每次项目任务读取本文件和 `00_project/decisions/active-adr.json`，按任务范围读取有效 ADR。核心身份见 ADR-005，恢复设计见 ADR-006，当前阶段和源码政策修订见 ADR-007。
- 用户确认既有验收尚未产出认可的 muon 离子束科学成果。旧模型/原始输出属于原型验收材料；P4 可按清单删除已判定无用的原型文件（包括唯一生成物），保留支撑架构和经验的必要证据。不得自动把该分类推广到将来的正式科研数据。

## 工作区边界

- `D:\muIon-beam` 是新项目唯一工作区。
- `D:\muIon` 和 `C:\AAA\muIon` 已由用户删除，不作为当前输入、输出或自动迁移来源，不自动重建这两个目录。
- `90_migration/` 和 `00_project/decisions/legacy-source-change-decision.json` 保留过去的来源、版本和校验事实；源目录删除不等于迁移验收通过，不改写历史路径或 SHA256。当前决定见 ADR-007。
- 旧工作区迁移必须有 source index、migration Manifest 和逐文件 SHA256。
- Google Drive 归档根目录是 `H:\我的云端硬盘\muIon_archive`。
- Gitee 远程仓库是 `https://gitee.com/chx6/muIon-beam.git`。
- 用户已配置 Gitee 向 `https://github.com/chenhx6/muIon-beam` 镜像推送。当前不建卫星库、不切换 origin；未来保留这两种容量方案。

## 事实和版本规则

- Manifest 是任务、模型、运行、文件和归档的事实账本。
- `07_research_system/control/research-state/state.yaml` 是当前科研运行状态唯一 Source of Truth；`research-workflow`、3D、COMSOL、Geant4、validation 和 failure diagnosis 都必须通过独立状态边界建立或复用 context。`NOW.md`、聊天状态和可选 checklist 都由它派生，不能形成第二个可写科研状态源。
- `07_research_system/control/research-state/events.jsonl` 是追加式审计日志，不取代 `state.yaml`；合同实例固定保存在 `07_research_system/control/contracts/instances/<contract_id>/contract.yaml`，dispatch 后不得静默修改。
- SQLite 只能由 Manifest 生成，是可重建查询索引，不是唯一事实源。
- Markdown/CSV 索引和 `VARIABLE_CATALOG.md` 由脚本生成，不手工维护。
- 运行开始前固定实际使用的输入、代码、参数和模型快照。
- 不覆盖、回滚或假定用户未登记的修改不存在。
- 正式运行完成后不得静默覆盖 Manifest；修正必须创建修订版本并连接父版本。
- SQLite 只能由 Manifest 生成；SQLite 丢失时必须能够从 Manifest 重建。

## 任务和审批边界

- 初始任务目标、物理对象、初始条件、变量范围和成功判据必须先形成任务卡并集中核实一次。
- 用户核实后，任务目标范围内的参数扫描、网格调整、3D 小修改、模拟和报告更新可以持续自主执行。
- 首次正式运行发现相关代码或模型变化时，必须先报告并等待选择采用新版本还是登记版本。
- 删除唯一原始数据、改变研究目标、改变外部发布范围或向未指定第三方分享数据时必须暂停。
- 首次正式运行发现任务相关模型的登记指纹发生变化时，必须先暂停并报告变化。

## 文件和外部归档规则

- P0/P1 文件不得自动删除。
- P2 中间结果默认只列为清理候选；仅满足重建、未使用、无锁和空间阈值条件的缓存可以动态清理。
- P3 临时文件在任务结束、无活动进程和无锁文件后才允许自动清理。
- Drive 归档成功并通过数量、大小和 SHA256 校验前，不得清理本地大型原始文件。
- `.git` 不进入 Google Drive 同步目录。
- Gitee 主库优先保存建模/模拟源码、宏、控制参数、必要输入、Manifest、schema、报告、索引与经验。`02_models/` 下合格文本源码不再整目录拒绝，发布入口共用 `delivery-policy.json`，二进制、生成目录和字节预算仍分别检查。
- Drive 对齐项目目录，保存可直接使用的重要文件和必要生成物，减少恢复时重建模型与重跑计算；新机器仍需兼容的软件和许可证。运行版本以 `00_project/config/reproducibility-environment.json` 为基线，并在每次运行记录实际版本。

## 命名和报告规则

- 变量使用完整、可读的规范名称；专业缩写必须登记在 `variable-catalog.yaml`。
- 每个正式运行必须有简洁版报告和详细版报告。
- 图表按任务实际研究问题生成，不强制绘制没有研究价值的关系图。
- 重要图必须登记来源数据、生成脚本、模型版本和解释。
- 项目发布后应执行项目级 canonical mirror 同步，把当前项目相对目录下的 durable 文件和必要 SQLite 快照写入 `H:\我的云端硬盘\muIon_archive\muIon-beam`，并保存 sync-state；历史版本由 Gitee 保存，不再为每个新任务默认生成完整的 `project-management/project-snapshots` 树。

## 第二阶段工具入口

项目 skill 和 `package.json` 提供以下入口：

```text
sqlite-index
legacy-inventory
legacy-migrate
smoke-test
check-model-changes
create-run-snapshot
publish-gitee
sync-three-end
audit-three-end
publish-and-sync
retry-sync
install-nature-figure
cache-audit
```

## 项目任务启动契约

每次进入或恢复任务，智能体先执行 `node 11_tools/project-supervisor/index.mjs enter --project-root D:\muIon-beam`。该入口幂等确保独立监督进程、farmer 和 `127.0.0.1:4317` dashboard；用户无需执行命令。项目 `.codex/hooks.json` 连接 SessionStart/UserPromptSubmit，若宿主未信任新 hook，仍由读取本文件的智能体调用同一入口。不得改写宿主信任数据库、关闭权限机制或把未运行的 hook 宣称为已验收。入口不可用时先用 `node .codex/skills/farmer/farmer.mjs ensure` 保持恢复能力并修复入口。

入口从 `CODEX_THREAD_ID` / `CODEX_SESSION_ID` 取得稳定身份，写任务自动分配或复用返回的 `session.worktree_path`。之后的文件修改和命令必须以该路径为工作目录；不能分配了 worktree 却继续写主目录。明确只读时使用 `--read-only`。被暂停、submitted 或 blocked 的分支先处理记录中的下一步，不能覆盖或删掉现场。当前这次基础设施维护从既有脏主工作树续接，其已登记 maintenance leader 是过渡例外，新任务不得照搬。

### WSL 执行边界

- 对 `wsl.exe -d Ubuntu-20.04` 的调用必须使用已批准的 sandbox 外执行路径，即 `functions.exec` 的 `sandbox_permissions: "require_escalated"`，并使用命令前缀 `wsl.exe -d Ubuntu-20.04`。
- 禁止先用默认 Windows sandbox 调用该前缀进行探测；已知默认 sandbox 会返回 `Wsl/Service/E_ACCESSDENIED`，第一次调用必须直接走允许的外部执行路径。
- 该规则的机器配置保存在 `00_project/config/wsl-runtime.json`。换 session 后先读本文件和本节，再执行 WSL 命令。
- WSL 内先 `source /home/ys/opt/physics/physics-env.sh`，再检查 `geant4-config`、`root-config`、CMake、编译器和下载能力。
- 不读取、复制或保存 `/home/ys/ROOT_SECRET.txt` 或任何 root 密码；需要 root 时使用本地交互或系统凭据机制。

进入 D:\\muIon-beam 的任务时，先检查必要工具；当前任务明确需要且来源可验证的工具或程序包缺失时，由 `muion-project` 的 toolchain recovery 在当前用户范围或隔离环境中自动下载安装、校验并重试原命令。不得安装任意包、执行未知安装钩子或修改 bundled runtime。由于 Codex Desktop shell 可能没有继承 npm PATH，启动 farmer 必须优先使用 `node .codex/skills/farmer/farmer.mjs ensure`，不得把 `npm run farmer:ensure` 作为唯一入口；工具链检查成功后才可使用 npm scripts。farmer 只监督本项目 Codex Desktop session，不改变模型、任务目标或 Manifest。其他工作流 skill 由 autopilot 根据任务阶段自动选择；只有 evolution 的外部能力搜索和采用仍需用户显式触发。

默认采用事件触发的三端审计：正式运行完成、报告定稿、Drive 归档、Gitee 发布和任务关闭时执行。Windows 每日定时审计不是默认流程；若以后启用，只能运行只读审计，不得自动提交、上传或删除。

架构、skill、脚本、schema、模板、任务/模型/运行 Manifest、报告、索引和轻量里程碑属于 durable project assets：进入 Gitee 后必须同步到对应 Drive 项目快照。`task-baseline.json`、farmer/session runtime state、`00_project/state/3d-smoke/`、缓存和未验证 outbox 只保留本地。`evolution` 只能由用户显式触发，先报告候选和建议，用户决定采用范围后才能进入项目交付。

## 自动提交和发布契约

任务开始时记录当前 Git 基线；任务范围内的 skill、脚本、配置、文档和测试修改通过架构检查后，自动 commit 并 push 到 origin/main，无需用户再次提醒。基线中已有的用户修改、模型文件、大型输出和同步 outbox 默认拒绝自动提交。正式结果只有在双报告定稿、Drive SHA256 校验和三端审计通过后才自动创建 annotated tag，并生成完整中文说明；普通代码或 skill 更新只自动提交，不伪造结果 tag。
