# ADR-006：Gitee、Google Drive 与本地的三端恢复契约

## 目标

三端保存的目标是让设备迁移或本地硬盘损坏后，可以先在 Google Drive 上继续查阅和恢复，再把项目迁移到新硬盘；同时让其他人可以从 Gitee 拉取项目，使用 Codex 经过有限的依赖恢复后继续工作。

## 三端职责

### Gitee：可重建的项目历史

Gitee 必须包含足以重建工作流的必要内容：

- `AGENTS.md`、项目决策、行为规范和模块边界；
- `.codex/skills/` 中的项目 skill、脚本、schema、模板和测试；
- `07_research_system/` 的控制层、模块入口、合同和验证逻辑；
- 任务卡、计划、模型/运行 Manifest、报告、索引和经验记录；
- 重要的小型结果、图表元数据、同步 receipt 和恢复说明；
- 生成 SQLite、索引或报告所需的源文件和重建命令。

从 Gitee clone 后，应能识别当前状态、继续任务、重建索引并运行项目 QA。大型二进制模型和完整原始输出可以不进入 Gitee，但必须存在可验证的 Manifest、路径、版本、哈希和 Drive 引用。

### Google Drive：完整的项目和运行档案

Drive 是本地不可用时的可继续工作副本，保存：

- 与 Gitee commit 对应的完整项目快照；
- 大型 CAD/COMSOL/Geant4 模型、完整运行输出和有价值的中间结果；
- 当前 canonical mirror 中与本地 `03_runs/<...>/<run_id>` 相同相对路径的运行归档；旧 `simulation-runs/<run_id>` 仅作为历史 receipt 路径保留；
- 外部参考库和许可证归档；
- 每个快照和运行的 `sync-state.json`、数量、大小和 SHA256 证据。

历史根目录下已有 `project-management/project-snapshots/`、`simulation-runs/`、`external-libraries/` 和旧迁移归档。ADR-009 将新写入统一到本地树镜像；P4 重建允许在完成 canonical copy、去重、唯一内容确认、数量/大小/SHA256 校验和 recovery-index 写入后删除已经验证为冗余的旧目录；验证前不得删除，唯一内容不得删除。

### 本地：活动现场和可丢弃缓存

本地保留正在运行的 session、worktree、锁、heartbeat、checkpoint、未验证 outbox、缓存和临时构建环境。它们不能成为唯一事实源；有价值内容必须先提升到正式运行目录、Gitee 或 Drive。

## 结果归位和未登记输出

worktree 中的输出不能无限期停留在 `_work`：

1. supervisor 发现新输出并创建 artifact record；
2. 可重建缓存进入 cache index；
3. 代码、skill、规则和小型结果进入其项目规范路径并提交 Gitee；
4. 正式运行输出提升到 `03_runs/formal/<run_id>`，报告进入 `05_reports`，轻量图表和结果进入 `04_results`；
5. 大型模型和完整原始输出复制到 Drive 运行归档并完成 SHA256 校验；
6. 未知或缺少 Manifest 的输出进入 `unregistered` 队列，保留原件并阻塞清理，不自动删除。

`ProgressAggregator` 必须把每个 branch/session 的 artifact、阻塞原因、问题分类和下一步汇总出来。大量阻塞应形成可排序的 triage 队列和问题簇，而不是让总进度只显示一个 BLOCKED。

## 恢复路径

```text
新设备
  -> 从 Gitee 拉取可重建项目
  -> 从 Drive 读取最新 project snapshot 和 sync-state
  -> 校验 Gitee commit、Manifest、文件数量和 SHA256
  -> 恢复依赖和本地运行环境
  -> 继续未关闭的 task/session
  -> 按 run_id 恢复正式运行和报告
```

`sync-project-snapshot.mjs` 负责已提交项目内容和 SQLite 快照；`sync-three-end.mjs` 负责单个运行目录。二者都不能把未登记 `_work` 状态宣称为完整备份；本地树镜像由独立 `drive-mirror-sync.mjs` 在任务交付/归档事件中按 retention policy 处理。顶层 recovery index 把当前 mirror、历史 receipt、未关闭任务、经验汇总和下一步串联起来。

## 当前澄清

- Drive 是恢复副本和大型结果档案，不是随意堆放的临时目录；现有历史目录在 P4 校验完成前保留，整理必须有 manifest、哈希和可回滚迁移表，验证后允许删除已确认冗余的旧目录。
- Gitee 是可重建历史，不只保存源码；规则、skill、行为档案、任务源、Manifest、报告、索引和必要结果都属于交付内容。
- 本地 `_work` 是运行现场，不是最终结果目录，也不是唯一记忆。
- 当前未提交工作树内容不等于已同步；自动 supervisor 以后必须在任务完成门后提交并触发三端同步，不能把脏工作树当作远端事实。
- 用户明确表示当前数据无需额外保密分类；仍保留路径、哈希和发布审计，目的是完整性和可恢复性，而非限制正常项目协作。
