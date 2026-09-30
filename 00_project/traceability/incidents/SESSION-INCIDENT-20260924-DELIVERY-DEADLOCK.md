# plan_v02 交付阻塞与错误尝试

状态：未解决的部署阻塞；集成回执漏洞已在 worker 修复，尚未部署。

## 可核验事实

- 当前任务被 automatic-entry 明确绑定到 `codex-d80b7f12073a98b4eb63-1` worktree；不能通过修改 cwd、派发子任务或更改规则来获取主 checkout 写权限。
- 主 checkout 最后复核为 `5b5e8d1cb985e8fa27b3a141e408507b00f84693`，仍有 778 项差异。`blocked-dirty-leader` 只说明集成前置条件失败，不会自动治理这些文件。
- 新任务 `01a0d30a-c8b6-7c83-8756-e8056c08fece` 虽以 local 模式创建，项目入口仍为它分配 `codex-3ccd22a2c36ea48297e2-1`。任务标题中的 leader 不赋予写主目录的能力。
- 两次 handoff（`exec-8fe1a0d7-0142-4f1d-86a3-ab66a99a5132`、`exec-c9e30635-7b31-4182-9dc5-e361eca23c64`）均返回 `handoff_failed`，失败步骤为 `apply-changes-to-worktree`；工具报告方向是 move to worktree，并非已切换到主 checkout。
- handoff 回报中 stash 步骤标为 done。此前“未执行任何 stash”的概括不能用于这两次工具操作；未逐项审计其内部 Git 副作用，不能推断为完全无副作用。
- 临时任务随后报告关闭 session、释放 claim、删除对应 worktree。父任务只读确认该目录不存在、主 checkout HEAD 和 778 项数量未变。临时分支保留，其他 handoff 残留未完成审计。
- 临时任务清理期间遭遇 model capacity 错误；父任务更改了它的模型。后续应保持用户选定模型，不能把容量错误当成自行切换模型的授权。
- 4317 的 healthy 仅说明服务响应；实际仍运行主 checkout 旧 dashboard，不能作为新版本交付成功证据。
- create_goal 对已有 blocked goal 返回 unfinished-goal 错误；不能为“重启”伪造 complete，也不能把调用失败说成已激活。

## 追加复核：没有可复用的主 checkout leader

2026-09-24 复核主项目 session registry：没有 `shared-write` session，也没有 `worktree_path=D:\muIon-beam` 的可复用 leader。现有活动记录全部是独立 worktree；因此不能把旧 session 当作主目录写入授权。当前 goal 仍可在 worker 继续修复生命周期与交付工具，但主目录治理只能在宿主提供真实 leader 写上下文后执行。

## 本轮确认并修复的独立漏洞

`applyIntegration` 原先忽略 submitted 状态和 receipt，直接合并移动中的 worker branch；`planIntegration` 会用最新 HEAD 覆盖旧回执。恢复工作或提交后改动因而能绕过新提交的边界。

复现测试 `tests/integration-coordinator.test.mjs` 的 `resuming invalidates integration eligibility until a fresh clean submission` 在修复前失败（Missing expected exception）。修复后：

1. resume 保留旧 receipt，但 active session 不可集成；协调器不会自动重新 submit 已恢复的任务。
2. planning 与 apply 共用校验：submitted、ownership、clean worktree、pending receipt、session/branch/SHA 一致。
3. stale receipt 不再被 planning 重写；新 checkpoint 必须重新 submit。
4. apply 合并固定 SHA，并与 resume/submit 共用 session registry 锁，避免状态转换交错。
5. 13 项 session-concurrency/integration-coordinator 测试通过，包含合法集成、冲突保留、dirty leader 和恢复后重新提交路径。测试在当前 worktree 的 `_work/test-tmp` 中运行，未修改主 checkout。

## 防止重复错误

- 先验证实际写入边界和已有 leader 执行能力，再派发；不能靠任务名称、local 标签或线程 metadata 推断权限。
- 不再重试相同 handoff，不用其他线程或子进程绕过当前写入限制，不修改 hook 输出/信任状态来解除限制。
- 不把相同状态的重复检查、刷新 SHA 回执和新建任务算作交付进展；已有证据无变化时保持明确阻塞。
- 交付包内 SHA 是历史检查点，不可能引用包含自身更新的提交；最终集成时解析实际 branch HEAD，再 submit 并固定其 receipt。禁止反复“刷新最新 HEAD”制造无限文档提交。
- 必须在实际执行上下文允许主 checkout 写入后，才执行既有逐文件治理清单和集成；当前尚无完成该边界变更的证据。后续持久部署、Gitee/Drive 验收仍待完成，不能标记 plan_v02 completed。

2026-09-24 后续复核发现主 checkout 外部新增提交 `c7b3a017b18fe81f63bbb173e3c88623a7c636f2`（仅登记 `06_external_lib`），主 checkout 变为 `39 M / 235 D / 506 ?? = 780`，并未包含 plan_v02 worker。该提交保留为外部变化，不能误判为 leader integration；plan 的 baseline disposition 必须重新解释这 2 个新增条目。

关联：`leader-integration-blocker-20260924.json`、`dashboard-live-drift-20260924.json`、`SESSION-INCIDENT-20260924-SUBMITTED-RESUME.json`、`10_plans/active/20260924_dashboard-and-plan-upgrade/plan_v02.md`。

修复提交：`e67bc181eee968a4efa0e71ccccfffb1344ebace`。
