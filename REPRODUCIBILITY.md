# muIon-beam 可复现环境与恢复说明

本文件说明接班人如何从 Gitee 重建项目工作流，以及当前用户如何从 Google Drive 快速恢复重要运行现场。机器可读事实位于 [`00_project/config/reproducibility-environment.json`](00_project/config/reproducibility-environment.json)，本文件不替代任务、模型和运行 Manifest。

## 当前环境基线

| 组件 | 基线 | 状态 | 证据或边界 |
| --- | --- | --- | --- |
| Node.js | 24.19.0 | observed / required | Windows `node --version` |
| Python | 3.14.7 | observed / required | `py -3.14`；Windows shell 可能没有 `python.exe` |
| SolidWorks | 2024 SP05 Revision 32.5.0 | historical / verified / license_required | 隔离 COM smoke 记录；恢复主机需重验 |
| COMSOL | 6.4 | observed / verified / license_required | 几何适配器 gate 已有证据，物理求解未评价 |
| WSL | Ubuntu-20.04 | observed / verified / required | 先 `source /home/ys/opt/physics/physics-env.sh` |
| Geant4 | 11.2.2 | observed / verified / required | 当前 WSL smoke |
| ROOT | 6.34.08 | observed / verified / required | 当前 WSL smoke |
| CMake / g++ | 3.16.3 / 9.4.0 | observed / verified / required | 当前 WSL smoke |

历史 μ−–Ne 工程中还出现 Geant4 11.3.2。它标记为 `historical` 和 `not_equivalent`，不能把 11.2.2 的 smoke 或新输出直接当作旧数值结果的复现。

## 从 Gitee 重建

Gitee 主库的目标范围是规则、active ADR、skills、脚本、schema、测试、任务卡、计划、Manifest、报告、索引、经验和小型输入。接班人 clone 主库后，由智能体先阅读 [`AGENTS.md`](AGENTS.md)、active ADR index 和本文件，再按已实现的入口做工具链检查和架构验证。统一 bootstrap 与干净环境恢复验收尚在实施，不能仅凭本说明宣称 Gitee-only 恢复已通过。源码在 `02_models/` 中按共享 delivery policy 进入主库，但构建目录、生成输出、二进制和超出字节预算的文件仍被拒绝。

Gitee-only 的承诺是“重建项目工作流并继续新工作”。历史运行如果依赖未发布的大型模型、完整原始输出或商业软件工程文件，会在 recovery index 中标为 `drive-required`；不能把它伪装成完整复现。未来如主库接近容量软阈值，再评估用途明确的卫星库或迁移到 GitHub，并在主库固定 URL、ref、commit 和哈希。

## 从 Google Drive 快速恢复

Drive 目标是本地设备损坏后直接接续重要工作。当前 canonical 入口是 `H:\我的云端硬盘\muIon_archive\muIon-beam\`，直接镜像本地项目的相对路径；根目录的 `drive-mirror-manifest.json` 是数量、大小和 SHA256 的校验账本。任务交付、报告定稿和归档事件自动调用镜像入口，用户不需要手动运行脚本。P4 整理采用 copy-only：先把内容写入 canonical 目录并完成校验，再确认 Google Drive 云端可见，最后才按清单隔离或删除旧归档。ADR-007 另允许删除确认无用且无依赖的设计期原型生成物，并保留删除 receipt。`.git`、session runtime、缓存和未验证 outbox 不进入 Drive 镜像。

恢复机器仍需安装兼容的 Node、Python、WSL、Geant4、ROOT、COMSOL 和 SolidWorks。商业软件的安装、模块和许可证不由项目保存；SolidWorks/COMSOL 的版本或插件变化必须重新做 preflight 和模型指纹检查。

## 重建闭包

源码文件本身只是候选。要把某个模型标记为 `rebuild-tested`，任务或模型 Manifest 还必须固定：

1. 输入几何、材料、场表和 stopping 表；
2. 参数、单位、坐标系、mesh/solver 设置、随机种子和事件数；
3. 工具链版本、环境变量、精确编译/运行命令和依赖包；
4. 输出格式、检查项以及数值或统计容差；
5. 合法的商业软件安装和许可证边界。

从干净环境执行后，把命令、版本、输入哈希、输出哈希和检查结果写回 Manifest。未完成这些步骤时使用 `candidate` 或 `blocked`，大型依赖使用 `drive-required`；不以一次成功的旧日志代替验证。

## 安全和更新

项目不记录密码、许可密钥或 `/home/ys/ROOT_SECRET.txt`。正式运行开始前固定实际输入和模型快照；运行完成后记录实际环境版本。如果环境变化导致模型指纹变化，先暂停比较并登记新版本，再决定是否采用。
