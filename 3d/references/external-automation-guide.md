# 外部 SolidWorks 自动化学习与本地用法

来源为 `wzyn20051216/solidworks-automation-skill` 的 MIT 版本和本地 CAD Studio 0.3.4 便携版。外部仓库作为参考实现，当前本地权威路径是 `3d/scripts/`。

## create / model

- `sw_preflight.py` 先检查 Python COM 依赖和 SolidWorks 安装/注册；缺依赖时必须有明确授权才安装。
- `sw_connect.py` 用版本映射、模板查找、启动互斥和 ready 等待管理 COM。连接结果要记录 ProgID、SolidWorks 版本、启动所有权和活动文档。
- `sw_session.py` 把 new/open/save/export/close 组合成短生命周期门面。`quit_owned_instance()` 只退出本会话启动的实例；附着用户实例时不退出。
- `sw_part.py` 使用 `mm()`、草图上下文、草图引用缓存和对象级选择。不要只用 `SelectByID2("Sketch1")` 或屏幕坐标。
- API 参数先查官方类型库/帮助再调用。`CreateCircle` 是中心点加圆周点六坐标；直接给半径使用 `CreateCircleByRadius`。`FeatureExtrusion2/3`、`FeatureCut4` 的长参数必须按当前版本签名传递。

## modify

- 先打开实际当前 CAD，读取活动配置、Feature Tree、单位、依赖和关键参数；只有用户明确要求才从旧代码完整重生成。
- `sw_document_data.py` 用命名尺寸和自定义属性回读确认修改对象；参数修改后必须 rebuild、保存并重新读取。
- `sw_entity_reference.py` 以 Feature、Sketch、Face、Edge 对象作为引用，减少本地化名称和 `Face1`/`Edge1` 的脆弱性。
- 修改一个尺寸时只改受影响的 Feature；若重构不可避免，交付前后结构和用户手工修改要有说明。
- Python COM 封送失败先缩小调用并记录错误，再评估 `comtypes`；只有仍有明确收益才使用 C# PIA。C++ 仅保留给官方要求的进程内非托管接口或必要高性能几何处理。

## inspect

- `cad_doctor.py` 是环境诊断，不等同于模型质量检查；它只报告依赖、SolidWorks 注册、输出目录和可选后端状态。
- `sw_review.py` 的有用思想是把实体数量、body、包围盒、体积、重建、Feature 和视图证据分开记录。
- API 返回非空不代表文件可交付；必须检查文件落盘、重新打开、实体/参数回读和必要预览。
- 检查报告逐项返回 `passed`、`problem` 或 `not-tested`；未验证项不能被总状态掩盖。
- 反复出现的几何失败先写 `3d/experience-candidates/`，复现后才进入 `3d/regression/`。

## export

- `sw_export.py` 按目标扩展名路由 STEP、STL 等导出，记录配置、单位、坐标和选项。
- 原生 SLDPRT/SLDASM 是主交付；STEP/Parasolid/STL 是按任务需要的中性接口。
- 导出后保存文件清单、大小和 SHA-256；STL 还要记录网格精度和单位。
- 等轴测、正视、侧视、俯视、剖面和透明图是 G1 geometry view，不自动变成制造工程图。

## 当前明确不采用

CAD Studio 的 MCP、桌面编排、AutoCAD、FEA、Motion、Routing、工程图制造规范、企业 RAG、Provider Adapter、OCCT 产品后端和综合工程 DAG 不进入本项目 3D Block。它们可作为未来候选，但不能被当前 `3d` 入口自动调用。

## 验证阶梯

1. Python helper 语法和 import。
2. `sw_preflight.py --no-install`。
3. SolidWorks 2024 后台原生 Sketch/Feature smoke。
4. 保存、重开、参数修改、rebuild 和文件回读。
5. 需要 GUI 时才做短时人工编辑检查。

每一级都保存证据；未完成的级别保持 `pilot` 或 `not-tested`。
