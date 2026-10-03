# plan_v3：真实看板、节点自动发布、标签与并行收尾

日期：2026-09-30（用户本地日期）。状态：执行中；P0 审计完成，当前阶段 P3/P4（N0+N1 节点交付）。
继承 plan_v02；保留历史记录，追加错误验收纠正。后续上下文恢复先读本文件。

## 目标与边界

修复 dashboard 状态和名称、补齐 d80 遗漏交付；可交付计划节点完成后自动集成到 main、测试、推送 Gitee、验证必要 Drive 归档并打任务里程碑标签。任务结束自动关闭 session、释放 claim、回收已交付 worktree 和分支。用户无需再次提醒整理或 push。
复用现有 supervisor、delivery、session 和 tag 脚本，不新增并行框架或 UI 库。不执行正式科研任务，不伪造科研结果标签。

## 基线事实与已知问题

- 之前 main clean、remote SHA 一致并未证明 worker 成果完整；d80 的生命周期、web-research 和 dashboard 修复有遗漏。38 个非祖先提交不等于38项缺失功能，必须审查内容。
- 历史 API 曾返回13条 session，其中11条无名 abandoned 被渲染为中断，artifact统计为64889；执行前重新获取当前证据。
- 2026-09-30 supervisor enter 失败：Unexpected token NUL，全零字节不是合法JSON。fallback farmer ensure 返回 started_pid=13200，仅代表启动请求，尚未证明健康。
- d80 registry 为 closed；执行代码修复前解决合法写上下文和原现场续接，不能伪装 active 或清空 registry。
- 本地最近标签为 b-configure-deep-study-20260911153836-04d6d67；远端标签及9月25日发布须复核。
- 初查 auto-commit-push：worker checkpoint 后返回 pushed:false；普通 leader push 路径未调用 create-task-tag。package已有 task:tag；标签脚本默认取 HEAD 创建 t-* 并push。完整根因仍须追踪实际部署版本、全部调用者、政策和历史回执。

## P0：启动恢复、基线与交付清单

- 定位损坏JSON路径及写入者，保存损坏证据，修复原子写入/中断恢复并验证farmer和dashboard健康。
- 固定main、远端、三个worker分支、worktree、claim和宿主活动状态；保护未提交和ignored内容。
- 审查d80内容，逐项标记已采用、等价替代、仍需集成，关联文件、提交、验证。
- 对plan_v02过早完成声明追加纠正。只保留一个可用的受控leader交付入口，不重复建线程。
验收：启动可恢复，必要成果均有明确去向，合法写入边界明确。

## P1：修复看板真实任务投影

- 后端统一状态判断，前端只渲染；按host thread去重，分离turn结束与plan完成。
- 明确运行证据才显示运行；异常结束且工作未完成显示中断；正常轮次结束但plan未完显示待继续；等待信息须有checkpoint；已提交未交付显示待集成。
- 数据过期显示未知/疑似中断，不能把5分钟无更新或单一recency当确定的异常/活动事实。
- abandoned历史条目核实处置和未完成工作后退出主看板；未来及重新打开的任务正常进入，不使用永久session白名单。
- 名称查询与可见性分开：宿主标题、计划标题、任务卡逐级回退。无名真实未完成任务不能直接隐藏。
- 展示当前步骤、下一步、计划进度、等待信息和运行子agent数；只保留运行与需处理两组。
- artifact只计去重后的当前有效未解决对象，排除私有runtime、过期扫描和重复promotion候选。
验收：匿名历史误报消失，新任务/恢复/异常/等待信息/提交/完成各有行为验证。

## P2：实时数据与正式档案分离

- 源码、服务、schema、模板、配置和测试进Git；心跳/PID/租约/统计/缓存放现有ignored runtime。
- 只补窄范围ignore；已跟踪runtime明确迁移，不能仅加gitignore。
- 离线plan、正式checkpoint、科研Manifest和必要审计/交付回执保留档案，不为消除M全盘忽略。
- dashboard只读派生，轮询不写第二份科研状态、不生成提交。
验收：轮询和心跳不改变tracked文件，正式checkpoint可恢复并交付。

