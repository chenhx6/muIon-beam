# Drive OAuth 对齐与 M/D/?? 治理计划

## 目标

让 Google Drive connector 使用 `malakarlio29@gmail.com` 读取已经由浏览器确认可见的
`muIon_archive/muIon-beam` canonical mirror；随后按 ADR-006/ADR-009 验证 manifest、
recovery index、文件数量、大小和 SHA256，并在不改写脏主 checkout 的前提下处理运行输出和
M/D/?? 现场。

## 当前事实

- 浏览器账号 `malakarlio29@gmail.com` 可以看到 `muIon-beam` 和 `drive-mirror-manifest.json`。
- connector 已切换并返回 `malakarlio29@gmail.com`；目标 folder、`drive-mirror-manifest.json` 和 recovery index 均可读。
- Gitee `origin/main` 的最终提交号在每次交付后由 `git ls-remote origin main` 与
  `project/recovery-index/recovery-index.json` 记录；本计划不硬编码会随最终回执变化的旧提交号。
- supervisor 代码已接受同一 Git common root 下的 dashboard worktree；实时 dashboard API 和页面正常。
- 主 checkout 的 778 项 M/D/?? 现场只读保留。
- canonical mirror 的最终文件数、字节数、stale 数量、生成时间和 SHA256 结果以最终
  `drive-mirror-manifest.json` 为准；映射盘校验后再由 connector 读回 manifest 与 recovery index，
  两者必须指向同一 Gitee 提交。旧文件只保留，不做删除。
- P5 已完成：166 个 P2 日志复制到 canonical mirror，9,224,915 bytes，逐项 SHA256 通过；回执同时记录 60 个已归档 Manifest 文件、64 个已在镜像但待登记文件、2 个未登记阻塞文件和 1 个哈希漂移项。
- P6 已完成治理回执：39 个 M 全部保留并标为逐项审查；235 个 D 中 82 个同 SHA 命名迁移候选、153 个内容变化/未决；504 个 ?? 中 209 个已交付 Gitee、293 个由输出回执管理、2 个 `.class` 构建产物忽略。

## 执行门

1. **P3 OAuth 对齐**：已完成；connector link `link_6ab3e98996a48191821511fd47b0748f` 返回目标账号 `malakarlio29@gmail.com`。
2. **P4 API 读回**：已完成；29 账号 connector 读回 canonical folder、manifest 和 recovery index。
3. **P4b canonical mirror 刷新**：已完成；1155 个文件、68,325,653 bytes；connector 读回的 manifest 和 recovery index 均对应 Gitee `47c2e37`，SHA256 镜像验收通过。
4. **P5 输出归档**：已完成 166 个 Manifest 与 SHA256 匹配的 P2 日志 copy-only 归档；2 个未登记日志保持 blocked/unregistered；另有 1 个文件在镜像中已保留，但 Manifest 只有路径匹配、没有 SHA256 匹配，需单独做 Manifest 修订。回执为 [OUTPUT-ARCHIVE-RECEIPT-20260924.json](receipts/OUTPUT-ARCHIVE-RECEIPT-20260924.json)。
5. **P6 M/D/?? 治理**：已完成逐项治理回执；39 个 M、235 个 D、504 个 ?? 的路径、大小、SHA256、处理决定和下一步已记录在 [MAIN-CHECKOUT-GOVERNANCE-RECEIPT-20260924.json](receipts/MAIN-CHECKOUT-GOVERNANCE-RECEIPT-20260924.json)。
6. **关闭条件**：无未登记 durable 文件、Drive receipt 完成、connector/browser 账户一致、recovery index 更新；之后才评估旧目录 quarantine 或主 checkout 归位。

## 不变量

- 不对 `D:\\muIon-beam` 主 checkout 执行 reset、stash、clean、批量删除、覆盖或 `git add -A`。
- 不把 `03_runs/formal/` 输出整体加入 Gitee，也不创建科研结果 tag。
- P0/P1 不删除；P2 只在已确认冗余、可恢复、无锁并通过 Drive 校验后进入清理候选。
- 所有阶段、阻塞原因、证据和下一步保存在本计划与对应 receipt 中，避免依赖聊天上下文。

## 当前阻塞

OAuth blocker 已解除。Drive mirror、recovery index 和云端可见性审计在最终同步后完成；P5 和 P6 都已留下
逐文件回执。剩余阻塞是 39 个 M 的内容审查、153 个 D 的内容变化/未决项、64 个已在 Drive
但尚未登记的输出、2 个未登记日志，以及 1 个 Manifest 哈希漂移项。主 checkout 仍只读，
后续需逐项解决这些阻塞后再考虑采用、quarantine 或清理。
