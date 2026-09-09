# 经验汇总：external-library-sync

- 生成时间：2026-09-09T01:36:15.319Z
- 经验条数：2
- 正向：1；负向：1；中性：0

## 可共享结论

- **[negative] 本地 no-publish 测试把失败 outbox 写入生产追溯目录**：测试状态必须与生产追溯状态隔离；失败记录要能明确区分 test-only 和正式同步。
- **[positive] 外部参考图书馆完成完整三端同步**：源资料与完整二进制分层保存，并以内容指纹验证，可同时支持重建和直接恢复。

## 记录明细

| 时间 | 极性 | 状态 | 标题 | 证据/动作 |
|---|---|---|---|---|
| 2026-09-09T01:36:15.218Z | negative | recorded | 本地 no-publish 测试把失败 outbox 写入生产追溯目录 | SYNC-EXTERNAL-20260909010531-ca364c51.json；_work/cache/external-lib-test-artifacts/TEST-ONLY.json；将测试记录转移到 _work/cache/external-lib-test-artifacts/；增加经验统计功能和 test-only 记录约定 |
| 2026-09-09T01:36:15.270Z | positive | recorded | 外部参考图书馆完成完整三端同步 | Gitee content commit b52acb6f85580afba6586c6b835779633628db88；formal sync state SYNC-EXTERNAL-20260909011248-c7f1e83c.json；Drive archive SHA256 ea27263b95cd9809b2bf3e347d3fdd580b88b83e019abb780037d7fa53f39719；接入 task:begin、auto-commit-push、task-close 和 sync-project；保留 verified/pilot/reference_only/not_implemented 能力边界 |

## 高频标签

- gitee: 1
- google-drive: 1
- outbox: 1
- prevention: 1
- reference-library: 1
- sha256: 1
- testing: 1
- three-end: 1
- traceability: 1
