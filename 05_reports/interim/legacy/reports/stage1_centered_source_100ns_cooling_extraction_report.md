# 居中回旋源、100 ns 冷却、三目标输运与电场分布报告

**版本**：2026-09-07  
**主模型**：`stage1_3d_feasibility/comsol/stage1_3d_feasibility.mph`（COMSOL 6.4，3D）  
**本轮对象**：自由 μ⁻ 的工程可行性模型；不含缪原子形成、电子剥离、核俘获和 μ⁻ 衰变权重。

## 1. 结论先行

本轮已经把“中心回旋源 → Ne 冷却 → 四环电极静电场 → 粒子场效应导出 → 统计和绘图”实现为可重复脚本链路，并完成了 500 粒子 Phase A 密度扫描和若干 Phase B 3D 工况。

最重要的数值结果是：

| 项目                          |                                                           结果 | 判定                                |
| ----------------------------- | -------------------------------------------------------------: | ----------------------------------- |
| 初始能量                      |                             均值 100.377 keV，标准差 5.103 keV | 按计划                              |
| 方向扰动                      |             总角度 RMS 8.979°，9° 作为 1σ；3σ 外（>27°）重采样 | 按计划                              |
| 名义回旋半径                  |                                      15.358 mm（100 keV、1 T） | 按计划                              |
| Phase A 最低已扫描通过点      |                   \(n_{\rm Ne}=1.5\times10^{24} {\rm m^{-3}}\) | \(P_{90}[K_\perp(100 ns)]\le10\) eV |
| Phase A 前一密度              |                                (1.2\times10^{24} {\rm m^{-3}}) | P90 (K_\perp=12.94) eV，未通过      |
| 1.5×10²⁴ m⁻³ 的 P90 (t_{10})  |                                                       80.08 ns | 100 ns 内通过                       |
| 已完成的 500 粒子四环低场工况 |  \(n=10^{24} {\rm m^{-3}},\ d_a=60\) mm，\(Delta V_{23}=2\) kV | 0/500 到达出口                      |
| 已完成的高场 10 粒子筛选      | \(n=10^{24} {\rm m^{-3}},\ d_a=60\) mm，\(Delta V_{23}=10\) kV | 0/10 到达出口                       |
| 三目标联合通过                |                                                       尚未得到 | 不能把“无出口样本”误报为通过        |

因此，本轮的正式结论是：**纯气体径向冷却已经找到 1.5×10²⁴ m⁻³ 量级的首个扫描通过点；四环输运尚未形成同时满足 100 ns、出口能量窗口和 (T_{\rm geom}>0.75) 的候选窗口。** 后续重点应放在 V1–V2 过渡、孔口相位和轴向加速段的几何/电压重设计，而不是继续盲目增加 Ne 密度。

## 2. 验收定义

本轮采用出口分布中心值定义能量目标：

\[
P_{90}(t_{\rm exit})<100\ {\rm ns},\qquad
T_{\rm geom}>0.75,
\]

\[
|\overline{K_{\rm total,exit}}-1.00\ {\rm keV}|\le0.05\ {\rm keV},
\qquad
\sigma_{K_{\rm total,exit}}\le0.05\ {\rm keV},
\]

\[
P_{90}(K_{\perp,\rm exit})\le10\ {\rm eV}.
\]

这里的 1 keV 是出口总动能分布的中心值，不是每一个粒子的硬下限。因此报告同时保留 (K_{\rm exit}>1) keV、0.95–1.05 keV、低于 0.95 keV 和高于 1.05 keV 的比例。对于没有出口粒子的工况，这些出口统计量记为 NaN，而不是用最后一个未到达出口的粒子状态代替。

本轮**没有**计算

\[
\exp(-t/\tau_\mu),\quad \tau_\mu=2.2\ \mu{\rm s},
\]

也没有加入核俘获、缪原子级联、电子剥离或缪离子电荷态分布。存货率 (T_{\rm geom}) 只表示几何/输运到达率。

## 3. 源模型和一个关键单位修正

### 3.1 中心回旋源

对 \(q_\mu=-e\)、\(B_z=+1\) T，100 keV μ⁻ 的名义速度沿局部 \(+\phi\) 方向，源半径取一个名义 Larmor 半径：

