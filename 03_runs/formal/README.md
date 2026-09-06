# formal runs

每个正式运行使用独立目录：

```text
RUN-YYYYMMDD-NNN-short-name/
├─ input/
├─ model-snapshot/
├─ raw/
├─ diagnostics/
├─ processed/
├─ figures/
├─ report/
└─ run-manifest.yaml
```

正式运行必须能够回答输入、模型、参数、脚本、结果标签、报告和 Drive 归档路径之间的关系。
