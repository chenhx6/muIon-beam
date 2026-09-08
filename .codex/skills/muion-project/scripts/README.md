# 项目脚本

脚本使用工作区依赖中的 Node.js，无需额外 npm 包：

```powershell
node .codex/skills/muion-project/scripts/preflight.mjs .
node .codex/skills/muion-project/scripts/validate-manifest.mjs
node .codex/skills/muion-project/scripts/validate-variable-catalog.mjs
node .codex/skills/muion-project/scripts/build-variable-catalog-view.mjs
node .codex/skills/muion-project/scripts/build-index.mjs .
node .codex/skills/muion-project/scripts/build-detailed-report.mjs <run-directory>
node .codex/skills/muion-project/scripts/generate-cleanup-report.mjs .
node .codex/skills/muion-project/scripts/figure-qa.mjs --manifest <run-directory>/report/figure-manifest.json
```

`figure-qa.mjs` checks new code-bound figure entries, source/input/output SHA256
values, SVG presence, the final-figure PDF requirement, and historical-import
exceptions. Add `--for-report` when a figure is about to enter a report; that mode
requires a separate compact QA record proving machine and visual review passed. It
does not copy source data or image binaries. Selected pinned `nature-figure` audit
implementations are absorbed under `scripts/figure_checks`; the vendored source is
reference-only and is not a second user-facing workflow.

所有清理相关脚本默认只生成报告。`formalize-fast-track.mjs` 拒绝覆盖已有目标目录。

## 保留原迁移版本期间

- `verify-legacy-migration.mjs` 为只读校验：分别报告旧源变化、本地副本和 Drive 副本的原始哈希一致性。`valid=true` 只表示本次技术检查通过，不能替代 `migration_complete` 或人工签收。
- 用户的 `legacy-source-change-decision.json` 生效时，`legacy-migrate` 和冒烟实例重建在写入前返回状态 `awaiting-legacy-phase-completion`（退出码 2）。
- `acceptance:finalize` 只读返回待定状态，不修改 Manifest，不自动写入 `structural-accepted`、`verified` 等成功标志。
- 调用统一参数解析器的入口在 `--help` 时提前退出，不执行迁移、发布、数据库构建或同步。
- 验证命令：`node --test tests/legacy-version-policy.test.mjs`。测试只使用 `_work/scratch` 下隔离样例。