\[
r_L=\frac{m_\mu v_\perp}{|q_\mu|B_z}=15.3337\ {\rm mm}.
\]

名义 guiding center 在轴线上。每个粒子独立抽取：

- \(K_0\sim\mathcal N(100\ {\rm keV},5\ {\rm keV})\)，并限制在 85–115 keV；
- 方位角均匀分布；
- 在名义切向方向周围加入二维高斯角扰动；两个正交分量的标准差为 \(9^\circ/\sqrt2\)，使总角度 RMS 为 9°；
- 总偏转超过 27°（3σ）时重采样；
- 固定随机种子 `20260907`，正式样本数 500。

生成的源文件和元数据位于：

- [`centered_release_500_seed20260907_z93mm_nominal.txt`](../stage1_3d_feasibility/data/centered_source/centered_release_500_seed20260907_z93mm_nominal.txt)
- [`centered_release_500_seed20260907_z93mm_nominal.csv`](../stage1_3d_feasibility/data/centered_source/centered_release_500_seed20260907_z93mm_nominal.csv)
- [`centered_release_500_seed20260907_z93mm_nominal.json`](../stage1_3d_feasibility/data/centered_source/centered_release_500_seed20260907_z93mm_nominal.json)

样本的平均 guiding-center 半径为 1.414 mm，最大为 5.377 mm。初始分布图见：

![中心源能量和方向分布](../stage1_3d_feasibility/figures/centered/scans/source_K_theta_distribution.png)

### 3.2 `ReleaseFromDataFile` 的位置单位

本轮发现并修正了一个会把源位置缩小 1000 倍的 COMSOL 接口问题：Stage-1 组件的几何单位是 mm，`ReleaseFromDataFile` 的前三列按组件几何单位解析，而速度列仍按 m/s 解析。因而释放文件现在明确写成

```text
x[mm]  y[mm]  z[mm]  vx[m/s]  vy[m/s]  vz[m/s]
```

伴随 CSV 仍保留 SI 坐标用于审计。这个修正确保 z=93 mm 的源真正位于 V1–V2 间隙，而不是 z=0.093 mm 的入口附近；Phase A 的 3 m 校准腔则使用 z=1500 mm 的中面源。

## 4. COMSOL 物理模型修改

新增/修改的实现文件：

- [`generate_centered_release.py`](../stage1_3d_feasibility/scripts/generate_centered_release.py)：固定种子中心回旋源；支持 mm/m 位置单位选项。
- [`BuildCenteredCoolingModel.java`](../stage1_3d_feasibility/scripts/BuildCenteredCoolingModel.java)：无电压、均匀 1 T、纯 Ne 的 3D 冷却校准模型。
- [`RunCenteredCoolingScan.java`](../stage1_3d_feasibility/scripts/RunCenteredCoolingScan.java)：密度扫描。
- [`BuildCenteredStage1Model.java`](../stage1_3d_feasibility/scripts/BuildCenteredStage1Model.java)：加载 canonical 3D MPH、修复 stopping-table 路径、替换释放节点、重建几何并导出输运/场数据。
- [`run_centered_transport_scan.py`](../stage1_3d_feasibility/scripts/run_centered_transport_scan.py)：串行 Phase B 工况编排，每个工况独立偏好目录、临时目录、MPH 和日志。
- [`analyze_centered_results.py`](../stage1_3d_feasibility/scripts/analyze_centered_results.py)：逐粒子首过阈值、出口、状态和损失统计。
- [`prepare_centered_exports.py`](../stage1_3d_feasibility/scripts/prepare_centered_exports.py)：把 COMSOL CutPlane/CutLine/Particle 表重排为报告约定的总表。
- [`make_centered_figures.py`](../stage1_3d_feasibility/scripts/make_centered_figures.py)：线性/对数场图、腔体图、孔口图和参数图。

粒子方程仍为

\[
m_\mu\frac{d\mathbf v}{dt}=q_\mu(\mathbf E+\mathbf v\times\mathbf B)+\mathbf F_{\rm stop}.
\]

