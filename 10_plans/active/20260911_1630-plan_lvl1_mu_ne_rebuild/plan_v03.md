# 一级装置研究重建实例验收计划 v03

## 目标

用当前项目的目录、命名、Manifest、`10_plans`、`09_catalog`、research-state、总控 workflow、合同、子 agent dispatch、3D/COMSOL/Geant4 和报告/归档链路，完成一次真实、可恢复、可审计的一级装置最小研究实例。

本实例同时验收项目工作流和研究工作流。历史 Stage-1 只作为来源证据，不作为当前活动 geometry、活动模型或当前结论。

## 固定物理条件

- 螺线管直径 100 mm，目标磁场 1 T。
- Ne 温度 300 K，数密度范围 `1e19..1e26 m^-3`。
- 初始 geometry：4 块环形电极、3 个腔体、孔径 30 mm；角色为注入腔、加速腔、减速/引出腔。
- 备选 geometry：3 块电极、2 个腔体，只有初始方案无法满足接口或预验收条件时才建立新 contract。
- 初始轴向假设：电极厚度 3 mm；V1–V2=130 mm；V2–V3=220 mm；V3–V4=160 mm；总长度约 597 mm。它们是可追踪初始假设，不是历史结果的硬继承。
- `mu_minus` 动能均值 100 keV、sigma 20 keV、±3sigma 截断。
- muon 本征坐标系径向动量方向均值 0°、sigma 9°、±3sigma 截断；之后用记录的变换矩阵转到实验室坐标系。

## 物理模型和密度处理

Geant4 生成或验证 1 eV–1 MeV 的总平均电磁 stopping，并输出按 Ne 数密度归一化的：

```text
S_N(E) = (1 / N_Ne) * dE/dx
```

插值变量固定为总动能 `Ktotal`。用 `1e21`、`1e23`、`1e25 m^-3` 验证密度缩放，中间能量区相对偏差不超过 5%，并拒绝 NaN、Inf、负 stopping。

正式候选密度为 `1e23`、`3e23`、`1.5e24 m^-3`；选择满足预验收条件的最低候选，若无候选通过则记录失败和最佳候选，不无边界扩展扫描。

主模型包含可验证的 Geant4 角散射敏感性和连续 mean stopping。COMSOL 负责连续电磁场、轨迹和 stopping；不把 COMSOL Charged Particle Tracing 当作离散碰撞模拟器。本次不模拟原子俘获、muonic-atom formation 或 capture loss，报告明确这一限制。

电势不直接固定历史值；以 V1=0 V 为参考，在 `-5..+5 kV` 有界范围内由 COMSOL 以引出轴向动能目标反推 V2/V3/V4，最终值写入冻结 contract 和 run snapshot。

## 验收指标

- 正式样本至少 1000 粒子；若效率点估计超过 0.75 但 95% Wilson 下置信界不足，则增加至 10000 粒子。
- `transport_efficiency` 使用引出粒子数/注入粒子数，95% Wilson 下置信界必须不低于 0.75。
- 引出径向动能使用 P90，必须不高于 10 eV；同时报告 P50/P90/P95/最大值。
- 引出轴向动能使用均值，必须为 `1.00 keV ± 0.05 keV`；同时报告 P10/P50/P90/标准差。
- 所有输入、结果、单位、坐标系、模型版本、contract hash 和 SHA256 必须可追溯。

## 工作流和子 agent

执行顺序固定为：

```text
task card → research-state context → immutable contracts → model fingerprint
→ run snapshot → 3D → COMSOL → Geant4 → validation → dual reports
→ ultraqa → Drive archive → three-end audit
```

子 agent 采用三条独立 lane：

- 3D：创建四电极三腔 G1 SolidWorks geometry、检查尺寸/同轴性、导出 STEP 和 geometry Manifest；
- COMSOL：消费冻结 geometry，导入 STEP，生成场/stopping/轨迹/能量结果和 Manifest，执行有界电势选择；
- Geant4：消费冻结 geometry/COMSOL 文件，生成 `S_N(E)`、校验密度缩放、运行角散射输运并输出 score/statistics；
- reviewer：只读检查 contract、snapshot、单位、坐标系、统计定义、hash 和报告引用；
- 主 agent：唯一 research-state writer，负责总控、合同、dispatch、合并、报告、QA、归档和审计。

依赖顺序为 `3D → COMSOL → Geant4 → validation/reviewer`，不允许并行写同一输入。

## 文件接口和清理边界

SolidWorks SLDPRT → STEP → geometry Manifest；COMSOL 输出冻结场/stopping/边界文件；Geant4 消费冻结 snapshot 并输出 score/statistics。模块不通过进程间直接链接，反馈必须创建新 contract 和 snapshot。

非 `90_migration` 的 Stage-1 内容列为后续 cleanup candidate，当前不删除：

```text
02_models/comsol/legacy
02_models/comsol/legacy-scripts
02_models/solidworks/legacy
03_runs/formal/run_legacy_smoke_001_stage1_centered
04_results/figures/legacy-smoke
05_reports/interim/legacy
```

完成当前实例的来源映射、新模型快照、报告、归档和审计后，另行建立受控清理任务；`90_migration` 和 `D:\\muIon` 不在本计划删除范围内。

## 执行门和停止条件

Dashboard session 完成后先审计其 owned paths 和测试，再由本 session 串行取得 `research_state_writer`、`solidworks`、`comsol_batch`、`wsl_geant4` 锁。执行入口为：

```text
runtime_bootstrap → geometry_transfer → 3d_gate → comsol_gate
→ geant4_root_gate → snapshots → 3d → comsol → geant4
→ validation → reports → ultraqa → archive/audit
```

WSL、COMSOL、geometry、contract、snapshot、fingerprint、单位、坐标系或 hash 任一门失败，立即停止并写 IssueReport，不产生科学结论。
