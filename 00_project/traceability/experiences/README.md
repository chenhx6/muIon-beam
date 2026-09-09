# 项目经验统计

本目录记录对研究和项目工作流有可复用价值的经验，包括成功实践、失败问题和中性观察。它面向 Codex 的长期维护和研究协作，不替代任务 Manifest、运行报告或同步状态。

每条经验使用 `EXP-YYYYMMDD-<topic>.json` 文件，必须包含：

- `polarity`：`positive`、`negative` 或 `neutral`；
- `category`：可聚合的问题或实践类别；
- `observation`、`evidence`、`impact`：事实和证据；
- `reusable_value`：对后续研究或工作流的共享价值；
- `actions`：已经执行或建议执行的改进措施。

通过以下命令登记和汇总：

```text
npm run experience:record -- --record-file <record.json>
npm run experience:summarize -- --category <category>
```

汇总文件按类别生成 `SUMMARY-<category>.md`，同时统计正向、负向和中性经验。相同类别累计三条或更多记录时，应检查共同根因并更新自动化门禁、测试或项目规则；历史记录不覆盖，只追加新的总结和后续经验。