其中静电场来自真实三维四环电极的 `Electrostatics` 解，磁场在当前 Stage-1 中仍是均匀 \(B_z=1\) T（还不是线圈绕组有限元场）。Ne stopping 使用 `muon/ne/comsol_muNe_SN.txt` 插值，评价能量为

\[
K_{\rm eval}=\max(K_{\rm total},10\ {\rm eV}).
\]

为避免在表格下限外使用未验证的 \(1/v\) 力造成无意义的超小时间步，本轮加入了明确的数值正则化：Phase A 的横向 stopping 在 (K_\perp=1\) keV 到 10 eV 之间线性降为零，过 10 eV 阈值后只记录事件；完整四环模型的轴向 stopping 在总能量低于 100 eV 时关闭。该处理不应被解释为真实低能碰撞截面。

## 5. Phase A：无电压纯 Ne 冷却

### 5.1 几何和边界

Phase A 不放置四块极板，只使用半径 100 mm、长度 3000 mm 的 Ne 圆柱和均匀 1 T 磁场。源位于 z=1500 mm，保证 100 ns 内的 (\pm9^\circ) 轴向扰动不会先撞到校准腔端面。输出步长 0.1 ns，500 个释放粒子，\(E=0\)。

### 5.2 实际密度结果

| \(n_{\rm Ne}\) (m⁻³) | P50 \(K_\perp(100,ns)\) (eV) | P90 \(K_\perp(100,ns)\) (eV) | 过 10 eV 比例 | P90 \(t_{10}\) (ns，未过阈值按100 ns删失) |
| -------------------: | ---------------------------: | ---------------------------: | ------------: | ----------------------------------------: |
| \(1.0\times10^{23}\) |                       83,250 |                       89,253 |             0 |                                     100.0 |
| \(2.0\times10^{23}\) |                       68,490 |                       73,872 |             0 |                                     100.0 |
| \(3.0\times10^{23}\) |                       55,166 |                       59,943 |             0 |                                     100.0 |
| \(5.0\times10^{23}\) |                       32,948 |                       36,476 |             0 |                                     100.0 |
| \(8.0\times10^{23}\) |                       10,228 |                       12,219 |             0 |                                     100.0 |
| \(1.0\times10^{24}\) |                        2,258 |                        3,218 |             0 |                                     100.0 |
| \(1.2\times10^{24}\) |                         1.21 |                        12.94 |         0.882 |                                     99.26 |
| \(1.5\times10^{24}\) |                           ~0 |                           ~0 |         1.000 |                                     80.08 |

首个已扫描通过点因此取

\[
\boxed{n_{\rm min,cool}=1.5\times10^{24}\ {\rm m^{-3}}}
\]

这里“最低”是当前离散扫描网格上的最低通过点；建议下一轮在 (1.20\)–(1.50\times10^{24} {\rm m^{-3}}) 之间做 0.05×10²⁴ 或更细的局部扫描，以取得真正的连续阈值。

### 5.3 “最低扫描通过点”的可复算定义

这个数不是由拟合曲线外推得到，而是对已经完成的离散密度网格逐点执行同一条规则：

```text
pass(n) = P90(Kperp at 100 ns for density n) <= 10 eV
```

在所有低于 1.5E24 /m^3 的已扫描点中，最接近阈值的是 1.2E24 /m^3：500 粒子中 441 粒子（88.2%）过 10 eV，但 P90 仍为 12.9415 eV，所以不通过。1.5E24 /m^3 时 500/500 粒子过阈值，P90 约为 1.5E-18 eV，所以通过。更低的 1.0E24 /m^3 和 8.0E23 /m^3 的 P90 分别为 3217.6 eV 和 12218.7 eV，也都不通过。

因此严格表述应为：**在当前 Phase-A 离散扫描集合和当前 stopping 正则化模型中，1.5E24 /m^3 是最低的已扫描通过点；连续意义的真实临界密度仍位于 1.2E24–1.5E24 /m^3 之间，需要继续细扫才能确定。**

![Ne 密度与径向冷却时间](../stage1_3d_feasibility/figures/centered/scans/neon_number_density_radial_cooling_time.png)

![Ne 密度与残余横向能量](../stage1_3d_feasibility/figures/centered/scans/neon_number_density_Kperp.png)

