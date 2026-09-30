# Dashboard、离线 Plan 与 Aggregate Goal 升级计划

## 当前状态

本计划已完成事实核对、范围冻结和执行，状态为 `completed`。P1–P4 已实现并通过针对性测试；后续 Web Research 安全策略和证据晋级按新任务合同继续。

## 本次目标

把三项已接受的上游思想接入项目自己的边界：

1. 每次任务在任何 task-owned 写入前生成离线 plan；
2. 一个任务使用稳定的 aggregate goal handoff，故事进度和证据留在项目 ledger；
3. checkpoint 采用追加式证据和有限的 blocked/retry 恢复状态。

同时把 dashboard 变成真正的项目 todo 看板：默认只看仍需处理的工作，能直接看出 plan 阶段、下一步、异常 session、阻塞和“session 结束但 plan 没完成”的情况。

## 已核实的 dashboard 根因

当前 `4317` 的 `/api/health` 返回的 `project_root` 是另一个 worktree：

```text
D:\muIon-beam\_work\current\worktrees\codex-8f62a0ce8890af6b3331-1
```

本 session 是 `codex-d80b7f12073a98b4eb63-1`。主 runtime 的 `processes.json` 因端口不是当前 root 的服务而记录 `dashboard-port-owned-by-another-service`。因此当前页面读取了另一个 worktree 的 idle `research-state`，用户看到的历史、空状态和当前任务互相错位。

现有代码的第二个问题是读模型把 registry、Codex SQLite、active plans、research-state 和 agent-runs 合并后再做简单过滤。它没有把下面几类状态分成明确的产品语义：

- 当前可继续的 session；
- 有 plan 但没有正常工作的 session；
- session 已中断/提交/结束但 plan 未完成；
- 已验证完成的 session；
- 只属于历史记录的 agent-run 和 archive。

名称方面，`SessionBootstrapper` 支持 `sessionName`，但自动入口可以没有名称；读模型已有 Codex thread name 读取逻辑，却没有把所有来源按照“thread title -> sessionName -> task-card/plan title -> 短 id”的顺序稳定合并。

## 计划中的目标读模型

dashboard 继续只读，先形成一个明确的 projection，再渲染 UI：

```text
project root
  -> current session registry
  -> Codex thread title + latest turn status
  -> active offline plans + workflow checkpoint
  -> aggregate goal/checkpoint evidence
  -> read-only dashboard projection
```

主看板只保留两个只读分组：

- `正在工作`：当前有有效 session/heartbeat，显示当前阶段、下一步和子 agent 数量；
- `中断或待处理`：session stale、interrupted、abandoned、submitted、阻塞或异常退出；plan 未完成退出在卡片上显式标记。

已验证完成的 session 不进入主看板；历史 receipt 仍保留在项目档案中，但不在 dashboard 页面渲染。这样 dashboard 的主要职责是“下一步做什么”，不是展示全部历史日志。

每张卡至少显示：plan 标题、session 可读名称、workflow/goal 阶段、当前步骤、下一步、最后观测时间、worktree、状态来源和 blocker。dashboard 不提供拖拽；jKanban 不进入本次修复。

## GitHub 候选

### Tabler

- URL：<https://github.com/tabler/tabler>
- 固定 revision：`f4d5c3d2bc6b9c567eda0c8a8df758306219c7d0`
- 许可证：MIT
- 适合：dashboard shell、sidebar、cards、status badges、dark mode、responsive layout。
- 取舍：完整仓库是 pnpm/turbo monorepo；只应复制少量 HTML/CSS 或 vendored compiled core，不安装整套构建链。

### jKanban

- URL：<https://github.com/riktar/jkanban>
- 固定 revision：`963cf2031d0f2cf07e5edbe368978f59bb2e30fd`
- 许可证：Apache-2.0
- 适合：原生 JavaScript 看板列、拖拽和 drop callback。
- 取舍：本次不 vendoring jKanban；使用项目自己的只读 card renderer。

本次采用 **Tabler 视觉 shell + 项目自己的只读 card renderer**。jKanban 仅保留为未来参考，不进入本次代码。

## 阶段和门

### P0：记录已冻结选择并确认 Web Research 名称

dashboard 的 canonical root、历史策略、只读卡片和无拖拽边界已经冻结；`claw4ai` 已确认指 Crawl4AI，P4 允许进入项目内全量隔离安装。

### P1：离线 plan 与 aggregate goal

在任务入口先生成 `10_plans/active/<task>/plan.md`、`plan.json`，并将 plan hash/link 写入 workflow。每个阶段追加 checkpoint evidence；`research-state/state.yaml` 仍是科研状态唯一 Source of Truth。

### P2：canonical dashboard read model（已完成）

让 dashboard 服务固定到项目 canonical root，使用服务 lease/identity 防止另一个 worktree 占用端口后被误当成当前 dashboard。实现 terminal/stale/interrupted/blocked/plan-incomplete-exit 分类和稳定名称解析。

