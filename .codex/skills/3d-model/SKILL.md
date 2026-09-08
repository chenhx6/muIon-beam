---
name: 3d-model
description: Create, read, edit and rebuild native editable SolidWorks parts and assemblies; use for CAD modeling rather than geometry review or physics simulation.
---

# 3d-model

交付分层由 `muion-project` 统一管理：SolidWorks 原生模型和完整装配进入 Drive；建模脚本、参数、模型 Manifest、关键尺寸、重建命令和轻量摘要进入 Gitee 并同步 Drive。每次模型交付记录源路径、配置、单位、坐标、依赖和 SHA256。

先读 [3D Modeling Domain 公共规则](../README.md)。本 Skill 负责 CAD 创建、读取、修改和重建。

## 模型入口

反复出现的几何问题先记录为 experience candidate，保留条件、证据、不确定性和复现方法；只有复现并进入 3D regression 后才可提升为稳定规则。

- 新建：确认几何需求、层级（默认 G1）、单位、坐标和必要关键尺寸。沿用已明确的上下文，只询问会改变设计语义的歧义；不自行编造工程/物理决策。
- 读取 SLDPRT/SLDASM：先打开实际当前文件，检查依赖零件是否解析、活动配置、单位、Feature Tree、草图/尺寸及组件变换。保护用户已打开且未保存的文档，不默默关闭或覆盖。
- 继续修改：以当前 CAD 为基础做最小必要修改。改一个尺寸不重建整个 Feature Tree；手工保存后的模型优先于旧代码和旧参数。不可编辑的导入实体需说明限制，不能宣称原生特征可编辑。
- 参数化：用可读的关键尺寸/全局变量/方程驱动真实草图和 Feature，避免大量不可追溯魔数。重要 Feature 用语义名（如 MainBody、CenterThroughHole），关键参数用完整名称并说明单位；专业缩写遵守项目变量目录约定。使用户可在 GUI 中测量、改尺寸、改草图、移动组件、修改 Feature 和微调。
- 重生成：仅在用户明确要求按代码/参数重新生成时使用对应来源。运行成功且 CAD 保存成功后才将结果作为当前模型；失败不能替换有效模型。保持简单，不建立额外数据库或版本系统。

## 技术路线

候选首选为 Python → SolidWorks COM/API → SolidWorks 原生 Feature → SLDPRT/SLDASM。Python 是自动化控制层，SolidWorks 是 CAD 内核；不默认以 Python → STL/STEP → SolidWorks 作为正式主路径。

按模型可编辑性、原生兼容性、自动化稳定性、代码可读性、维护成本、性能依次选择。Python COM 的特定操作若经实测明显复杂、不稳定或难维护，测试 C# + SolidWorks API；C++ 只用于特殊数学几何、已有算法或必要高性能处理，不为语言统一强制选择。

**锁定门槛**：先查看 [技术验证记录](references/smoke-test.md)。未完成实测时只保留候选路线，不能把缺运行库、权限或许可证当作 Python 路线不稳定。不得宣称未经测试的 fallback 通过。

## 最小技术验证

只在独立测试零件中执行，不设计真实设备：连接/启动 SolidWorks → New Part → 原生 Sketch 和尺寸 → Extrude 或 Revolve → 中心通孔 Cut → Feature 重命名 → 保存 SLDPRT → 关闭测试文档 → 重开 → 修改一个驱动尺寸 → Rebuild → 再保存。记录每步状态、版本、路径和错误；检查实体、特征类型及尺寸变化。

最后在 GUI 中检查草图、尺寸和 Feature 能继续人工编辑，不能仅以保存文件或 API 返回成功替代此证据。交付当前 CAD 路径、关键参数与修改摘要、验证及未验证项。检查/优化/导出可独立按需调用，不强制串行流程。

自动 COM 闭环通过不等于完整验收；GUI 人工编辑检查未完成前，交付状态必须保留为 `automated-pass-gui-pending`。

## 低干扰自动化

自动化优先使用后台、短时、隔离的进程；SolidWorks smoke test 使用 DispatchEx 专用会话和临时路径，只关闭脚本创建的文档/会话，不触碰用户已有实例或未保存文档。测试完成立即写出结果并清理临时运行状态。只有需要验证 GUI 人工编辑时才请求前台交互，并把预计占用时间降到最低。