## P3：每个可交付节点自动发布

固定流程：节点完成 → worker checkpoint → 完整交付清单 → 串行leader集成 → 集成后测试 → 正常push origin/main → 远端SHA验证 → 必要Drive同步验证 → 里程碑tag → 节点delivered。

- 节点必须依赖满足、测试通过、可独立交付；聊天回合、中间编辑、心跳不是节点。失败保持pending，不发布半成品。
- worker只checkpoint，现有leader自动接收。解决worker claim永久挡住leader的交接循环，保留串行锁及用户修改保护。
- 用plan/node/source SHA保证幂等；中断恢复不重复提交或打标签。远端前进则正常整合再测试，不强推。
- 精确提交节点拥有且符合政策的文件，不用git add .夹带用户现场。
- 完成门验证source SHA已为main祖先，或有审核过的逐项替代证据；只查clean/测试/remote相等不足以关闭。
- 节点发布后任务复用原worktree继续；仅任务终结且交付/归档通过才关闭和回收，不每节点重建分支。
验收：两个隔离worker节点无需用户提醒即可串行集成并在Gitee main取得；未交付/推送失败阻止完成标记。

## P4：标签触发调查、归档和自动启用

- 核验实际main/worker的publish-policy、create-task-tag、auto-commit-push、autopilot及任务关闭的调用链；对照本地/远端tag、发布和outbox记录。
- 归档9月11日后push无tag的证据，区分原有“普通提交不打科研结果tag”政策与任务里程碑触发遗漏，不预判全部属于故障。
- 按本次授权，每个通过验收并交付的任务节点自动生成annotated t-*里程碑tag；复用现有入口，绑定已验证main交付SHA、中文摘要、节点及回执。普通心跳/中间checkpoint不打tag。
- 正式科研r-*标签仍要求双报告、Drive和三端验收；本计划不生成科研结果tag。
- 既有tag不可覆盖移动；重试复用同一节点tag并验证远端peeled SHA。禁止历史补标：不对plan_v02、9月11日至25日提交或其他旧节点补tag。不重命名、移动或删除旧tag。只给本次plan_v3实际验收并上传的交付节点打tag。
验收：真实节点完成事件自动生成Gitee可见t-*标签；指向正确提交，重试不重复，失败节点无成功标签。

## P5：部署、恢复与分支自动回收

- 从主checkout重建4317，验证进程来源、served HTML/JS哈希、API、真实浏览器截图及状态迁移。
- 从Gitee干净clone核对交付清单和关键修复；核对Drive manifest内容/哈希、recovery-index云端读回。仅目录可见不能证明内容一致。
- 验证Crawl4AI/browser-use长期项目内路径及私有环境保留，不全局安装、不发布私密内容；回收worktree不丢唯一环境或输出。
- 8f62完整合入后回收；6b5确认等价替代后回收；d80必要内容完整交付后回收。当前执行目录等宿主退出再由监督入口回收，不能自删。
- 回收检查进程、未提交和ignored文件、未交付提交及归档。只清理已交付且不用的worktree/分支；阻塞指出具体内容。
- 只读任务不创建写分支，任务关闭自动收口，用户不承担定期清分支。
验收：main干净、Gitee代码和tag可读、Drive可恢复，任务终结后分支/worktree自动回收；失败保护现场。

## 关闭和续接约定

执行顺序P0至P5。每节点记录当前状态、下一步、source/delivery SHA、测试和回执位置。节点发布失败不判completed。
以实际部署和逐项证据验收，不照抄绿色回执；显式需求缺证据则未完成。归档困难、失败尝试、根因、修复、防回归和剩余边界。禁止重复创建无用leader、递归刷新自引用HEAD或无限状态报告。
当前下一步：P0启动恢复及遗漏内容审查；尚未执行本计划的功能修复、发布或tag。


## 最终用户决定（本节优先于旧草案）

