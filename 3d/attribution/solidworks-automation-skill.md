# 外部 SolidWorks Skill 采用记录

来源：<https://github.com/wzyn20051216/solidworks-automation-skill>

- 主来源 commit：`5287d2e3d100dedb10e94910523f294a46176c54`
- v0.3.4 commit：`0eb24dc1b93adc9371ed605e35d82f9b93821420`
- 许可证：MIT
- 本地图书馆：`06_external_lib/CAD-Studio-0.3.4-Windows-x64-Portable`

## 已吸收

只移植与 G1 SolidWorks 几何直接相关的最小 helper：`sw_connect.py`、`sw_session.py`、`sw_preflight.py`、`sw_part.py`、`sw_document_data.py`、`sw_entity_reference.py`、`sw_review.py`、`sw_export.py` 和必要的安装诊断。采用的思想包括 preflight、启动互斥、会话所有权、COM 属性/方法兼容、显式空 Dispatch VARIANT、BYREF 参数、对象级选择、真实保存/重开/回读、能力分级和输出哈希。

## 保持图书馆级别

CAD Studio 桌面端、MCP Server、FEA、Motion、Routing、AutoCAD、工程图制造规范、企业 RAG、Provider Adapter、综合编排和开放格式产品基础设施未并入本项目 3D Block。它们可能作为未来候选，但不能自动成为日常依赖或跨模块工作流。

文件哈希和完整演化判断见 `00_project/traceability/evolution/EVOLUTION-20260909-solidworks-automation-skill.json`。