![Ne 密度与过阈值比例](../stage1_3d_feasibility/figures/centered/scans/neon_number_density_threshold_fraction.png)

原始逐粒子表和汇总表：

- [`cooling_density_summary.csv`](../stage1_3d_feasibility/tables/centered/cooling_density_summary.csv)
- [`cooling_scan_final/`](../stage1_3d_feasibility/tables/centered/cooling_scan_final/)
- [`centered_cooling_calibration.mph`](../stage1_3d_feasibility/comsol/centered_cooling_calibration.mph)

## 6. Phase B：四环极板输运

### 6.1 坐标和腔体定义

所有 COMSOL 场导出都保留真实坐标，轴向 z 和横向 x/y 的显示单位为 mm。完整 Stage-1 的轴向区域为：

| 区域 | z 范围（基线几何，mm） | 功能               |
| ---- | ---------------------: | ------------------ |
| C0   |                   0–25 | 入口端面到 V1 上游 |
| C12  |                 28–158 | V1–V2 清间隙       |
| C23  |                161–381 | 主轴向加速间隙     |
| C34  |                384–544 | 末段能量整形       |
| C4   |                547–597 | V4 下游到出口      |

基线孔径为 30 mm；本轮已完成的低场 500 粒子场解使用孔径 60 mm。V1–V2 间隙改变时，释放文件的 z 位置也必须同步改变：例如 40 mm 清间隙时，源中面约为 z=48 mm。

### 6.2 已完成的输运工况

| 工况                             | 粒子数 | (n_{\rm Ne}) |  孔径 | (Delta V_{12}) | (Delta V_{23}) | (V_4-V_1) | 结果                                     |
| -------------------------------- | -----: | -----------: | ----: | -------------: | -------------: | --------: | ---------------------------------------- |
| `transport_lowfield_1e24_a60_v2` |    500 |         1e24 | 60 mm |         0.5 kV |           2 kV |      1 kV | 0/500 出口；63 个反向，437 个超时        |
| `transport_highfield_10`         |     10 |         1e24 | 60 mm |         0.5 kV |          10 kV |      1 kV | 0/10 出口；用于高场筛选                  |
| `transport_short2_dv12_2_fixsel` |      2 |       1.5e24 | 70 mm |           2 kV |          10 kV |      1 kV | 2 条轨迹过冷却，但均未到出口             |
| `transport_short2_nostop`        |      2 |       1.5e24 | 70 mm |           2 kV |          10 kV |      1 kV | 停止力关闭的电场响应诊断，不属于正式验收 |

低场 500 粒子在 100 ns 的未到达出口粒子仍有明显残余横向能量：P50 约 2.41 keV，P90 约 11.23 keV。这个结果说明“达到 Phase A 冷却密度”并不自动等于“能穿过 V2 并被 C23 加速”；V1–V2 入口相位、孔径和电场边缘必须一起优化。

另外，(n=1.5\times10^{24}\ {\rm m^{-3}},\ \Delta V_{23}=10) kV 的 500 粒子长几何试算在约 80 ns 出现 COMSOL 瞬态牛顿迭代不收敛；这类工况在汇总表中不计作出口损失或通过，原始日志保留在 `intermediate/centered_stage_baseline_v2_stdout.txt`、`intermediate/centered_candidate_gap40_500_stdout.txt`。后续应先用短间隙/分段电压和更细孔口网格做稳定性筛选，再扩大到 500 粒子正式样本。

逐粒子结果：

- [`transport_scan_master.csv`](../stage1_3d_feasibility/tables/centered/transport_scan_master.csv)
- [`loss_diagnostics.csv`](../stage1_3d_feasibility/tables/centered/loss_diagnostics.csv)
- [`transport_lowfield_1e24_a60_v2/history/`](../stage1_3d_feasibility/tables/centered/transport_lowfield_1e24_a60_v2/history/)

![中心源 r-z 轨迹](../stage1_3d_feasibility/figures/centered/particle/centered_trajectories_rz.png)

![中心源 x-y 轨迹](../stage1_3d_feasibility/figures/centered/particle/centered_trajectories_xy.png)

![横向动能历史](../stage1_3d_feasibility/figures/centered/particle/energy_history_Kperp.png)

