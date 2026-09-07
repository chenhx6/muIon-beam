"""Build the evidence-grounded Stage-1 3-D feasibility report."""

from __future__ import annotations

import csv
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TABLES = ROOT / "tables"
REPORTS = ROOT / "reports"
INTERMEDIATE = ROOT / "intermediate" / "results"


def read_dict(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def read_comsol_numeric(path: Path) -> list[list[float]]:
    rows: list[list[float]] = []
    with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("%"):
                continue
            try:
                rows.append([float(value) for value in line.split(",")])
            except ValueError:
                pass
    return rows


def f(value: str, scale: float = 1.0, digits: int = 4) -> str:
    number = float(value)
    if not math.isfinite(number):
        return "N/A"
    return f"{number * scale:.{digits}g}"


def main() -> None:
    baseline = read_dict(TABLES / "baseline_result.csv")[0]
    scan = read_dict(TABLES / "parameter_scan_master.csv")
    losses = read_dict(INTERMEDIATE / "single_sweep_loss_diagnostics.csv")
    field = read_comsol_numeric(TABLES / "baseline_field_diagnostics.csv")[0]
    ensemble_rows = read_comsol_numeric(INTERMEDIATE / "ensemble_500ns" / "ensemble_timeseries.csv")
    ensemble_last = ensemble_rows[-1] if ensemble_rows else []
    pre = read_dict(INTERMEDIATE / "preestimate_cooling_scales.csv")
    pre_1e23_1kev = next(
        r for r in pre
        if r["Ne_number_density_1_per_m3"] == "1.00000000e+23"
        and r["target_energy_eV"] == "1.00000000e+03"
    )
    pre_3e23_1kev = next(
        r for r in pre
        if r["Ne_number_density_1_per_m3"] == "3.00000000e+23"
        and r["target_energy_eV"] == "1.00000000e+03"
    )

    total_cases = len(scan)
    exit_cases = sum(float(r.get("transmission_fraction", 0) or 0) > 0.5 for r in scan)
    electrode_losses = sum(r.get("loss_location") == "electrode_or_aperture_edge" for r in scan)
    closest = min(losses, key=lambda r: float(r["loss_event_radial_position"]))
    electrode_loss_rows = [r for r in losses if r.get("loss_location") == "electrode_or_aperture_edge"]
    strongest_cooling = min(electrode_loss_rows, key=lambda r: float(r["loss_event_Kperp"]))
    scan_densities = sorted({float(r["Ne_number_density"]) for r in scan if r.get("Ne_number_density")})

    report = REPORTS / "stage1_feasibility_report.md"
    with report.open("w", encoding="utf-8") as handle:
        handle.write("# 一级 μ− 冷却与轴向引出装置\n")
        handle.write("# 3D 可行性分析\n\n")
        handle.write("> 本轮是一级 μ− 横向冷却与轴向引出的 3D feasibility study。Geant4 输入目前为 mean electromagnetic stopping baseline，尚未加入完整 μ−–Ne elastic angular scattering、atomic capture、muonic atom formation 以及正式 breakdown verification。因此本轮结果用于寻找候选结构和参数窗口，不是最终 μ− 生存率预测。\n\n")
        handle.write("## 摘要\n\n")
        handle.write(
            f"本轮建立了可回载的 SolidWorks 3D master、COMSOL 6.4 三维 Electrostatics + Charged Particle Tracing 模型，并接入 Geant4 11.3.2 的 μ−–Ne SN(E) stopping 表。baseline 场解成功，单 μ− 的 Kperp 从 100 keV 降至首次 V2 圆角孔口损失时的 {f(baseline['loss_event_Kperp'])} eV；但 {total_cases} 个已运行的扫描点均未到达显式 exit plane，故当前合法 candidate 数为 0。主要瓶颈是 φ30 mm 孔径与 1 T 下的回旋包络/孔口圆角接受度，而不是 Electrostatics 或 particle solver 不收敛。\n\n"
        )
        handle.write("## 1. 本轮问题\n\n")
        handle.write("问题是：100 keV、主要径向运动的 μ− 能否在 uniform Ne 与 Bz=1 T 中，经四块有限厚度环形电极获得明显 transverse cooling、稳定 +z transport，并在 exit plane 得到约 1 keV 的 Kz。`transport_survival` 只定义为到达显式出口平面且没有击中电极/介电层/接地壁；它不等同于真实 μ− survival probability。\n\n")
        handle.write("## 2. 当前装置\n\n")
        handle.write("正式物理尺寸为参数化的 100 mm effective bore、50 mm grounded-shell inner radius、5 mm representative dielectric liner、45 mm Ne gas radius、四个 φ30 mm aperture / 80 mm outer-diameter / 3 mm-thick annular electrodes。孔边采用 1 mm baseline Fillet3D。轴向顺序为 V1–source–V2–V3–V4，baseline `source_fraction_between_V1_V2=0.5`；为避免 `r_source+rL` 超过 gas radius，本次 COMSOL baseline 的 radial source fraction 调为 0.50，而 0.80 保留为 TEST_ONLY 诊断范围。\n\n")
        handle.write("![Stage1 3D geometry](../figures/01_stage1_3d_cutaway.png)\n\n")
        handle.write("SolidWorks `REPORT_3D` 的实际回载预览保存在 `../figures/08_solidworks_report_3d_cutaway.png` 与 `../figures/09_solidworks_report_3d_external.png`；图中外壳/衬层隐藏与显示分别用于确认环形电极位置。最终回载验证为 6 个 solid bodies、`SIM_3D`/`REPORT_3D` 两个正式 configuration；V1–V4 每个电极均报告两条 15 mm 与两条 16 mm 孔口圆形边，对应两端 1 mm 原生草图圆角。\n\n")
        handle.write("## 3. 参数和数据来源\n\n")
        handle.write("参数主表见 [`PARAMETER_REFERENCE.md`](PARAMETER_REFERENCE.md) 与 [`parameter_reference.csv`](../tables/parameter_reference.csv)。stopping 接口使用项目内已验收的 `muon/ne/comsol_muNe_SN.txt`，来自 Geant4 11.3.2 option3 的 261 点 μ−–natural-Ne mean electromagnetic stopping cross section；插值输入为 `Ktotal`，不是 `Kperp`。本轮没有重新生成 Geant4 stopping。\n\n")
        handle.write("软件路线：SolidWorks 2025 API 生成 master 并导出更新后的 STEP；该 STEP 已在 COMSOL 6.4 中重新导入成功（6 个 closed shells、16 个 toroidal fillet surfaces）。正式求解 MPH 使用同一尺寸的 COMSOL 3D analytic primitives，以保持物理 selections 在参数扫描中的稳定性。LiveLink associative synchronization 本轮未作为主路线使用。\n\n")
        handle.write("## 4. Pre-estimate\n\n")
        handle.write(
            f"Geant4 SN(E) 积分给出：在 n=1e23 m⁻³ 时，100 keV→1 keV 的 mean-stopping path 约 {f(pre_1e23_1kev['cooling_path_m'])} m、时间 {f(pre_1e23_1kev['cooling_time_s'], 1e9)} ns、约 {f(pre_1e23_1kev['gyro_turns'])} 个 gyro turns；在扩展点 n=3e23 m⁻³ 时约 {f(pre_3e23_1kev['cooling_path_m'])} m、{f(pre_3e23_1kev['cooling_time_s'], 1e9)} ns。100 keV、1 T 的解析 Larmor radius 为约 15.33 mm，gyroperiod 为约 7.39 ns；因此 φ30 mm aperture 是高敏感接受度约束。\n\n"
        )
        handle.write("这些是 pre-estimate，不是 COMSOL trajectory 结果，也没有包含 angular scattering、atomic capture 或 decay。\n\n")
        handle.write("## 5. Baseline electric field\n\n")
        handle.write("baseline Electrostatics stationary solve 成功，且保留了四个有限厚度圆环的 aperture fringe field 与三维横向分量。field screening 数值如下：\n\n")
        handle.write("| 指标 | baseline |\n|---|---:|\n")
        for label, value in [
            ("max E in Ne", field[1]), ("max E total", field[0]),
            ("max E at aperture/electrode boundaries", field[3]),
            ("max E in dielectric / triple-junction proxy", field[2]),
            ("average |Ez| V1–V2", field[5]),
            ("average |Ez| V2–V3", field[6]),
            ("average |Ez| V3–V4", field[7]),
        ]:
            handle.write(f"| {label} | {value:.6g} V/m |\n")
        handle.write("\n![Baseline electric field](../figures/electric_field_section.png)\n\n")
        handle.write("图中电场为真实三维有限元解；没有用 uniform Ez 替代，也没有强制 Ex=Ey=0。\n\n")
        handle.write("## 6. Single muon\n\n")
        handle.write(
            f"Single_Muon_Diagnostic 使用 μ−、初始总动能 100 keV、Kz≈0、径向指向轴线。baseline (`n={f(baseline['Ne_number_density'], digits=3)} m⁻³`, ΔV12={f(baseline['voltage_difference_V1_to_V2'])} V, ΔV23={f(baseline['voltage_difference_V2_to_V3'])} V, ΔV34={f(baseline['voltage_difference_V3_to_V4'])} V) 的轨迹产生了三维回旋，Kperp 从 100 keV 降低，并在 t≈{f(baseline['loss_event_time'], 1e9)} ns、z≈{f(baseline['loss_event_z'], 1e3)} mm、r≈{f(baseline['loss_event_radial_position'], 1e3)} mm 处首次击中 V2 aperture/rounded-edge 区域。该时刻 Kperp≈{f(baseline['loss_event_Kperp'])} eV、Kz≈{f(baseline['loss_event_Kz'])} eV；这些是 loss-event values，不是出口值。\n\n"
        )
        handle.write("![Single muon trajectory](../figures/02_single_muon_trajectory_3d.png)\n\n")
        handle.write("![Single muon energy](../figures/03_single_muon_energy.png)\n\n")
        handle.write("这证明了 radial motion → Larmor motion → mean stopping / transverse cooling 的物理链条在 3D 模型中可求解；但在当前几何与参数范围内，仍没有完整 V2–V3–V4 transport。\n\n")
        handle.write("## 7. Ensemble\n\n")
        if ensemble_last:
            handle.write(
                f"Muon_Ensemble 使用固定 5×5=25 粒子源网格，固定几何中心与 radial inward 初速，500 ns horizon。最后一个 aggregate 输出的 mean z≈{f(str(ensemble_last[3]), 1e3)} mm、mean radial position≈{f(str(ensemble_last[10]), 1e3)} mm、mean Kperp≈{f(str(ensemble_last[7]))} eV、mean Kz≈{f(str(ensemble_last[8]))} eV；aggregate exit flag 为 {ensemble_last[11]:.3g}，aggregate electrode flag 为 {ensemble_last[13]:.3g}。这是一项可复现的最小 ensemble solver check，不是统计意义上的真实生存率。\n\n"
            )
        handle.write("ensemble 的详细 aggregate time series 保存在 `../intermediate/results/ensemble_500ns/ensemble_timeseries.csv`；下一阶段应把粒子数提高到 100–500，并用真实 position/direction spread 重新定义每粒子 exit/loss 分类。\n\n")
        handle.write("## 8. Parameter scan\n\n")
        handle.write(f"`parameter_scan_master.csv` 汇总了 {total_cases} 个已完成单粒子点；扫描的 density 从 {min(scan_densities):.3g} 到 {max(scan_densities):.3g} m⁻³，包含 n=3e23 m⁻³ 的 extended feasibility scan。已覆盖 density、V1–V2、V2–V3、V3–V4、source fraction、source axial location、初始回旋相位和小范围 gap 调整。\n\n")
        handle.write(f"所有已完成点的 `transmission_fraction={exit_cases/total_cases:.3g}`（{exit_cases}/{total_cases}），其中 {electrode_losses} 个点的首个明确损失位置为 electrode/aperture-edge；最接近孔半径的记录为 `{closest['parameter_set_id']}`，r≈{f(closest['loss_event_radial_position'], 1e3)} mm，仍属于孔口/圆角边界损失。\n\n")
        handle.write("![Density scan](../figures/04_density_scan_summary.png)\n\n")
        handle.write("![Voltage scan](../figures/05_voltage_scan_summary.png)\n\n")
        handle.write("## 9. Candidate feasibility window\n\n")
        handle.write("本轮没有发现可按正式标准记录的 candidate feasibility window：`candidate_parameter_sets.csv` 为空，所有点都未到达 exit plane，因此没有把撞壁时的 Kperp/Kz 改名为 Kperp_exit/Kz_exit。最接近孔边的点只应作为下一阶段的接受度边界诊断，不能作为已成功输运的参数组。\n\n")
        handle.write("![Feasibility window status](../figures/07_feasibility_window.png)\n\n")
        handle.write("## 10. HV / engineering risk\n\n")
        handle.write("baseline 最大场出现在 Ne/电极 aperture 附近（约 {0:.4g} MV/m），其次为 aperture/electrode boundary（约 {1:.4g} MV/m）；介电层/三相结 proxy 约 {2:.4g} MV/m。".format(field[1] / 1e6, field[3] / 1e6, field[2] / 1e6))
        handle.write("这些数值只用于 `HV_RISK_SCREENING`：本轮没有 Ne Paschen 模型、dielectric breakdown/flashover 模型或可靠的气隙材料阈值，5e6 V/m 只能作为 reference field scale，不能写成“已经证明不会击穿”。\n\n")
        handle.write("![HV screening](../figures/06_hv_risk_summary.png)\n\n")
        handle.write("## 11. 当前模型限制\n\n")
        handle.write("- Geant4 输入是 mean electromagnetic stopping；没有完整 μ−–Ne elastic angular scattering。\n")
        handle.write("- 没有 atomic capture、muonic atom formation、nuclear capture 或完整真实 survival probability。\n")
        handle.write("- 10 eV 及约 1 keV 以下的解释仍属于 exploratory/model-uncertainty 范围。\n")
        handle.write("- Ne density 与 Bz=1 T 目前均匀；没有 inlet/pumping spatial gradient。\n")
        handle.write("- 没有模拟真实 1 MeV injection window。\n")
        handle.write("- 没有完成 formal breakdown verification。\n")
        handle.write("- 当前 single/ensemble 统计量用于 feasibility；尚不能代表真实 beam transmission 或 μ− survival。\n\n")
        handle.write("## 12. 本轮结论\n\n")
        handle.write("A. **有没有看到 transverse cooling？** 有。baseline 首次 V2 loss 时 Kperp≈{0} eV；全扫描中最强的 first-loss cooling diagnostic 是 `{1}`，Kperp≈{2} eV，但这些都不是 exit values。\n\n".format(f(baseline['loss_event_Kperp']), strongest_cooling['parameter_set_id'], f(strongest_cooling['loss_event_Kperp'])))
        handle.write("B. **是否成功建立 +z transport？** 局部建立：V1–V2 场使 Kz 由近零增大；整级 V2–V3–V4 transport 尚未成功。\n\n")
        handle.write("C. **有没有 Kz_exit≈1 keV candidate？** 没有。所有正式扫描点未到达 exit plane，Kz_exit/Kperp_exit 均应记为 N/A。\n\n")
        handle.write("D. **主要粒子损失在哪里？** V2 上游 aperture/rounded-edge 区域；近孔诊断也直接指向该位置。\n\n")
        handle.write("E. **合理 Lstage1 当前是什么数量级？** 当前预扫描 geometry 为约 {0:.3g} m；Geant4 pre-estimate 表明在 n=1e23–3e23 m⁻³ 下，100 keV→1 keV 的 stopping length 约 1.34–0.45 m，因此 0.6 m 是合理的第一版模型尺度，但不是最终机械长度。\n\n".format(float(baseline['Lstage1']), float(pre_1e23_1kev['cooling_path_m']), float(pre_3e23_1kev['cooling_path_m'])))
        handle.write("F. **当前最主要瓶颈是什么？** φ30 mm aperture 与 1 T 下约 15.33 mm Larmor radius 的几何接受度和 V2 孔口 fringe/圆角相位匹配；下一阶段应先解决 V2 入孔，再讨论 V3–V4 的 1 keV 调节。\n\n")
        handle.write("## 13. 下一步\n\n")
        handle.write("1. 在不改变核心装置原理的前提下，对 V2 aperture acceptance 做 position/phase-resolved ensemble（≥100 particles）并输出逐粒子 loss-location 统计。\n")
        handle.write("2. 重新检查 1 T、φ30 mm 孔径与 100 keV 横向回旋包络的几何匹配，优先扫描 source placement、V1–V2 timing/spacing 与允许的 electrode-edge rounding。\n")
        handle.write("3. 一旦形成 V2–V3 transport，再单独扫描 V2–V3 加速与 V3–V4 减速，寻找 0.5–2 keV 的真实 exit-plane Kz 窗口。\n")
        handle.write("4. 保留 Geant4 SN(E) interface，同时加入 angular scattering / atomic capture 的敏感性模型，避免把 mean stopping 结果外推为真实 survival。\n")
        handle.write("5. 对 aperture、outer edge、dielectric triple junction 建立网格收敛与工程 breakdown/Paschen 评估。\n\n")
        handle.write("## 科研归档与复现入口\n\n")
        handle.write("- SolidWorks master: [`Stage1_Master_3D.SLDPRT`](../cad/Stage1_Master_3D.SLDPRT)；neutral transfer: [`Stage1_Master_3D.step`](../cad/Stage1_Master_3D.step)。\n")
        handle.write("- COMSOL primary model: [`stage1_3d_feasibility.mph`](../comsol/stage1_3d_feasibility.mph)。\n")
        handle.write("- COMSOL STEP import check: [`stage1_solidworks_step_import_check.mph`](../comsol/stage1_solidworks_step_import_check.mph)。\n")
        handle.write("- Formal figures: `../figures/`；formal tables: `../tables/`；reproducible scripts: `../scripts/`。\n")
        handle.write("- Computation-derived intermediate results are intentionally retained under `../intermediate/results/`, including failed/near-boundary cases and ensemble checkpoints.\n")

    readme = ROOT / "README.md"
    with readme.open("w", encoding="utf-8") as handle:
        handle.write("# Stage1 3D feasibility archive\n\n")
        handle.write("Start with [stage1_feasibility_report.md](reports/stage1_feasibility_report.md), [PARAMETER_REFERENCE.md](reports/PARAMETER_REFERENCE.md), the formal figures and tables.\n\n")
        handle.write("The primary COMSOL model is a solved COMSOL 6.4 3-D analytic-primitive physics master; the SolidWorks master and STEP transfer are separately verified. All output is feasibility-only and uses the supplied Geant4 mean electromagnetic stopping baseline.\n\n")
        handle.write("Rebuild the COMSOL master with `scripts/BuildStage1_3D.java` using the bundled COMSOL Java compiler or `javac` plus `comsolbatch`. The sweep runners in `scripts/` retain per-case CSVs under `intermediate/results/`.\n")
    print(report)
    print(readme)


if __name__ == "__main__":
    main()
