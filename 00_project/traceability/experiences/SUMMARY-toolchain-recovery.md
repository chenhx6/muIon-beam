# 经验汇总：toolchain-recovery

- 生成时间：2026-09-09T10:10:49.937Z
- 经验条数：3
- 正向：1；负向：1；中性：1

## 可共享结论

- **[neutral] 用户 Python 环境与 Desktop shell 可见性不同**：工具链检测必须区分 PATH 可见性和实际用户安装，不能把 shell 找不到命令等同于依赖未安装。
- **[positive] 复用用户安装的 PyYAML 完成 Skill validator**：工具链恢复必须区分 shell 可见性和实际用户安装，并保存解释器、包版本、验证输出和执行责任。
- **[negative] Skill validator 依赖恢复入口只覆盖 npm**：普通任务依赖恢复应由 muion-project 负责，并记录解释器、包版本、验证命令和重试结果。

## 记录明细

| 时间 | 极性 | 状态 | 标题 | 证据/动作 |
|---|---|---|---|---|
| 2026-09-09T10:00:19.916Z | neutral | recorded | 用户 Python 环境与 Desktop shell 可见性不同 | user pip install PyYAML output；C:\\Users\\Administrator\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe；ensure-toolchain check output: version 6.0.3；记录用户环境与 Desktop 环境差异；优先复用已安装解释器，不重复安装 |
| 2026-09-09T10:10:48.733Z | positive | recorded | 复用用户安装的 PyYAML 完成 Skill validator | 00_project/traceability/toolchain-recoveries/REC-20260909-pyyaml-validator.json；C:\\Users\\Administrator\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe；PyYAML 6.0.3；quick_validate.py research-workflow: Skill is valid!；quick_validate.py comsol: Skill is valid!；普通依赖恢复归入 muion-project；evolution 继续只负责手动外部能力发现 |
| 2026-09-09T10:00:19.290Z | negative | recorded | Skill validator 依赖恢复入口只覆盖 npm | .codex/skills/evolution/scripts/ensure-toolchain.mjs；quick_validate.py: ModuleNotFoundError: No module named yaml；REC-20260909095028.json；REC-20260909095137.json；新增项目级 allowlisted toolchain recovery；支持用户范围 Python/PyYAML 检测和验证记录 |

## 高频标签

- toolchain: 3
- python: 2
- pyyaml: 2
- desktop: 1
- environment: 1
- neutral: 1
- prevention: 1
- validator: 1
- verified: 1