1. 三类新标签统一：t-*用于计划节点交付；b-*用于明确单独发布的基础设施版本；r-*用于正式结果。普通节点默认只有t-*，不为同一交付重复生成b-*。本计划无科研运行，不产生r-*。
2. 历史r0-/r1-等名称作为legacy保留，在文档中解释映射即可；不迁移旧ref，不补历史tag，不回填日期。统一的是今后的生成入口、校验和文档。
3. 修复从本次plan_v3起生效。可交付节点验收后自动push main和打tag，不再要求用户提醒发布/回收。执行早期先建立交付入口，再使用它发布本计划节点。
4. 用户将自行在muIon-beam开启新session，选择gpt-6-luna、推理max。当前session不创建新任务、不切换模型、不执行修复。
5. 本次已由自动入口分配active的codex-d80b7f12073a98b4eb63-2；旧-1仍是遗漏成果来源。两处不能混为一个checkout。当前入口本轮报告farmer/dashboard healthy；此前NUL错误属于历史事件，需复核根因，不能当作持续故障。

## 执行顺序与节点发布划分

P编号保留便于对照，实际依赖顺序：P0审计 → P3交付入口与P4标签最小链 → P1/P2修复 → P5最终验收回收。避免先完成一串阶段后才发现无法发布。

| 交付节点 | 覆盖工作 | 发布前必需证据 |
|---|---|---|
| N0（本次规划文件） | 计划和交接材料 | 文档/schema核验；记录实际是否仅worker checkpoint，不能冒充已push |
| N1 | P0遗漏清单、P3/P4可用交付/标签链 | 合法leader上下文、冲突/并发保护、远端推进处理、幂等tag/失败重试；必要源码通过验证 |
| N2 | P1/P2真实看板、runtime边界、应采用的遗漏修复 | 状态行为测试、真实页面和API、tracked文件不随心跳变化 |
| N3 | P5实际部署、远端恢复、清理 | 完整测试、Git/Drive内容核验、分支处置和恢复证据 |

如果N1内容无法独立安全部署，先在隔离测试仓库验证并记录依赖，再合并成一个可交付节点；不能为凑阶段数push半成品。早期计划材料可随本次首个正式交付一并上传，不为旧任务补标。

## 文件入口地图（先读当前main，再对比旧worker）

- 自动入口/运行：11_tools/project-supervisor/{index,hooks,session-bootstrapper,project-supervisor,runtime-store,services}.mjs。
- 会话与交付：.codex/skills/team/scripts/session-concurrency.mjs、11_tools/project-supervisor/integration-coordinator.mjs、.codex/skills/muion-project/scripts/{begin-task,auto-commit-push,delivery-plan,create-task-tag,publish-gitee}.mjs。
- 标签/发布配置：00_project/config/publish-policy.json、delivery-policy.json、package.json的task:tag及发布入口。
- 看板：11_tools/project-supervisor/progress-aggregator.mjs、11_tools/research-dashboard/{server.mjs,index.html,supervision.js}。
- 归档：现有drive-mirror-sync、recovery-index、audit/ retry入口及00_project/config/drive-mirror-policy.json。按实际文件定位，不新造替代流水线。
- 原计划/事故：本目录plan_v02.*，00_project/traceability/incidents/SESSION-INCIDENT-20260924-DELIVERY-DEADLOCK.md，以及SUBMITTED-RESUME记录。部分仅在旧worker，不存在时读取该worker，不能从空缺推断没有事故。
- 测试入口：tests/{session-concurrency,integration-coordinator,research-dashboard,supervisor-progress,project-supervisor,artifact-promoter,web-research}.test.mjs和tests/architecture-smoke.mjs；文件是否存在以实际版本为准。

## 真实状态规则与验收矩阵

