# 3D Modeling Domain

本 README 只约束同级的四个 `3d-*` Skill，不改变其它 Skill。

交付由 `muion-project` 统一管理：脚本、参数、Manifest、轻量报告和几何证据属于 Gitee durable asset，并同步到 Drive project snapshot；原生 CAD、完整导出、大型日志和高分辨率图属于 Drive 资产。四个 3D skill 不直接执行 Gitee/Drive 发布。

- **边界**：只负责三维几何的创建、读取、修改、重建、检查、改形和输出。不负责 COMSOL、Geant4、电磁模拟、粒子输运、热分析、结构力学模拟、仿真结果分析、束流优化或物理可行性判断。其它模块只通过几何接口使用结果。
- **层级**：G0 — Concept Geometry（概念和需求表达）；G1 — Feasibility Geometry（可行性几何，当前默认）；G2 — Engineering Geometry（真实工程结构）；G3 — Manufacturing Geometry（制造、公差和工艺）。
- **G1**：探索性几何，不是冻结工程设计。初始参数是软约束；保持原物理概念和大致设备尺度时，可调整尺寸、截面、局部形状/拓扑、凹槽、过渡面、梯形/锥形、圆角/倒角、组件位置和布局。约 100 mm 可探索到 150 mm；无明确理由变为 10000 mm 应警告或停止。不得预设 ±10%/±20% 等死比例。尺度检查问的是“在当前设备概念下是否属于现实世界可能存在的结构”，不据此证明物理性能。
- **细节**：G1 默认不加入螺纹、螺栓细节、加工孔、公差、表面粗糙度、焊缝、O-ring 细节、制造工艺、装饰结构或无关小型机械细节。
- **当前模型**：代码、参数和 GUI 都是入口，实际成功生成并保存的 CAD 才是成品；**Last successful build/save wins**。继续修改优先读取当前 CAD，只有明确要求按代码或参数重新生成才走对应生成路径。若多个文件无法识别当前模型，询问文件身份，不凭脚本或时间戳猜测。项目 Manifest 记录事实，不引入额外版本系统。
- **组合**：四个 Skill 按需独立调用，不强制流水线。文件少时无需索引；以后如需索引，沿用项目 YAML → Codex → MD 机制，只做分类和定位，不承载工作规范。

- **运行方式**：优先后台、短时、低干扰地执行自动化，避免长时间占用用户电脑。SolidWorks 测试或批处理使用专用会话和临时文件，绝不接管或关闭用户已有会话；完成后保存必要结果、清理测试状态并退出专用会话。不可避免的前台交互应先说明原因。

- **经验演化**：3D 几何观察先进入 `07_research_system/blocks/3d/experience-candidates/`，经复现和 regression 后才提升为 reference、script、test 或稳定规则。`07_research_system/blocks/3d/regression/registry.yaml` 为空时状态为 `not-yet-validated`，不虚构 CAD 回归结果。

- **模块入口**：3D Modeling Block 的权威实现位于项目目录 07_research_system/blocks/3d/，.codex/skills/3d/ 仅提供 Codex 路由。模式为 create、modify、inspect、export。

