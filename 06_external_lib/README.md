# Codex 内部参考图书馆

> 本目录供 Codex 查询外部资料、比较设计思路和检索能力边界。它不是用户手册，不是常规执行工具层，也不会自动导入 `.codex/skills` 或执行其中的脚本、安装器和 MCP Server。

- 清单版本：`1.0.0`
- 当前活动图书：1
- 机器清单：[`library-manifest.json`](library-manifest.json)
- 元数据登记：[`library-registry.json`](library-registry.json)

## 当前图书

| 图书 | 版本 | 来源 | 许可证 | 文件数 | 总大小 | 内容 SHA256 | 状态 |
|---|---|---|---|---:|---:|---|---|
| CAD Studio 0.3.4 Windows x64 Portable | 0.3.4 | https://github.com/wzyn20051216/solidworks-automation-skill | MIT | 173 | 19954434 B | `ea27263b95cd9809b2bf3e347d3fdd580b88b83e019abb780037d7fa53f39719` | reviewed |

### CAD Studio 0.3.4 Windows x64 Portable

- 路径：`06_external_lib/CAD-Studio-0.3.4-Windows-x64-Portable`
- 角色：Codex 查询型外部图书馆；不进入常规执行技能层
- 功能优势：
  - 覆盖 SolidWorks/AutoCAD 自动化、Skill、CLI、MCP 和 CAD Studio 多入口
  - 以 capabilities.yaml 和 verified/pilot/reference_only/not_implemented 分级表达能力边界
  - 提供 preflight、诊断、会话所有权、真实保存/重开/回读和输出证据思路
  - 包含开放格式导出、装配、工程图、孔槽、网格参考、FEA/Routing 试点和 MCP Server 参考实现
  - 附带可复用的子技能、脚本、Schema、示例和工程化排障文档
- 使用限制：
  - SolidWorks/AutoCAD 原生能力依赖本机软件、许可证和 Windows 环境
  - pilot、reference_only 和 not_implemented 能力不能当作无人值守正式交付
  - 外部资料只用于 Codex 查询、比较和设计参考，不作为本项目运行时依赖
  - 执行前必须重新核对当前项目的版本、模型、许可证和能力门禁
- 适合查询：
  - SolidWorks COM 会话与连接封装
  - 零件、孔槽、螺纹、圆角、倒角、装配与工程图
  - AutoCAD/DXF、开放格式导出和网格参考导入
  - MCP/CLI/桌面端编排、诊断、审查和证据账本
  - FEA、Routing、复杂曲面和制造复核的 pilot 边界
- 来源仓库：https://github.com/wzyn20051216/solidworks-automation-skill
- 来源版本：v0.3.4
- 来源 commit：`0eb24dc1b93adc9371ed605e35d82f9b93821420`
- 执行边界：仅供 Codex 参考；项目实际执行仍以本仓库已验证的技能、模型、环境和门禁为准。
- `oh-my-codex` v0.21.4（MIT，提交 `304fb3b`）仅用于可恢复状态机、阶段交接和完成门设计参考；不作为项目运行时依赖。采用记录见 `00_project/traceability/evolution/EVOLUTION-20260910-oh-my-codex.json`。

## 三端保存策略

- Gitee：目录、来源/许可证、机器清单、源码、脚本、示例和参考文档。
- Google Drive：完整便携库和所有 Drive-only 二进制，按内容指纹建立不可变版本。
- 变更触发：task:begin、auto:commit-push、task:close、sync-project。
- 删除策略：记录 retired/tombstone，保留历史归档，不自动删除唯一原始内容。
