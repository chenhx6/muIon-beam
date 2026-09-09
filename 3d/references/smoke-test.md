# SolidWorks Python COM smoke test

日期：2026-09-09。SolidWorks COM ProgID `SldWorks.Application.32` 已注册，版本 `RevisionNumber = 32.5.0`（SolidWorks 2024 SP05）。使用用户指定的 Python 3.14.7：

```text
C:\Users\Administrator\AppData\Local\Python\pythoncore-3.14-64\python.exe
```

安装 `pywin32` 和 `comtypes` 后，在后台用 `DispatchEx` 创建了独立 SolidWorks 会话，完成以下闭环：连接/启动、New Part、前视基准面原生 Sketch、直径 50 mm Extrude、Feature 重命名 `MainBody`、直径 20 mm 中心圆原生 Cut、Feature 重命名 `CenterThroughHole`、保存 SLDPRT、关闭并重开、修改 `D1@MainBody`（20 mm → 25 mm）、Rebuild、再次保存和关闭测试文档。

结果：**PASS**。输出文件为 `00_project/state/3d-smoke/smoke-part.SLDPRT`，结果明细在 `result.json`。保存 API 在此 COM 绑定中返回值不稳定，因此同时检查文件实际存在并能成功重开；这是本次实测记录的一部分。

运行约束：测试在后台、短时、隔离会话中执行，使用 `DispatchEx`，不接管用户现有文档。脚本只关闭它创建的测试文档并请求退出专用会话。GUI 中人工继续编辑尚未由自动脚本代替验证；需要一次最短的前台人工检查来确认草图、尺寸和 Feature Tree 的可编辑性。

结论：Python 3.14.7 → pywin32/comtypes → SolidWorks 2024 COM → SolidWorks 2024 SP05 原生 Sketch/Feature → SLDPRT 路线已通过最小自动化闭环，可作为 `3d/create` 的默认建模路线。C# fallback 暂不需要启用。
