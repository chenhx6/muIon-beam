---
name: 3d
description: Run the project-owned 3D geometry Block for native SolidWorks modeling, geometry inspection, geometric exploration and export at G1 by default.
---

# 3D Modeling Block

本 Block 与 `comsol/`、`geant4/` 同级，只负责三维几何。入口为 `node 3d/index.mjs --task path/to/geometry-task.json`，或 `--mode create|modify|inspect|export`。四个模式可以独立调用，不强制串行。

## 自治边界

本 Block 管理 SolidWorks 会话、当前 CAD、几何创建/修改、几何检查、导出、经验候选、回归记录和本地问题记录。它不管理研究目标、COMSOL、Geant4、电磁、粒子输运、热分析、结构力学、束流优化、物理可行性或 Research Workflow 调度。跨模块问题返回问题记录，不直接改动其它模块。

## G1 默认规则

G1 是探索性几何，不是冻结工程设计。初始参数属于软约束；允许在保持物理意图和现实设备尺度的前提下调整尺寸、截面、局部拓扑、凹槽、平台、过渡面、圆角、倒角、组件位置和布局。明显荒谬的尺度漂移才警告或停止，不使用固定百分比限制。G1 默认不加入螺纹、螺栓、公差、焊缝、粗糙度或其它无关制造细节。

实际成功保存的 CAD 是当前模型（last successful build/save wins）。继续修改优先读取当前 CAD；只有任务明确要求按代码或参数重新生成才重建。自动化优先后台、短时、低干扰，并只关闭脚本创建的 SolidWorks 文档/会话。

## 操作区

- `create/`：新建、读取、参数化建模和原生 Feature。
- `modify/`：最小必要修改、改形、重构和几何探索。
- `inspect/`：文件、Feature、实体、重建、位置、单位和尺度检查；不运行物理模拟。
- `export/`：SLDPRT/SLDASM、STEP/Parasolid/STL 和 G1 geometry view 输出。

## 能力吸收

`scripts/` 中的 SolidWorks helper 从外部 MIT Skill 经过筛选移植：会话所有权、启动互斥、模板查找、属性/方法兼容读取、显式 VARIANT/BYREF、对象级选择、参数回读、几何证据和导出封装。外部 CAD Studio、MCP、FEA、Motion、Routing、AutoCAD、工程图制造规则和综合编排保持图书馆级别，不成为本 Block 的默认依赖。来源、版本、许可证、哈希和实际采用范围见 `attribution/`。

## 经验与验证

重复几何观察先进入 `experience-candidates/`，复现后再进入 `regression/`，不得把一次失败推断成稳定规则。每次能力验证区分 `passed`、`pilot`、`blocked` 和 `not-tested`。SolidWorks 2024 和 CAD Studio 便携版验证只使用 `00_project/state/3d-smoke/`，不把临时输出作为 durable asset。
