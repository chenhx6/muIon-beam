# configure 全库深度研究与 muIon-beam 差距报告

## 来源与边界

研究对象为 Gitee `zhangxin8069/configure`，固定 revision：
`5b98575eaa89aae11e60379585797e3ce7b7a67d`，许可证 MIT。

本轮只做只读研究。没有执行外部 launcher、hook、plugin、安装器或 shell 测试，
没有复制外部文件到 muIon-beam，没有改变当前文件命名、目录、Manifest、tag、
上传、Gitee/Drive 同步或科研 contract。

## 最值得吸收的通用思想

### 继续与恢复：go-on

`go-on` 不是简单发送“继续”，而是先从运行器输入、Git 状态、AGENTS、原生会话
和进程现场交叉确认上次任务；一次性确认任务对象、进度、遗留项和继续方式；优先
原生 session continuation，失败后才手动重建，并要求继承 TODO/checkpoint。

对 muIon-beam 的价值是给 farmer/workflow-store 增加 recovery lease、任务确认和
“已完成后不再 resume”的边界。

### 全自动与收敛：auto + goal

`auto` 是目标技能包装器：一次性授权后零交互，复用目标技能，不复制领域细节；
每轮记录证据，检查通过条件、收益阈值、停滞轮数和中断信号；轮数耗尽或收益不足
不等于目标完成。它还要求复用同一个原生 goal，不能创建重复目标。

对 muIon-beam 的价值是给 autopilot 增加通用 convergence guard，但 goal 只能映射
到 research-state，不能产生第二个科研目标真源。

### 配置库升级：up

`up` 先做 skills/tools/hooks/plugins 四树只读基线，再做多源互证、差距表、最小改动、
结构/行为验证和收敛判定。自我进化每轮最多采用一个有证据候选，并保留安全边界、
验证闭环、镜像同步和不越权不变量。

对 muIon-beam 的价值是把现有 evolution 的 candidate 评估扩展为本地 capability matrix，
让“外部思想值得借鉴”与“外部文件适合复制”保持分离。

### 并行和长期协作：dispatch + team

`dispatch` 负责一次性独立域拆分：证明独立性、自包含 prompt、同批派发、整合后全量
验证。`team` 负责更长生命周期：先画状态机，再隔离 workline，检查 heartbeat/diff/
exit code，分类失败并重派，最后回到集成树收敛。

对 muIon-beam 的价值是补齐当前 team dispatcher 的 worker lease、健康检查、局部重派
和集成抽查；不会假装 Codex runtime 已经提供 filesystem sandbox。

### Hook、runtime 和验证

`configure` 将 hook 设计为显式 adapter，而不是假设 Codex 自动发现目录；runtime 有
manifest/state/context/event，status 工具只读；verify 脚本检查路径边界、符号链接逃逸、
空白、Shell 语法、staged 文件和 runtime 数据路径。

对 muIon-beam 的价值是：

- farmer 的 queue 结果必须区分“已排队”和“新 turn 已开始”；
- pending 必须有 watchdog；
- 成功 task_complete 后必须释放 recovery lease；
- resource lock 需要 owner/TTL/stale/非 owner 释放测试；
- evidence gate 需要 failure injection，而不是只测成功路径。

### 研究记录与物理建模

`research-notes` 规定事实先于结论，证据索引独立存在，结论只分确证/推断/未验证，
最后必须有可接续摘要。`phys-model` 规定对象、连续方程、量纲/对称性/守恒筛查、离散化、
误差预算、极限/退化检查和最小实现验证闭环。

对 muIon-beam 的价值是增强现有 evidence bundle、module report、open-problem 和
COMSOL/Geant4/3D validation 的前置模型检查，不改变冻结 contract。

## P1 采用清单

1. farmer recovery lease、queue stderr/exit、pending watchdog、manual retry linkage、
   no-resume-after-success；只监控 `D:\\muIon-beam`，保持原模型。
2. research-state 只读 status presenter：统一 NOW/workflow/next-action/blocked view，
   可打开到 Codex 面板，不做原生 UI 插件，不创建第二状态源。
3. goal/checkpoint adapter：只建立 runtime goal 与 research-state 的映射。
4. go-on continuation protocol：多源恢复、TODO/checkpoint 继承、原生 session 优先。
5. auto convergence guard：停滞检测、收益/通过标准、中断和 contract/publish/archive 门。
6. farmer/hook/resource-lock 的失败注入与恢复回归测试。

## P2 采用清单

- research-notes 的过程记录、证据索引、可接续摘要；
- phys-model 的量纲、守恒、极限、退化和误差预算门；
- team heartbeat、health-check、局部重派和集成抽查；
- review 反馈验证和技术性反驳闭环；
- up 的差距表、技能表、互鉴表和单候选自我进化；
- 将跨平台 runtime 字段映射到现有 ledger，但不引入 `configure/data/runs`。

## 明确拒绝或延后

- 不采用 `configure/data/runs/<run-id>`；
- 不复制 configure launcher、shell 环境、机器特定默认值或安装器；
- 不执行外部 hooks/plugins/launchers；
- 不把 Codex 原生 UI 扩展作为前置条件；
- 不因容量错误自动切换模型；
- 不把外部技能的完成/收敛当成科研结论。

## 当前状态

本轮完成来源固定、许可证核验、skills/runtime/hooks/data/tools/plugins 研究和差距矩阵。
没有实施 P1/P2；后续实现必须另行锁定具体 P1 范围并保留现有 canonical project layout。
