---
name: 3d-export
description: Export the current CAD to native or requested neutral formats and geometry views, without adding manufacturing drawing requirements by default.
---

# 3d-export

原生 CAD、STEP/Parasolid/STL 和完整视图属于 Drive 交付；导出脚本、参数、单位/坐标、组件清单和轻量元数据进入 Gitee 并同步 Drive。记录源 CAD、配置、选项、大小和 SHA256。

先读 [3D Modeling Domain 公共规则](../SKILL.md)。输入是当前 CAD、所需格式/视图和用途；直接读取当前已保存模型，不按旧代码重新生成。

- 原生交付 SLDPRT / SLDASM。装配体交付包含所需引用零件并验证引用可解析；不能把孤立 SLDASM 当作完整装配。
- 按需输出 STEP、Parasolid、STL 或其它确有用途的格式。记录配置、单位、坐标和必要的导出选项；STL 说明约定单位及网格精度，不能把网格描述为保留原生 Feature Tree。
- 按需提供等轴测、正视、侧视、俯视、剖面、透明视图，必要时爆炸图。G1 的二维结果是 2D geometry view，而非正式制造工程图；不默认加公差、加工标注、粗糙度、螺纹或制造要求。进入 G2/G3 后按明确任务选择细节。

只改变导出/显示所需状态，不无意覆盖原模型的配置或几何。验证文件生成、可读性、单位/方向和所需组件/视图完整性；无法重开验证时标明限制。交付文件清单、源 CAD 路径/配置、格式与验证摘要。Geometry Interface 是实际文件及这些必要说明，不引入新接口平台或数据库。


实现 helper 位于 ../scripts/sw_export.py，导出后必须记录实际文件和 SHA-256。
