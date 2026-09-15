# ADR-005：muIon-beam 的培养型科研实体与模块化监督架构

## 设计理念

`muIon-beam` 按一名需要长期培养的科研同事/学生来建设。这个比喻不是装饰，而是项目的运行模型：

- 文件架构、Manifest、报告、索引和归档是它的长期记忆；
- 通用大模型是它在当前任务中的推理大脑；
- 脚本、skill、模型适配器和工具链是可以替换、测试和复用的身体器官；
- 成功、失败、误用命令、恢复过程和有效修复都要形成经验，推动后续任务改进；
- 任务状态、证据和结论必须先记录事实，再进行解释；
- 失败不能被抹平，成功不能脱离证据，未验证内容必须显式保留；
- 每次任务都应留下可接续的 checkpoint、下一步和未解决问题。

后续默认采用这套培养方式，不再把每次行为记录、复盘和经验继承当成临时要求。

## 模块化原则

项目采用面向对象和单一职责的设计理念，接近 C++ 项目的模块边界：一个组件只拥有一类状态和一类决策，组件之间通过明确接口、事件和不可变数据传递协作。`project-supervisor` 是编排外观，不是把所有逻辑塞进一个脚本。

计划中的组件边界如下：

| 组件 | 责任 | 权威状态 |
|---|---|---|
| `ProjectSupervisor` | 生命周期编排、依赖注入、启动/停止/恢复顺序 | supervisor run record |
| `ProcessSupervisor` | farmer、dashboard 等本地进程的 ensure、health、stop | process leases |
| `SessionBootstrapper` | session identity、context、worktree、lease 和 ownership 初始化 | session registry |
| `DispatchPlanner` | 任务拆分、依赖、资源和并发 wave | dispatch manifest |
| `WorkerRuntime` | worker 心跳、checkpoint、失败分类和重派 | worker ledger |
| `ResourceCoordinator` | COMSOL、SolidWorks、WSL、共享构建等独占资源 | resource leases |
| `ArtifactPromoter` | 从 worktree 归位代码、运行、报告和结果 | artifact manifest |
| `ProgressAggregator` | 汇总所有 branch/session 的进度、阻塞和下一步 | derived overview |
| `SyncCoordinator` | Gitee、Drive、本地三端保存、校验和恢复包 | sync-state |
| `ExperienceRecorder` | 行为、失败、成功和复用价值记录 | experience records |

各组件必须可单独测试、替换和恢复；不得互相直接修改对方的权威状态。事件日志只追加，汇总视图可重建。`research-state/state.yaml` 仍然是科研状态唯一 Source of Truth，supervisor 不创建第二科研状态源。

## 自动触发边界

除 `evolution` 外，所有项目脚本和 skill 都属于 supervisor 可调用的内部组件。用户只提出任务，supervisor 自动选择并调用所需组件；普通任务不得要求用户手动执行 farmer、dashboard、worktree、dispatch、QA、同步或恢复脚本。

`evolution` 继续保留人工决策：它只能生成候选、风险、兼容性和采用建议，用户决定是否采用以及采用范围，防止底层规则被删除、退化或静默替换。

## 并行默认值

任务需要写文件时，默认进入独立 worktree。能证明 ownership 不相交时并行；无法证明时仍创建独立 worktree 并行，最后由 leader 集成。只有共享科研状态和独占工具资源按锁串行。未知情况不能退回到多个 session 共用主 checkout。

## 进度和经验

每个 session 必须产出结构化状态：当前阶段、最后 checkpoint、changed paths、未登记输出、阻塞原因、错误分类、下一步、分支和 worktree。`ProgressAggregator` 将这些记录汇总成总进度，按 branch、task、问题类别和 artifact 目标展示，不因阻塞数量增加而丢失分支信息。

经验记录使用 `EXP-*` 追加文件。行为失误和技术失败与物理失败分开归类；同类经验累计后应推动自动门禁、测试、skill 或 supervisor 规则改进。