| 输入情形 | 预期看板/系统行为 |
|---|---|
| 宿主正在运行，计划在某一步 | 运行区单卡，显示步骤、下一步；子agent仅计本任务当前运行者 |
| 宿主本轮completed但计划未完成 | 需处理/待继续；不能因turn结束直接隐藏 |
| 明确failed/interrupted且计划未完 | 已中断，保留继续入口 |
| 只有租约到期/旧updated时间 | 状态未知或疑似中断，不能确定为崩溃 |
| 工具长计算但进程确实活着 | 不因五分钟静默判失败 |
| checkpoint明确等待用户参数 | 等待信息，显示具体缺什么 |
| submitted且未交付 | 待集成，不等同于plan完成；恢复工作必须使旧receipt失效 |
| 已回收abandoned且无未完成工作 | 从主看板退出，保留审计 |
| 同一host存在旧/新registry记录 | 按身份与生命周期关联去重，不相互覆盖最新计划 |
| 宿主名称存在但不在活跃查询中 | 仍能解析名称；不出现重复匿名历史卡 |
| 名称和状态数据源不可用 | 集中诊断告警；真实未完成任务可保留可定位的回退名称 |
| 计划完成/旧任务已交接完成 | 不显示历史工作卡；重新打开后依新工作正常显示 |
| 刷新/心跳多次触发 | tracked文件哈希不变；无自动commit/tag |

API只返回看板所需数据，避免每次轮询返回巨大的历史artifact/raw科研数据。旧接口若仍有实际调用者，先查调用链再删除；不为测试保留无用实现。历史清理依据用户已确认范围和后续任务事实，不设永久只显示某一个ID的规则。

## 交付事务与并行锁约束

- “worker checkpoint”“节点delivered”“任务closed”“worktree已回收”是不同阶段；分别记录实际事实。
- 在既有leader-integration/leader-delivery锁下重新检查main/remote/receipt；固定source SHA，不能校验SHA后又merge可移动branch。
- 正常merge必须能证明source SHA为交付main祖先。squash/cherry-pick/替代实现须记录文件级映射和测试，不用git cherry单一输出证明全部需求交付。
- 不用新会话/手改claims/关闭hook绕过宿主写入限制；若适配层入口缺陷，先在授权worktree修复和验证，再通过合法交付入口上线。若宿主确实阻断部署，保存具体证据并提出一次准确的外部操作，不循环建leader。
- 切换写者时冻结已提交worker写入，保存owner/claim/分支，锁内做合法状态转换；不能清空其他活跃任务的claim。释放claim与删除文件分开。
- shared-write不必把所有私有worker视为永久冲突，但任何收窄冲突策略必须证明源码写入隔离、共享状态仍串行并有回归。保持现有安全语义能满足需求时不放宽。
- begin-task获得合法admission之前不得执行外部库同步、提交或推送等副作用；--read-only必须真实只读或明确拒绝，不能静默走legacy写路径。
- main已前进：正常整合，重新测受影响部分，推送重试受次数/证据约束；禁止force-push、reset --hard、git clean或ours/theirs掩盖冲突。
- 节点推进不关闭仍在执行的session；需要用户继续批准时可在原会话恢复未完计划，不创建重复现场。

## 标签契约与防自引用循环

- 首选沿用现有命名，t-*包含任务/节点可读标识和已验证提交标识；创建前把tag名绑定到node交付记录。时间戳在首次准备时固定，重试不可重新取时间生成第二个标签。
- 标签必须annotated，中文说明至少含任务、节点、变更、验证、限制和证据路径。t不宣称科研成功；b只用于明确独立工程release；r由正式科研门负责。
- tag目标必须是已推送main中包含全部节点成果的content commit，不能误取worker或未推送HEAD。远端使用refs/tags/<tag>^{}核验annotated tag指向。
- 同名tag存在且目标一致时幂等成功；目标不同则冲突并停止该tag发布，不移动覆盖。push main成功/tag失败时保留pending-tag，只重试缺失部分，不重复merge。
- 内容提交C先发布/归档，再以tag固定C；后续回执提交R可作为C的后继。记录C与R关系，不要求C包含“引用自身SHA”的回执，不为追逐最新HEAD无限提交。
- 节点的代码、tag、Drive状态分别核验；任一必需步骤失败，节点不能delivered。普通源码push不依赖创建科研结果tag。
- 本次验收要在真实Gitee验证plan_v3标签；失败重试测试用临时本地仓库，不制造测试远端tag。绝不补20260911/20260925或plan_v02的历史标签。

## 回收、备份与唯一内容保护

