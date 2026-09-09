# 工作流经验教训

本目录兼容早期的负向经验记录。新的正向、负向和中性经验统一登记在 `00_project/traceability/experiences/`，由 `experience:record` 和 `experience:summarize` 管理。本目录记录项目工作流、同步、归档和自动化中的已确认问题，服务于 Codex 维护和项目恢复，不是用户操作手册。

每次已确认的问题使用一个 `LESSON-YYYYMMDD-<topic>.json` 文件，至少记录触发条件、影响、根因、修正、预防措施和验证结果。测试产物、临时 outbox 和缓存不放在本目录；它们应转移到 `_work/cache/` 并标记为 `test-only`。

同一 `category` 后续累计三次或更多相似记录时，新增 `SUMMARY-<category>.md`，归纳共同根因、有效预防措施和需要修改的自动化门禁；后续记录继续保留，不覆盖历史事实。
