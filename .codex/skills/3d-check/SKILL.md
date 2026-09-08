---
name: 3d-check
description: Inspect SolidWorks CAD geometry quality, rebuild health, component placement and scale; use for geometry checks without physics simulation.
---

# 3d-check

检查报告、几何摘要、问题清单和轻量证据进入 Gitee 并同步 Drive；原始 CAD、完整日志和高分辨率检查图进入 Drive。每项必须明确通过、问题或未验证。

先读 [3D Modeling Domain 公共规则](../README.md)。输入是当前 CAD 和已知几何要求；独立检查，不要求先运行其它 Skill，不自动修复或重生成模型。

G1 默认检查：文件可打开、模型可显示、rebuild 成功、无明显损坏 Feature；无非预期穿模、自相交、零厚度、坏实体、重复实体；主要组件存在、关键结构位置大致合理、整体尺度无荒谬漂移、单位及坐标可理解。区分设计允许的接触/重叠与非预期干涉，未知意图标为待确认。

使用实际文件、Feature/实体信息及必要视图作为证据；打开/重建检查不能替代自相交或干涉检查。无法检查的项目明确标为未验证，不以总括的“通过”隐藏缺项。检查动作导致文档变脏时不擅自保存覆盖。

初始尺寸是软约束，尺寸不同本身不是错误，不用死百分比判定。只检查几何合法性及大致现实可存在性，不判断电场、束流通行、温度、COMSOL 收敛或 Geant4 结果。

交付逐项通过/问题/未验证、相关文件与 Feature/组件位置、证据和必要的几何建议；由用户或独立建模/改形请求决定修改。