- 逐worktree检查Git根目录确等于目标路径且.git/worktree登记匹配；目录残留缺少.git时git -C可能向上找到主仓库，不能因此将主仓库780项误认作子目录修改。
- 删除/移动前确认绝对目标在允许范围内、不是主checkout，不沿junction/symlink误删；先列ignored文件和独有commit、检查宿主和工具进程。
- venv、private/profile、API key等只保留合法项目本地位置并git隔离；迁移venv后须验证路径可用，不能仅复制就称环境恢复。绝不将凭据纳入Gitee或普通可分享归档。
- 已交付且无独有文件可用正常Git回收；应用管理的worktree优先用应用归档接口，主/pinned/shared按工具规则处理；未合入分支不得用-D强删。
- 先给出每个历史分支的实际去向，然后回收。新规划-2分支也要纳入最终交付/回收，不能只清理旧三个branch却新增永久残留。
- 任务正在使用的checkout不能自删；关闭后监督组件执行并在独立观测中验证，不能仅排队就声称已经删除。
- Git clone只能取得远端可达提交，不包含本地分支独有内容、ignored文件或私有软件环境。恢复验收分别核对Gitee durable资产与Drive必要数据，不保证商业软件许可或整机环境自动恢复。

## 必需测试与最终验收证据

1. session/integration：resume后旧receipt拒绝；提交后SHA改变拒绝；两worker顺序集成；dirty/冲突/越权保护；只读入口无副作用；claim交接不丢现场。
2. dashboard：上表各类状态、命名、去重和未来任务覆盖；live API/浏览器可见内容与同一部署commit一致；服务重建后仍新版。
3. publication/tag：重复完成事件、网络失败恢复、remote推进、同名tag冲突、提交已push而tag未push；失败不能宣称completed。
4. recovery/cleanup：未提交或独有ignored内容拒绝删除；已归档内容核对后可回收；Git向上发现主仓库的残留目录陷阱；已回收记录不会重现匿名卡。
5. 发布前运行架构检查和改动相关测试；最终运行项目完整测试，任何失败先查根因，不为迎合当前错误实现删断言/跳过测试。测试数量减少须解释移除的实际覆盖。
6. 从干净远端clone验证必要文件/函数/修复，不仅核对main clean；Drive云端读取当前manifest/recovery内容并匹配hash/commit，不能以文件名或modified_time代替。
7. 实际启动节点自动发布链，远端main及t标签匹配；闭环至少两个节点或两个worker交付场景，用户无需再次提醒push。
8. 一份最终完成审计逐条映射本计划要求到实际证据；pending、unknown或只在worker的成果均不得通过。源码、档案和必要生成物分别证明交付。

## 交接与恢复操作

- 本目录plan_v3.md为人读目标，plan_v3.json为该计划的checkpoint摘要，handoff_v3.md为可复制提示词；这些不是科研state.yaml的替代。
- 新session首先读取此文件的绝对路径（见handoff），然后将计划采用到自己的合法工作树，后续以该副本更新。不要把只读来源worktree当作自己的可写位置。
- 历史源码来源：D:/muIon-beam/_work/current/worktrees/codex-d80b7f12073a98b4eb63-1。主部署：D:/muIon-beam。规划来源：codex-d80b7f12073a98b4eb63-2。所有路径执行时检查实际存在和Git根。
- 恢复时先读checkpoint及pending操作，再重核当前Git/宿主/服务，继续最近未完成节点。每节点记录准备、验证、push、tag、Drive、关闭/回收的实际结果。
- 本轮只提交计划文档的worker checkpoint；main发布状态必须据工具结果报告，不能把本地commit说成push完成。新session首个交付包含本计划材料。
- 总体未完成时遇到同一真实阻塞遵守goal阻塞审计，不刷无变化回执、不靠宣布完成重开goal、不自行切换用户指定模型。

## 当前执行 checkpoint（2026-10-04，revision 39）