![总动能历史](../stage1_3d_feasibility/figures/centered/particle/energy_history_total.png)

## 7. 整体电场、电势和 μ⁻ 势能

### 7.1 COMSOL 直接导出

场图不从已有 PNG 反向读取，而是从 `CutPlane`/`CutLine3D` 数据集直接导出。导出的分量包括

\[
E_x,\ E_y,\ E_z,
\quad E_\perp=\sqrt{E_x^2+E_y^2},
\quad |E|,
\]

以及粒子诊断量

\[
P_E=q_\mu\mathbf E\cdot\mathbf v,
\qquad
U_\mu=q_\mu(V-V_1),
\qquad
K_{\rm total}+U_\mu.
\]

当前高场 10 粒子工况的静电场摘要为：

| 指标         | 数值 |
| ------------ | ---: |
| Ne 域最大 \( |    E | \) | \(3.6334\times10^6\) V/m |
| 孔口最大 \(  |    E | \) | \(2.0709\times10^6\) V/m |
| C12 平均 \(  |  E_z | \) | \(2.989\times10^3\) V/m  |
| C23 平均 \(  |  E_z | \) | \(3.877\times10^4\) V/m  |
| C34 平均 \(  |  E_z | \) | \(5.488\times10^4\) V/m  |

另做了零电压回归：V1=V2=V3=V4=0 时，`field_summary_comsol.csv` 的 `max_E_total`、孔口最大场和三个间隙平均轴向场均为 0 V/m（数值输出为精确零）。这确认线性/对数场图中的非零场来自电极电势，而不是导出坐标或场变量残留。

表格文件：

- [`field_global_planes.csv`](../stage1_3d_feasibility/tables/centered/field_global_planes.csv)
- [`field_cavity_slices.csv`](../stage1_3d_feasibility/tables/centered/field_cavity_slices.csv)
- [`field_aperture_zoom.csv`](../stage1_3d_feasibility/tables/centered/field_aperture_zoom.csv)
- [`field_summary.csv`](../stage1_3d_feasibility/tables/centered/field_summary.csv)
- [`potential_global_planes.csv`](../stage1_3d_feasibility/tables/centered/potential_global_planes.csv)
- [`particle_field_history.csv`](../stage1_3d_feasibility/tables/centered/particle_field_history.csv)

### 7.2 整体场图

线性色标显示空间结构；对数图使用

\[
\log_{10}\max(|E_i|,1\ {\rm V/m})
\]

作为显示变换，1 V/m 只是绘图 floor，不是物理阈值。对 \(E_z\)、\(E_r\) 的线性图使用以零为中心的正负色标；对数图显示幅值，避免把符号和数量级混在一起。

![整体 |E| 线性](../stage1_3d_feasibility/figures/centered/field/overall/linear/overall_E_linear.png)

![整体 |E| 对数](../stage1_3d_feasibility/figures/centered/field/overall/log/overall_E_log.png)

![整体 Ez 线性](../stage1_3d_feasibility/figures/centered/field/overall/linear/overall_Ez_linear.png)

![整体 |Ez| 对数](../stage1_3d_feasibility/figures/centered/field/overall/log/overall_Ez_log.png)

![整体 Er 线性](../stage1_3d_feasibility/figures/centered/field/overall/linear/overall_Er_linear.png)

![整体 |Er| 对数](../stage1_3d_feasibility/figures/centered/field/overall/log/overall_Er_log.png)

![整体横向场线性](../stage1_3d_feasibility/figures/centered/field/overall/linear/overall_Eperp_linear.png)

![整体横向场对数](../stage1_3d_feasibility/figures/centered/field/overall/log/overall_Eperp_log.png)

### 7.3 五个腔体

每个腔体均以实际 z 范围绘制，不用无量纲压缩坐标。图形目录：

