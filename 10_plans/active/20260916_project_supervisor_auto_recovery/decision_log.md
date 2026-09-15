# 决策日志

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

## 停止条件

- 发现科研目标、冻结 contract 或登记模型被意外改写；
- 发现 Drive 唯一档案需要删除才能继续；
- 发现自动触发会绕过 AGENTS、active ADR、Manifest 或 research-state；
- 发现 Gitee satellite 造成版本漂移或无法验证固定 commit；
- 发现 worker 会写入主 checkout 或另一个 worktree。
