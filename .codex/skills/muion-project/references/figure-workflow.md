# 轻量、可追溯的科研绘图流程

## 绑定规则

- 新生成的定量、分析和报告图必须由可运行脚本生成。
- 脚本声明唯一 `figure_id`，输出使用同一图件编号；Manifest 保存脚本路径和 SHA256。
- Manifest 只保存源数据/运行快照的引用和 SHA256，不复制数据、坐标数组或图片二进制。
- 新图没有脚本、输入引用、输出文件和 QA 状态时不得进入正式报告。
- COMSOL、SolidWorks 等原生导出必须绑定源模型和可复现导出流程；手工截图不得作为新科学结果来源。

## 最小登记

```yaml
figure_id: FIG-RUN-YYYYMMDD-NNN-001
run_id: RUN-YYYYMMDD-NNN
figure_class: diagnostic | analysis | final
source_code: {path: path/to/plot.py, sha256: ...}
input_snapshot:
  run_manifest: path/to/run-manifest.yaml
  source_data: [{path: path/to/source.csv, sha256: ...}]
backend: python
outputs: [{path: path/to/figure.svg, sha256: ...}]
qa: {status: pass, report: path/to/figure-qa.json}
semantic_note: null
```

共同的后端和运行环境放在运行级 Manifest；图件条目不重复保存环境信息。历史迁移图可以缺少脚本，但必须明确标记为未重新生成、未重新验证。

## 输出和 QA

- 核心图归档 SVG/PDF；非核心图归档 SVG。
- PDF/PNG 可在 QA 时临时生成，不能作为非核心图的正式冗余输出。
- Python 是项目默认后端；显式选择 R 时，同一图的绘制、预览和 QA 全部使用 R。
- `figure-qa` 检查脚本和输入哈希、输出存在性、SVG 元数据、核心图 PDF 要求，并调用固定版 `nature-figure` 的源代码、字号、对齐和碰撞检查。
- 数据字段、单位、删失/失败状态、筛选和变换属于科学语义检查。`censored` 字段不能被无说明地画成已达到阈值的普通时间。
- Codex 对最终尺寸临时渲染执行视觉检查；仅保存 PASS/WARN/FAIL 和 QA 报告路径，不保存重复预览图。