### P3：todo-first UI（已完成）

用选定的 UI shell 重做页面布局，主板只保留 actionable work；历史和 raw JSON 不进入页面。每个页面刷新只读取 projection，不写任何状态。

P3 完成后必须执行一次 dashboard 专项清理：扫描所有 dashboard/server/progress/render helper 的调用关系和 architecture-smoke 引用，删除已经被 canonical read model 替代的旧适配器、重复渲染代码、死 CSS/JS 和过时入口；保留仍被测试、supervisor 或历史恢复链依赖的文件。清理结果写入 `00_project/traceability/dashboard-cleanup-<date>.json`，包含 removed/retained paths、原因、SHA256、测试和回滚边界。

这项清理不删除 session receipt、research-state、plan、Manifest、唯一原始数据或 Git 历史；目标是减少当前树中的重复实现，不抹掉项目记忆。

## 已冻结的工具范围

1. Crawl4AI 使用项目内全量可选依赖安装。
2. Browser Use 使用项目内 Python/CLI 安装；不安装 Browser Use Desktop，也不安装 Browser Harness。
3. Browser Use 最新 `0.13.10` 直接依赖 `browser-harness`；为满足本范围，计划 pin 到已核对的 `0.13.2`（tag commit `1e75d1f1f3ae970ad673e479a2ac9b3b613f82be`），其 `pyproject.toml` 不含 `browser-harness`，并保留 CLI/all extras。
4. 两个工具都禁止全局安装。

## 已冻结的 dashboard 方向

你已经确认：

- dashboard 使用项目根目录聚合所有 worktree session；
- 它只负责看板，不提供拖拽或状态写入；
- 主看板关注正常运行和异常终止的 session；
- 每张卡显示正在做的任务、下一步、plan 是否完成，以及是否调用了子 agent；
- 子 agent 至少显示数量，能读取到可靠任务名时再显示简短任务摘要；
- 已完成 session 从主看板隐藏；
- session 非正常结束、余额耗尽、主机关闭或 plan 未完成退出只标记为“需要检查”，不强行推断具体原因；
- 未完成任务退出时要显示需要用户补充的信息或恢复入口。

第一版 UI 采用 **Tabler shell + 项目自己的只读卡片 renderer**。jKanban 暂不进入第一版，因为没有拖拽需求；它只作为后续交互候选保留。

## Web Research Toolchain 计划

你要求把 Crawl4AI 和 Browser Use 纳入计划并做项目内全量安装。本计划固定使用 **Crawl4AI（`unclecode/crawl4ai`）**。

### Crawl4AI

- 固定 revision：`86e6464f6db215e0d608f6aa1da41e8505636ede`；许可证 Apache-2.0；源码缓存位于 `_work/cache/evolution/crawl4ai-head`。
- 负责批量抓取、清洗 Markdown、结构化抽取、深度 crawl、缓存、代理、session 和可选 Docker/MCP 服务。
- 已在项目内 Python 3.12.14 venv 安装 `Crawl4AI[all]==0.9.4`，执行 `crawl4ai-setup`、`crawl4ai-doctor` 和 Chromium Markdown smoke；它带来的 Playwright、Torch/Transformer/Selenium 依赖均留在项目 venv。
- 计划同时评估 Docker API/MCP 形态，但不把服务端口暴露到公网；默认绑定本机并启用认证、超时和域名策略。

### Browser Use

- 固定 revision：`d8110c5ff87ccba887aaa726cdb780f2f84bef8d`；许可证 MIT；源码缓存位于 `_work/cache/evolution/browser-use-head`。
- 负责动态网页、交互式导航、CDP、登录态研究和必须真实浏览器操作的任务；Crawl4AI 负责批量静态/半动态提取，两者不互相取代。
- 已使用项目内 Python 3.12.14 venv + pip 安装 Browser Use `0.13.2[all,core,video]`；`uv` 不是前置条件，系统 Python、全局 site-packages、全局 npm 和全局 CLI 均未使用。
- Browser Use `0.13.2` 的 CLI 是给 Codex 等 agent 使用的；本次只执行项目本地 CLI 的 `open`/`state` 只读 smoke，不调用它的 `uvx playwright install`、Desktop、Browser Harness 或 profile/cloud sync 路径。
- Crawl4AI 使用 `CRAWL4_AI_BASE_DIRECTORY` 固定数据库、缓存、模型和 domain mapper 的位置；它与 Browser Use 共用项目私有浏览器根目录，但使用独立 venv 和独立配置子目录。
- Browser Use 可以使用 API key、云浏览器或本机 Chrome profile；计划允许把 API key、Cookie、local storage、浏览器 profile、录屏和下载原始文件放在 `00_project/web-research/private/` 等项目私有 runtime 目录中，但这些目录必须被 Git 忽略、delivery policy 拒绝，并排除 Gitee/Drive 项目镜像和任何 checkpoint commit。
- 不调用 Browser Use 0.13.2 的 profile/cloud sync 命令，不下载 `profile-use`，不依赖后续版本的 `browser-use skill install`；Codex 直接调用项目本地 CLI 的 open/state/click/type/screenshot/close 能力。