- [`C0 线性场图`](../stage1_3d_feasibility/figures/centered/field/cavities/linear/C0_E_linear.png) / [`C0 对数场图`](../stage1_3d_feasibility/figures/centered/field/cavities/log/C0_E_log.png)
- [`C12 线性场图`](../stage1_3d_feasibility/figures/centered/field/cavities/linear/C12_E_linear.png) / [`C12 对数场图`](../stage1_3d_feasibility/figures/centered/field/cavities/log/C12_E_log.png)
- [`C23 线性场图`](../stage1_3d_feasibility/figures/centered/field/cavities/linear/C23_E_linear.png) / [`C23 对数场图`](../stage1_3d_feasibility/figures/centered/field/cavities/log/C23_E_log.png)
- [`C34 线性场图`](../stage1_3d_feasibility/figures/centered/field/cavities/linear/C34_E_linear.png) / [`C34 对数场图`](../stage1_3d_feasibility/figures/centered/field/cavities/log/C34_E_log.png)
- [`C4 线性场图`](../stage1_3d_feasibility/figures/centered/field/cavities/linear/C4_E_linear.png) / [`C4 对数场图`](../stage1_3d_feasibility/figures/centered/field/cavities/log/C4_E_log.png)

每个区域也有对应 \(E_z\) 线性/对数图。C23 是当前场设计中最强的轴向加速段，但粒子若不能稳定穿过 V2，C23 的高场不会转化为出口动能。

### 7.4 孔口和边缘场

V1–V4 的上/下游孔口局部图位于：

- [`apertures/linear/`](../stage1_3d_feasibility/figures/centered/field/apertures/linear/)
- [`apertures/log/`](../stage1_3d_feasibility/figures/centered/field/apertures/log/)

例如 [`V2_aperture_E_linear.png`](../stage1_3d_feasibility/figures/centered/field/apertures/linear/V2_aperture_E_linear.png) 和 [`V2_aperture_E_log.png`](../stage1_3d_feasibility/figures/centered/field/apertures/log/V2_aperture_E_log.png) 可用于区分孔径过小、回旋相位不匹配和 (E_r) 散焦。当前已完成的场解主要来自 60 mm 孔径工况；30/40/50 mm 的峰值场仍应通过正式几何扫描补齐。

### 7.5 电势和 μ⁻ 势能

因为 \(q_\mu=-e\)，电势升高对应 μ⁻ 势能降低：

\[
U_\mu/{\rm eV}=-(V-V_1)/{\rm V}.
\]

![整体电势](../stage1_3d_feasibility/figures/centered/potential/potential_global_V_linear.png)

![整体 μ− 势能](../stage1_3d_feasibility/figures/centered/potential/potential_global_U_mu_linear.png)

![等势线](../stage1_3d_feasibility/figures/centered/potential/potential_global_equipotential.png)

![轴向电势和 Ez](../stage1_3d_feasibility/figures/centered/potential/axis_potential_and_Ez.png)

![轴向 μ− 势能](../stage1_3d_feasibility/figures/centered/potential/axis_muon_potential_energy.png)

## 8. 粒子沿途受到的电场作用

沿粒子轨迹导出的量包括 (E_r)、(E_z)、(|E|)、(P_E=q_\mu\mathbf E\cdot\mathbf v)、(K_\perp)、(K_z)、(K_{\rm total})、(U_\mu) 和 (K_{\rm total}+U_\mu)。磁场不直接做功，因此 (P_E) 是区分静电加速与纯回旋的直接诊断。

![粒子场作用历史](../stage1_3d_feasibility/figures/centered/particle/field_effect_history.png)

![粒子势能历史](../stage1_3d_feasibility/figures/centered/particle/potential_energy_history.png)

对于短间隙 2 粒子诊断，粒子确实可以先把 (K_\perp) 压到 10 eV 以下，但若 V1–V2 处的轴向势垒/孔口相位不合适，粒子会在 V2 附近停留，不能到达 C23 和出口。这是当前输运失败的物理定位线索。

## 9. E/N 与击穿风险图

定义 Townsend 单位：

\[
1\ {\rm Td}=10^{-21}\ {\rm V\,m^2},
\qquad E/N=E/n_{\rm Ne}.
\]

在 (n=10^{24}\ {\rm m^{-3}}) 时，当前高场工况的 Ne 域最大场约对应 (3.63\times10^3) Td。图中只标出 E/N 诊断和已完成的样本点，**没有**把它转换成击穿概率，也没有套用 Paschen 阈值，因为本模型没有气体电子倍增、碰撞电离、温度/压力变化和放电方程。

