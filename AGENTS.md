# muIon-beam 项目规则

本文件是 `D:\muIon-beam` 的长期项目规则。项目内的 `muion-project` skill 负责把这些规则落实为任务、模拟、报告和归档流程。

## 工作区边界

- `D:\muIon-beam` 是新项目唯一工作区。
- `D:\muIon` 正在继续气体密度—冷却关系图任务。当前保留已迁移和发布的版本，旧工作区后续变化暂不采用；允许只读核对，暂停新增迁移，待用户确认阶段任务完成后再处理增量。
- 当前版本选择记录于 `00_project/decisions/legacy-source-change-decision.json`。旧源继续变化不等于已迁移副本损坏，不得据此覆盖原迁移哈希或宣称整体迁移完成。
- 迁移默认采用 `copy-only`；迁移完成并通过实例验收前，不得删除、整理或重命名 `D:\muIon` 原件。
- `C:\AAA\muIon` 已废弃，不得作为输入或输出位置。
- 旧工作区迁移必须有 source index、migration Manifest 和逐文件 SHA256。
- Google Drive 归档根目录是 `H:\我的云端硬盘\muIon_archive`。
- Gitee 远程仓库是 `https://gitee.com/chx6/muIon-beam.git`。

## 事实和版本规则

- Manifest 是任务、模型、运行、文件和归档的事实账本。
- `research-state/state.yaml` 是当前科研运行状态唯一 Source of Truth；`research-workflow`、3D、COMSOL、Geant4、validation 和 failure diagnosis 都必须通过独立 `research-state` 边界建立或复用 context。`NOW.md`、聊天状态和可选 checklist 都由它派生，不能形成第二个可写科研状态源。
- `research-state/events.jsonl` 是追加式审计日志，不取代 `state.yaml`；合同实例固定保存在 `contracts/instances/<contract_id>/contract.yaml`，dispatch 后不得静默修改。
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
- Gitee 保存源码、Manifest、schema、索引、报告和重要小型结果；大型模型和完整原始输出进入 Drive。

## 命名和报告规则

- 变量使用完整、可读的规范名称；专业缩写必须登记在 `variable-catalog.yaml`。
- 每个正式运行必须有简洁版报告和详细版报告。
- 图表按任务实际研究问题生成，不强制绘制没有研究价值的关系图。
- 重要图必须登记来源数据、生成脚本、模型版本和解释。
- 项目发布后应执行项目级快照同步，把 Git 跟踪文件和 SQLite 快照写入版本化 Drive 目录，并保存 sync-state。

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

进入 D:\\muIon-beam 的任务时，先检查必要工具；当前任务明确需要且来源可验证的工具或程序包缺失时，由 `muion-project` 的 toolchain recovery 在当前用户范围或隔离环境中自动下载安装、校验并重试原命令。不得安装任意包、执行未知安装钩子或修改 bundled runtime。由于 Codex Desktop shell 可能没有继承 npm PATH，启动 farmer 必须优先使用 `node .codex/skills/farmer/farmer.mjs ensure`，不得把 `npm run farmer:ensure` 作为唯一入口；工具链检查成功后才可使用 npm scripts。farmer 只监督本项目 Codex Desktop session，不改变模型、任务目标或 Manifest。其他工作流 skill 由 autopilot 根据任务阶段自动选择；只有 evolution 的外部能力搜索和采用仍需用户显式触发。

默认采用事件触发的三端审计：正式运行完成、报告定稿、Drive 归档、Gitee 发布和任务关闭时执行。Windows 每日定时审计不是默认流程；若以后启用，只能运行只读审计，不得自动提交、上传或删除。

架构、skill、脚本、schema、模板、任务/模型/运行 Manifest、报告、索引和轻量里程碑属于 durable project assets：进入 Gitee 后必须同步到对应 Drive 项目快照。`task-baseline.json`、farmer/session runtime state、`00_project/state/3d-smoke/`、缓存和未验证 outbox 只保留本地。`evolution` 只能由用户显式触发，先报告候选和建议，用户决定采用范围后才能进入项目交付。

## 自动提交和发布契约

任务开始时记录当前 Git 基线；任务范围内的 skill、脚本、配置、文档和测试修改通过架构检查后，自动 commit 并 push 到 origin/main，无需用户再次提醒。基线中已有的用户修改、模型文件、大型输出和同步 outbox 默认拒绝自动提交。正式结果只有在双报告定稿、Drive SHA256 校验和三端审计通过后才自动创建 annotated tag，并生成完整中文说明；普通代码或 skill 更新只自动提交，不伪造结果 tag。