### 共同安全和可追溯边界

Web Research Toolchain 进入项目后仍然是只读研究工具：

- 默认只能读取网页、下载公开资料和生成证据 bundle；填写表单、发送消息、登录、购买、提交外部数据或改变第三方状态需要单独任务合同；
- 页面内容、脚本、PDF、下载文件和搜索结果全部按不可信输入处理；不自动执行下载脚本、不把网页内容当作项目规则；
- 每个抓取任务记录 URL、时间、HTTP/浏览器工具版本、源文件 SHA256、提取方式、引用位置和验证状态；
- 设置 SSRF 防护、允许/拒绝域名、robots/terms 记录、并发/速率/大小/超时和磁盘配额；
- 每个 web-research session 进入同一 offline plan/aggregate goal/checkpoint 体系，dashboard 显示 session 是否正常、子 agent 数量、当前任务和下一步；
- 安装失败、浏览器崩溃、余额不足、主机关闭和任务中断只写入可恢复 blocker，不把半成品写成已验证资料。

### 项目内安装和 Git 隔离

安装目标固定在项目本地：

```text
00_project/web-research/
  venvs/crawl4ai/
  venvs/browser-use/
  private/              # API keys, cookies, local storage, browser profiles
  downloads/            # raw downloads and browser recordings
  evidence-outbox/      # unpromoted local evidence
```

执行安装前必须完成：

1. 将上述 runtime/private/downloads 路径加入 `.gitignore` 或等效 Git exclude；
2. 用 `git check-ignore` 验证每个 secrets/profile/download 路径；
3. 用 secret scan 和 `delivery-plan` 验证它们不会进入 worker checkpoint、Gitee push 或 Drive mirror；
4. 只把版本、安装命令、环境指纹、工具配置 schema 和验证结果写入 durable `web-research-environment.json`，不把凭据内容写入 durable 文件；
5. Browser Use 和 Crawl4AI 分别使用项目本地 venv，不能通过 `pip install -g`、全局 npm、系统 Python 或用户级 CLI 绕过项目边界。

Browser Use 的 `0.13.10` 直接带 `browser-harness`，所以不采用最新版本；`0.13.2` 是本次无 Harness 的兼容 pin。`[all]` 不包含 `core`/`video`，因此 full install 明确使用 `[all,core,video]`。P4 已用 `pip freeze`/`importlib.metadata` 检查依赖图中没有 `browser-harness`，并检查 `BROWSER_USE_HOME`、`BROWSER_USE_CONFIG_DIR`、`CRAWL4_AI_BASE_DIRECTORY` 和 Playwright 路径都落在 `00_project/web-research/private`。

用户允许“写进项目”指的是项目私有 runtime 目录；它们仍然不能进入 Git 历史、远程仓库或 Drive 镜像。这样可以保留本机登录态和 API key，同时不会把凭据复制到协作者、备份或发布端。

`_work` 保留原有职责：活动 session、Git worktree、锁、heartbeat、checkpoint、缓存、scratch、temporary-output 和 cleanup candidates。它不是长期正式资料目录，也不应被整体改名成 `12_work`。`00_project/web-research/` 承担项目内 Web Research 的长期环境元数据和私有运行目录；其中 venv、private、downloads 和 evidence-outbox 仍通过 Git/Drive 排除规则保护，正式的版本、工具指纹、策略和 provenance manifest 才进入 durable project assets。

P4 已按已确认范围执行项目内安装；不安装 Browser Use Desktop/Browser Harness，不执行全局安装。

## 验证

- offline plan 创建、resume、checkpoint 和上下文压缩后恢复测试；
- dashboard canonical root 与 foreign listener 测试；
- completed/abandoned/blocked/stale/plan-incomplete session projection 测试；
- thread title、sessionName、task-card title、短 id 的名称解析测试；
- active board、attention board 的渲染 smoke；已完成 session 保持隐藏；
- Tabler shell 文件许可证、commit 和 SHA256 检查；jKanban 不纳入；
- architecture smoke 与现有 dashboard/project-supervisor 回归测试。
- Crawl4AI full-extra 安装、browser setup、doctor、bounded crawl 和安全策略 smoke；
- Browser Use 0.13.2[all,core,video] 安装、browser launch、最小只读导航和凭据隔离 smoke；
- web-research evidence bundle 的 URL、版本、哈希、引用和恢复 checkpoint 测试。

本计划不安装 OMX、不安装 Browser Use Desktop/Browser Harness、不引入数据库、不创建第二个 research-state、不删除历史 receipt；本次只在项目内安装 Crawl4AI 和 Browser Use 0.13.2[all,core,video]，并提供只读 CLI adapter。