![密度×场强的 E/N](../stage1_3d_feasibility/figures/centered/scans/density_x_field_EN.png)

![密度×场强与出口时间](../stage1_3d_feasibility/figures/centered/scans/density_x_field_P90_exit_time.png)

![密度×场强与几何传输率](../stage1_3d_feasibility/figures/centered/scans/density_x_field_transport_rate.png)

出口均值、出口能散和三目标联合状态也分别输出为 [`density_x_field_mean_Kexit.png`](../stage1_3d_feasibility/figures/centered/scans/density_x_field_mean_Kexit.png)、[`density_x_field_sigma_Kexit.png`](../stage1_3d_feasibility/figures/centered/scans/density_x_field_sigma_Kexit.png) 和 [`density_x_field_joint_pass.png`](../stage1_3d_feasibility/figures/centered/scans/density_x_field_joint_pass.png)。当前已完成的 Phase B 样本没有出口粒子，因此这三张图明确显示为空样本，而不是用未到达出口的能量冒充出口能量。

后续若研究击穿，需另建 Townsend/Paschen 或等离子体放电模型，并把 (E/N) 作为输入，而不是从当前静电场直接宣称“会击穿”。

## 10. 参数作用图和模型迭代

已生成：

- [`electric_field_strength_acceleration_time.png`](../stage1_3d_feasibility/figures/centered/scans/electric_field_strength_acceleration_time.png)：C23 平均场与 V2 穿越时间诊断；无穿越时按 100 ns 删失。
- [`electric_field_strength_axial_velocity.png`](../stage1_3d_feasibility/figures/centered/scans/electric_field_strength_axial_velocity.png)：场强与末时刻轴向速度。
- [`aperture_peak_field_reference.png`](../stage1_3d_feasibility/figures/centered/scans/aperture_peak_field_reference.png)：已完成 60 mm 场解与待扫描孔径的明确区分；“pending”不是插值结果。
- [`baseline_candidate_final_comparison.png`](../stage1_3d_feasibility/figures/centered/scans/baseline_candidate_final_comparison.png)：已完成基线/高场筛选/短间隙诊断的同指标对比。

![电场强度与加速时间](../stage1_3d_feasibility/figures/centered/scans/electric_field_strength_acceleration_time.png)

![电场强度与轴向速度](../stage1_3d_feasibility/figures/centered/scans/electric_field_strength_axial_velocity.png)

![基线与候选工况对比](../stage1_3d_feasibility/figures/centered/scans/baseline_candidate_final_comparison.png)

当前正式汇总表：

- [`cooling_density_summary.csv`](../stage1_3d_feasibility/tables/centered/cooling_density_summary.csv)
- [`transport_scan_master.csv`](../stage1_3d_feasibility/tables/centered/transport_scan_master.csv)
- [`candidate_parameter_sets.csv`](../stage1_3d_feasibility/tables/centered/candidate_parameter_sets.csv)
- [`variable_sensitivity.csv`](../stage1_3d_feasibility/tables/centered/variable_sensitivity.csv)
- [`centered_scan_plan.csv`](../stage1_3d_feasibility/tables/centered/centered_scan_plan.csv)

## 11. 问题—图形对应关系