- N0、N1、N3 保持 delivered；N2 修正已集成到 eff40c47dfe6dd009c402299a14d1024b4457563，并打独立修正 tag t-task-dashboard-plan-upgrade-20261003-n2-fix-eff40c4；旧 N2 tag 保留不动。修正完整行为已通过 14 个 focused progress 测试、220 个全套测试、architecture 150/12，Gitee clean clone 在 eff40c47 验证源码和回归存在。修正之后 main 又合入 checkpoint 文档，当前远端 main 为 87b764e8335a8003f8b8d1df98007ae25dea92a6。
- 最终实际 dashboard/API 发现同一 host 的旧 closed session1 被新 integrated session5 压过：Codex thread 的新 updated_at 覆盖两条 registry 时间后，原去重逻辑按文件枚举顺序选了旧行，页面显示状态冲突。
- 修正方向：保留 registry created_at，当 live host 更新时间打平时选择较新 lifecycle；同一创建时刻以 integrated 优先于 closed。新增测试覆盖旧完成计划与新 live 同 host session 并存；经验记录为 EXP-20261004-dashboard-same-host-dedupe。
- focused supervisor-progress 测试 13/13；完整套件（合入前）219/219；architecture smoke 150 required files、12 variables。合入后仍需再跑完整套件和架构检查。
- N2 已 delivered，P1 已完成；focused 14/14、完整 220/220、architecture 150/12，4317 API/browser 已确认最新 same-host session 的 N2 3/4 且无 closed conflict。最终 Drive manifest 已 browser-readback（SHA256 3b03183efae92d3229b86a1da0bac478a71e9af0e75560b787e1d3fc438c8c02，1,267 文件，451,366,012 bytes），N2 plan 文件已进入 canonical mirror；session5 只剩关闭与自动回收验证。
- 任务不运行正式科研；标签不移动/删除旧 N2 标签，不创建 b-* 或 r-*。

## 当前执行 checkpoint（2026-09-30，revision 12）

- N0、N1、N2 已由现有 delivery gate 集成 main、推送 Gitee、验证 Drive 与 `t-*` 标签；N3 仍 pending，计划与 goal 均保持 executing/active。
- N3 已补充共享 local-runtime/quarantine 分类，以及含固定 source SHA、逐路径替代映射、Drive SHA、host/进程状态和 ignored 内容 disposition 的 supersession cleanup gate；相关测试通过。
- N3 新增 supervisor 安全重启 managed service 的入口和测试；完整项目测试 `node --test tests/*.mjs` 通过 216/216，架构 smoke 验证 150 个必需文件和 12 个变量。
- 当前 N3 source 已标记 `ready-for-delivery`，但节点/tag 仍未交付；最终 N3 receipt 会等四个历史 worker gate、云端 recovery-index 读回和 4317 浏览器验收通过后生成。
- D80-1 的两份历史 quarantine manifest 未改写；153+67 项共 220 个隔离文件（57,622,293 bytes）已逐项核验 source、manifest、已下载 Drive ZIP 的 SHA256。两份 manifest 的条目与 main/Drive 一致，只存在 CRLF/LF 表示差异。回读记录位于本 worktree 的 `_work/current/quarantine-cloud-readback-20260930-verified.json`。
- main 项目内 Crawl4AI 0.9.4 与 Browser Use 0.13.10 均通过 `pip check` 和对应项目 smoke；D80 私有浏览器配置差异及 governance baseline 仍须通过 supersession gate 保留到本地 ignored runtime。
- 已登录 Google Drive UI 显示 canonical `drive-mirror-manifest.json` 与映射盘文件 SHA256 相同；云端 recovery-index 预览落后于映射盘版本，N3 必须刷新并再次云端读回。
- `plan_v3.json` 固定了 N3 要处理的四个历史 session/source SHA：D80-1、D80-2、6b5、8f62；N3 完成的 integration finalizer 将把经门禁验证的逐路径、Gitee、Drive、host 和回收摘要追加为独立 cleanup-disposition receipt。
- 下一步：用现有 node delivery gate 集成并推送 N3；读取云端 manifest 和变更文件，制作完整 Gitee/Drive readback；验证并安全回收四个历史 worker；刷新 recovery-index，重启 4317 并做浏览器验收；通过所有证据后才生成 N3 标签。当前 N3 worktree 仍须等 host-turn 结束后由 supervisor 回收，并在下一次独立核验后才可结束计划/goal。
