# Drive OAuth 对齐与 M/D/?? 治理计划

## 目标

让 Google Drive connector 使用 `malakarlio29@gmail.com` 读取已经由浏览器确认可见的
`muIon_archive/muIon-beam` canonical mirror；随后按 ADR-006/ADR-009 验证 manifest、
recovery index、文件数量、大小和 SHA256，并在不改写脏主 checkout 的前提下处理运行输出和
M/D/?? 现场。

## 当前事实

- 浏览器账号 `malakarlio29@gmail.com` 可以看到 `muIon-beam` 和 `drive-mirror-manifest.json`。
- connector 已切换并返回 `malakarlio29@gmail.com`；目标 folder、`drive-mirror-manifest.json` 和 recovery index 均可读。
- Gitee `origin/main` 已指向 `db02f51cb3913294239c1a505049f8fa5e0ed0cd`。
- supervisor 代码已接受同一 Git common root 下的 dashboard worktree；实时 dashboard API 和页面正常。
- 主 checkout 的 778 项 M/D/?? 现场只读保留。

## 执行门

1. **P3 OAuth 对齐**：已完成；connector link `link_6ab3e98996a48191821511fd47b0748f` 返回目标账号 `malakarlio29@gmail.com`。
2. **P4 API 读回**：已完成；connector 读取 canonical folder、manifest 和 recovery index，记录了 file IDs，下一步是对齐最新 Gitee commit。
3. **P5 输出归档**：293 个输出中，当前审计识别出 125 个已有 canonical mirror；166 个 Manifest-backed P2 日志待 copy-only 归档；2 个未登记日志保持 blocked/unregistered；哈希漂移项不得覆盖。
4. **P6 M/D/?? 治理**：39 个 M 逐项审核，235 个 D 按 82 个同 SHA rename 候选与 153 个内容变化/未决项处理，504 个 ?? 按 durable、model source、output、build 分类处理。
5. **关闭条件**：无未登记 durable 文件、Drive receipt 完成、connector/browser 账户一致、recovery index 更新；之后才评估旧目录 quarantine 或主 checkout 归位。

## 不变量

- 不对 `D:\\muIon-beam` 主 checkout 执行 reset、stash、clean、批量删除、覆盖或 `git add -A`。
- 不把 `03_runs/formal/` 输出整体加入 Gitee，也不创建科研结果 tag。
- P0/P1 不删除；P2 只在已确认冗余、可恢复、无锁并通过 Drive 校验后进入清理候选。
- 所有阶段、阻塞原因、证据和下一步保存在本计划与对应 receipt 中，避免依赖聊天上下文。

## 当前阻塞

OAuth blocker 已解除。当前计划进入 P4/P5 交界：Drive manifest 仍描述旧的 `e69a716` 镜像，
需要从最新提交 `db02f51` 重新执行 copy-only mirror 和 recovery-index 验证。
