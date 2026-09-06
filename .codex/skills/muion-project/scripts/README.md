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
```

所有清理相关脚本默认只生成报告。`formalize-fast-track.mjs` 拒绝覆盖已有目标目录。
