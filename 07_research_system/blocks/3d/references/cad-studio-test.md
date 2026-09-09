# CAD Studio 0.3.4 便携版验证记录

日期：2026-09-09。测试对象：`06_external_lib/CAD-Studio-0.3.4-Windows-x64-Portable`。

## 结果

- `skill/scripts/validate_skill.py`：通过。
- `skill/scripts/cad_studio.py --help`：通过。
- `skill/scripts/cad_studio.py doctor`：退出码 0；Python 3.14.7、pywin32、comtypes、SolidWorks 2024 SP05 和 COM 注册通过。未安装的 ezdxf、OCP、PyMuPDF、CalculiX、非 Codex Agent 属于可选 warning。
- 隔离 `queue-dir` 的 `run --enable-mock`：退出码 0，队列为空且无虚假任务。
- `CAD Studio.exe`：隐藏启动创建了新的独立 PID；15 秒内未自行退出，测试随后只停止了该 PID。启动能力通过，完整前台 UI/本地执行器交互仍为 `not-tested`。
- `07_research_system/blocks/3d/scripts` helper：Python 3.14.7 AST 语法和 import 通过；`sw_preflight.py --no-install` 通过。
- SolidWorks 2024 SP05 原生 smoke：通过，详见 [`smoke-test.md`](smoke-test.md)。

## 结论

便携版的 Skill/CLI/环境诊断和 SolidWorks 2024 原生后端可用；桌面程序能启动。可选开放格式和 FEA 依赖未安装不影响 G1 原生建模。完整 GUI 人工操作和长生命周期本地执行器未宣称通过。
