---
name: 3d-modify
description: Explore and reshape CAD geometry through section, topology, scale and layout changes in response to geometric requirements, without physics optimization.
---

# 3d-modify

优化方案、几何意图、硬约束、参数变化、前后摘要和重建脚本进入 Gitee 并同步 Drive；优化后的 CAD、完整导出和大图进入 Drive。不得把几何变化直接描述为物理性能改善。

先读 [3D Modeling Domain 公共规则](../SKILL.md)。职责是几何设计与探索：改形、简化、重构、尺度/截面/局部拓扑变化、布局调整和几何发散。

读取当前 CAD，提取已有几何要求、明确硬约束和设计意图。G1 初始尺寸为软约束；保持原物理意图、合理整体尺度和现实存在/制造可能时允许较强自由度。可将圆环改为梯形截面、倒角或锥形过渡，也可在圆柱局部增加凹槽/平台；这些是几何示例，不是设备设计建议。

把“入口需要更多空间”“增加通道”“改变截面”等输入转为几何变化，不分析反馈来源，不自行运行 COMSOL、Geant4 或其它物理分析，不宣称改善了物理性能。真正改变语义且缺信息时询问；通常几何实现选择可自主进行。

按需求选择一个改形或少量有明确差异的方案，不建立无需求的参数扫描基础设施。保留可编辑性，局部变化采用最小必要 Feature 修改；重构应有几何/维护理由，不能默默抹去人工修改。

交付实际保存的当前 CAD（或任务仅要求提案时交付方案）、变化理由、关键尺度/布局、保留的意图及待确认项。无需强制调用其它 Skill；涉及 CAD 操作时可按需使用 3d Block。


实现 helper 位于 ../scripts/sw_document_data.py 和 ../scripts/sw_entity_reference.py，用于命名参数回读和稳定实体引用。