| 分析问题               | 本轮图形/表格                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 气体密度对冷却时间     | [`neon_number_density_radial_cooling_time.png`](../stage1_3d_feasibility/figures/centered/scans/neon_number_density_radial_cooling_time.png)，`cooling_density_summary.csv`                                                                                                                                                                              |
| 气体密度对残余横向能量 | [`neon_number_density_Kperp.png`](../stage1_3d_feasibility/figures/centered/scans/neon_number_density_Kperp.png)                                                                                                                                                                                                                                         |
| 电场对加速过程         | [`electric_field_strength_acceleration_time.png`](../stage1_3d_feasibility/figures/centered/scans/electric_field_strength_acceleration_time.png)、[`electric_field_strength_axial_velocity.png`](../stage1_3d_feasibility/figures/centered/scans/electric_field_strength_axial_velocity.png)                                                             |
| 密度和电场共同作用     | [`density_x_field_EN.png`](../stage1_3d_feasibility/figures/centered/scans/density_x_field_EN.png)、[`density_x_field_P90_exit_time.png`](../stage1_3d_feasibility/figures/centered/scans/density_x_field_P90_exit_time.png)、[`density_x_field_transport_rate.png`](../stage1_3d_feasibility/figures/centered/scans/density_x_field_transport_rate.png) |
| 极板孔径对场分布       | [`aperture_peak_field_reference.png`](../stage1_3d_feasibility/figures/centered/scans/aperture_peak_field_reference.png)、`field_aperture_zoom.csv`、V1–V4 孔口局部图                                                                                                                                                                                    |
| 最终场的粒子行为       | `centered_trajectories_rz.png`、`centered_trajectories_xy.png`、`loss_diagnostics.csv`                                                                                                                                                                                                                                                                   |
| μ 子生命周期约束       | 本轮输出总输运时间/100 ns 窗口；不耦合 (exp(-t/\tau_\mu))，因此没有自由 μ 衰变权重图                                                                                                                                                                                                                                                                     |
| 模型迭代效果           | [`baseline_candidate_final_comparison.png`](../stage1_3d_feasibility/figures/centered/scans/baseline_candidate_final_comparison.png)                                                                                                                                                                                                                     |

## 12. 可重复运行顺序

在已安装 COMSOL 6.4 的机器上，建议按以下顺序运行：

```text
1. python scripts/generate_centered_release.py --count 500 --seed 20260907 --source-z-mm 93 --comsol-position-unit mm
2. 编译 BuildCenteredCoolingModel.java 和 RunCenteredCoolingScan.java
3. 用 comsolbatch 运行 RunCenteredCoolingScan.class，得到 Phase A 密度表
4. 编译 BuildCenteredStage1Model.java
5. 用 comsolbatch 运行一个 Phase B 工况或 scripts/run_centered_transport_scan.py
6. python scripts/analyze_centered_results.py --cooling-root tables/centered/cooling_scan_final --transport-root tables/centered
7. python scripts/prepare_centered_exports.py
8. python scripts/make_centered_figures.py
```

COMSOL 每次运行使用独立 `-prefsdir`、`-configuration` 和 `-tmpdir`。输运扫描器默认串行运行，以避免多个 COMSOL 粒子追踪解同时占用许可证和内存。

## 13. 下一轮必须优先检查的事项

1. 在 (n=1.5\times10^{24}\ {\rm m^{-3}}) 固定后，先做 V1–V2 间隙 20/40/80 mm、孔径 50/60/70 mm、源中面同步移动的局部扫描。
2. 对每个电压工况保留 V2 前后的粒子状态；当前高场失败表明“C23 场很强”不等于粒子能进入 C23。
3. 把四环 Wall 节点分成出口 Freeze 与电极/外壁 loss 选择，避免单一 Wall 节点同时承担出口取样和损失分类。
4. 用 `particlestatus`（1 active、2 frozen、3 stuck、4 disappeared）作为最终状态主判据，并继续导出首次损失坐标。
5. 对 30/40/50/60 mm 孔径重新求静电场，检查孔口细网格收敛；当前 60 mm 之外没有实算峰值场。
6. 只有当几何传输率超过 0.75 后，才值得在 (V_4-V_1=1.00\)–1.10 kV 区间细调出口能量和标准差。

## 14. 限制和适用范围

当前模型回答的是“给定自由 μ⁻ 初始分布和 Geant4 平均 Ne stopping 后，三维静电/磁场是否能在短时间内操纵粒子”的问题。它还不能回答：

- muonic atom / muonic ion 的形成效率；
- 电子剥离后电荷态分布；
- μ⁻ 核俘获和真实有效寿命；
- 弹性散射、角扩散、能损涨落和二次电子；
- Ne 气体击穿概率；
- 靶内核反应率。

因此当前 (T_{\rm geom}) 是几何输运存货率，不是最终 muonic-ion 产额；当前 100 ns 是硬输运窗口，不是加入寿命后的反应概率。下一阶段应在找到稳定出口窗口后，再把 Geant4 的粒子输运和真实缪原子/缪离子反应过程接回工作流。
