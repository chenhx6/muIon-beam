# 归档和标签

归档根目录：`H:\我的云端硬盘\muIon_archive`。

Gitee 保存源码、Manifest、schema、索引、报告、关键小型结果和图。Drive 保存完整模型、原始输出、重要日志、完整图集和有科学价值的失败运行。

标签示例：

```text
wip-YYYYMMDD-NNN-short-name
r0-baseline
r1-field-window
r2-gap-scan
```

每次结果上传都必须带 Gitee annotated tag 和中文说明，至少说明：基于标签、基础内容核验、本次任务、本次调整、优化内容、结果、主要限制、详细报告位置和 Drive 路径。只有匹配基础 tag 的项目级快照通过第二层 `audit-project-snapshot.mjs` 时，说明才写“基础内容已核验”；其他情况固定写“基于历史 tag，基础快照未重新核验”。

自动发布使用 `publish-gitee.mjs`：默认只做 dry-run；指定 `--push` 后才提交、创建不可变 annotated tag、推送并用 `git ls-remote` 验证。发布记录允许有一个内容提交和一个后续记录提交，标签固定在内容提交上。

发布完成后使用 `sync-three-end.mjs` 将运行快照和 `sync-state.json` 写入 Drive，并把同步状态保存到项目追溯目录。`audit-three-end.mjs` 只读检查三端漂移。
