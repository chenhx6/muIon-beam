# 一级装置实例验收执行规划

## 执行入口

正式实例验收从运行时门开始，不直接从物理参数扫描开始。

实例是当前项目抽象重建的新任务：100 mm 螺线管、30 mm 环形电极孔径，初始
使用 4 块电极板形成 3 个腔体；3 块电极、2 腔作为后续备选。历史 Stage-1
不作为当前活动 geometry 或求解结果。

验收同时覆盖项目文件架构、命名、总体工作流，以及 research-state、总控、
合同和 3D/COMSOL/Geant4 三模块的文件交互。

```text
runtime_bootstrap
→ geometry_transfer_check
→ 3d_geometry_gate
→ comsol_adapter_gate
→ geant4_and_root_runtime_gate
→ run_snapshot
→ 3d
→ comsol
→ geant4
→ validation
→ dual_reports
→ ultraqa
→ archive_and_audit
```

## runtime_bootstrap

记录并验证：

- Codex 进程是否能创建或访问 WSL；
- WSL distribution、用户、root 切换和环境脚本；
- `geant4-config --version`、CMake、编译器和 Geant4 prefix；
- CERN ROOT `root-config --version` 和 `root` 可执行入口；
- COMSOL 6.4 batch executable；
- SolidWorks STEP transfer evidence；
- COMSOL adapter command、Java entrypoint、geometry input 和 result JSON 接口。

密码只允许用户在本地交互输入或由本机凭据管理器提供。项目不读取、复制或登记
`ROOT_SECRET.txt` 内容，也不把 root 密码写入 Manifest、日志、计划或报告。

## 联动边界

SolidWorks 通过 STEP 和 geometry Manifest 向 COMSOL/Geant4 提供中性几何。
COMSOL 和 Geant4 通过冻结的结果/输入文件、单位、坐标系、模型指纹和 SHA256
联动，不使用进程间直接链接。

COMSOL 输出场、停止数据和边界摘要；Geant4 消费冻结快照并输出 score/statistics。
任何反馈都创建新的 contract、snapshot 和 run，不修改已冻结输入。

## 验收停止条件

- WSL 访问、Geant4、ROOT 或 COMSOL 运行时不可验证：停止在 runtime gate；
- geometry transfer 或 Manifest 哈希不一致：停止在 geometry gate；
- contract、snapshot 或 model fingerprint 不一致：停止在 traceability gate；
- 只有全部运行时门通过后，才执行物理计算和最终效率/能量验收。
