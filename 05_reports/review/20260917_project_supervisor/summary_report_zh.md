# 自动监督与并行入口：阶段简报

已从规则冻结推进到服务监督和自动 session bootstrap。用户无需手动启动 farmer/dashboard；智能体按 AGENTS 调用统一入口，可信宿主 hooks 调用相同组件。

已实现：

- farmer 保持 session 恢复单一职责；独立 ProcessSupervisor 检查 farmer 心跳和 dashboard 状态。
- dashboard 已在 127.0.0.1:4317 运行。受控停止后被监督器自动拉起，服务状态和分支进度可读。
- 写任务自动建立私有 worktree；恢复复用原分支。明确 claim 冲突拒绝，未知独立性在双方私有隔离下保留各自修改。
- 未登记、包括 Git 忽略的输出进入带路径、大小、SHA256 和下一步的清单。
- 放宽模型源码上传资格，保留二进制/生成目录/内容/体积门；运行环境和重建闭包已有独立档案。

本轮修复的实测问题包括 claim 尾斜杠、中文/空格路径解析、被拒任务的空 worktree，以及 preflight 对合法 worktree 的误拒。

尚未完成：宿主原生 hooks 的新任务投递验收，任务完成到 artifact promotion/leader integration 的全自动闭环，Drive canonical 重整与恢复演练。P5 跨机器和任意子进程写边界继续延后。当前不是“全部自动化已验收”的最终报告。

2026-09-18 发生 farmer 恢复循环事故：已写入持久 emergency pause，farmer 与 project-supervisor 进程保持 0，dashboard 独立保留。重复 queue 的具体 message ID、CLI 无取消接口、未完成事项和隔离验证见 `FARMER-INCIDENT-20260918.json`；在用户明确解除停用前，不会自动恢复 farmer。
