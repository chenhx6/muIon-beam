"""Generate the semantic Stage-1 3-D parameter reference table and Markdown."""

from __future__ import annotations

import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TABLES = ROOT / "tables"
REPORTS = ROOT / "reports"
TABLES.mkdir(exist_ok=True)
REPORTS.mkdir(exist_ok=True)


def row(name: str, zh: str, en: str, unit: str, baseline: str, kind: str,
        scan: str, notes: str) -> dict[str, str]:
    return {
        "parameter_name": name,
        "Chinese_description": zh,
        "English_description": en,
        "unit": unit,
        "baseline_value": baseline,
        "parameter_type": kind,
        "scan_range": scan,
        "source_status": {
            "CONFIRMED_BASELINE": "USER_CONFIRMED",
            "DERIVED": "DERIVED_FROM_MODEL",
            "PRE_SCAN_DERIVED": "DERIVED_FROM_PRE_ESTIMATE",
            "PHYSICS_INPUT": "MODEL_INPUT",
            "SCAN_PARAMETER": "USER_SCOPE_SCAN",
            "REFERENCE_TARGET": "EXPLORATORY_TARGET",
            "ENGINEERING_ASSUMPTION": "ASSUMPTION_ONLY",
            "TEST_ONLY": "TEST_ONLY",
        }.get(kind, kind),
        "notes": notes,
    }


def build_rows() -> list[dict[str, str]]:
    return [
        row("solenoid_bore_inner_diameter", "有效螺线管孔径", "Effective solenoid bore inner diameter", "mm", "100", "CONFIRMED_BASELINE", "fixed", "Uniform Bz model; coil geometry not included."),
        row("grounded_shell_inner_diameter", "接地安全壳内径", "Grounded safety-shell inner diameter", "mm", "100", "ENGINEERING_ASSUMPTION", "fixed in baseline", "Electrical-boundary representation of the 100 mm bore."),
        row("grounded_shell_radial_wall_thickness", "接地壳代表性壁厚", "Representative grounded-shell radial wall thickness", "mm", "5", "TEST_ONLY", "3–10", "Only supports the geometric ground boundary in this feasibility model."),
        row("dielectric_liner_radial_thickness", "固体绝缘衬层径向厚度", "Solid dielectric liner radial thickness", "mm", "5", "TEST_ONLY", "2–10", "Representative alumina support; no breakdown strength asserted."),
        row("gas_volume_radius", "均匀 Ne 气体半径", "Uniform Ne gas-volume radius", "mm", "45", "DERIVED", "derived", "Grounded-shell radius minus dielectric thickness."),
        row("electrode_aperture_diameter", "电极孔径", "Electrode aperture diameter", "mm", "30", "CONFIRMED_BASELINE", "fixed baseline", "Four common annular apertures."),
        row("electrode_thickness", "电极轴向厚度", "Finite electrode thickness", "mm", "3", "TEST_ONLY", "1, 2, 3, 4, 5", "Baseline thickness; CAD/COMSOL parameterized."),
        row("electrode_outer_diameter", "电极外径", "Electrode outer diameter", "mm", "80", "TEST_ONLY", "60–90", "Leaves a 10 mm radial allowance to the shell inner radius."),
        row("electrode_to_ground_radial_clearance", "电极到接地壳径向间距", "Electrode-to-ground radial clearance", "mm", "10", "DERIVED", "derived", "Includes 5 mm gas allowance plus 5 mm dielectric liner."),
        row("electrode_aperture_edge_round_radius", "孔边倒圆半径", "Aperture-edge round radius", "mm", "1", "TEST_ONLY", "0, 0.5, 1, 2", "Fillet3D baseline; zero is sharp-edge comparison."),
        row("V1_to_V2_clear_spacing", "V1–V2 清间距", "V1-to-V2 clear spacing", "mm", "130", "PRE_SCAN_DERIVED", "fine scan 10–160", "Controls initial axial guidance and V2 aperture phase."),
        row("V2_to_V3_clear_spacing", "V2–V3 清间距", "V2-to-V3 clear spacing", "mm", "220", "PRE_SCAN_DERIVED", "180–260", "Strong transport region; not yet a mechanical design value."),
        row("V3_to_V4_clear_spacing", "V3–V4 清间距", "V3-to-V4 clear spacing", "mm", "160", "PRE_SCAN_DERIVED", "120–200", "Final axial-energy adjustment region."),
        row("stage1_entrance_margin", "入口余量", "Stage-1 entrance margin", "mm", "25", "PRE_SCAN_DERIVED", "15–50", "TEST_ONLY geometry margin before V1."),
        row("stage1_exit_margin", "出口余量", "Stage-1 exit margin", "mm", "50", "PRE_SCAN_DERIVED", "30–80", "Defines the exit plane after V4."),
        row("Lstage1", "一级装置总轴向长度", "Stage-1 total axial length", "mm", "597", "DERIVED", "derived", "Lstage1 = stage1_total_length = entrance + 4t + three clear spacings + exit."),
        row("source_fraction_between_V1_V2", "源在 V1–V2 间的轴向分数", "Source fraction between V1 and V2", "1", "0.5", "CONFIRMED_BASELINE", "0.5; TEST_ONLY axial scan", "Baseline is the V1/V2 axial midpoint."),
        row("source_radial_fraction_of_gas_radius", "源径向位置占气体半径比例", "Source radial fraction of gas radius", "1", "0.50", "TEST_ONLY", "0.05–0.85", "0.80 was reduced because r_source + rL exceeded the gas radius at 1 T."),
        row("initial_total_energy", "μ− 初始总动能", "Initial total kinetic energy", "keV", "100", "CONFIRMED_BASELINE", "fixed baseline", "Initial energy is mainly transverse/radial."),
        row("initial_radial_energy", "μ− 初始径向动能", "Initial radial/transverse kinetic energy", "keV", "100", "CONFIRMED_BASELINE", "fixed baseline", "Single-muon source points inward."),
        row("initial_axial_energy", "μ− 初始轴向动能", "Initial axial kinetic energy", "eV", "0", "CONFIRMED_BASELINE", "0–100 TEST_ONLY", "Single-muon diagnostic starts with Kz≈0."),
        row("initial_tangential_fraction", "初始切向速度比例", "Initial tangential-velocity fraction", "1", "0", "TEST_ONLY", "−0.5–0.5", "Orbit-phase probe only; not a beam-divergence conclusion."),
        row("mu_target_exit_axial_energy", "出口目标轴向能量", "Target exit axial kinetic energy", "keV", "1", "REFERENCE_TARGET", "0.5–2 window", "Candidate window criterion, not a hard pass/fail."),
        row("mu_reference_exit_transverse_energy", "出口横向参考能量", "Reference exit transverse kinetic energy", "eV", "10", "REFERENCE_TARGET", "exploratory", "Do not interpret as a validated low-energy prediction."),
        row("magnetic_field_axial", "均匀轴向磁场", "Uniform axial magnetic field", "T", "1", "CONFIRMED_BASELINE", "fixed baseline", "B=(0,0,Bz), +z; no solenoid coil model."),
        row("Ne_number_density", "Ne 原子数密度", "Ne atomic number density", "1/m^3", "1e23", "SCAN_PARAMETER", "1e21, 3e21, 1e22, 3e22, 1e23; 3e23 extended", "Stopping scales linearly with density; 3e23 is an extended feasibility point."),
        row("Ne_temperature", "Ne 温度", "Ne gas temperature", "K", "300", "PHYSICS_INPUT", "fixed first version", "Pressure diagnostic only; stopping primary input is number density."),
        row("Ne_pressure", "Ne 工程压力诊断", "Ne engineering pressure diagnostic", "Pa", "414.2", "DERIVED", "derived", "Ne_pressure = n_Ne kB T; no Paschen threshold inferred."),
        row("voltage_V1", "V1 实际电势", "V1 actual electric potential", "V", "0", "PHYSICS_INPUT", "reference", "Reference potential."),
        row("voltage_difference_V1_to_V2", "V1 到 V2 电势差", "V1-to-V2 voltage difference", "V", "500", "SCAN_PARAMETER", "250–5000", "Positive ΔV accelerates μ− toward +z."),
        row("voltage_difference_V2_to_V3", "V2 到 V3 电势差", "V2-to-V3 voltage difference", "V", "2000", "SCAN_PARAMETER", "1000–10000", "Controls low-energy axial transport."),
        row("voltage_difference_V3_to_V4", "V3 到 V4 电势差", "V3-to-V4 voltage difference", "V", "−1500", "SCAN_PARAMETER", "−500 to −10000", "Negative difference is the final μ− deceleration/energy-adjustment stage."),
        row("voltage_V2", "V2 实际电势", "V2 actual electric potential", "V", "500", "DERIVED", "derived", "V2 = V1 + ΔV12."),
        row("voltage_V3", "V3 实际电势", "V3 actual electric potential", "V", "2500", "DERIVED", "derived", "V3 = V2 + ΔV23."),
        row("voltage_V4", "V4 实际电势", "V4 actual electric potential", "V", "1000", "DERIVED", "derived", "V4 = V3 + ΔV34; approximately 1 keV potential target from V1."),
        row("stopping_interface_file", "Geant4–COMSOL stopping 接口文件", "Geant4-to-COMSOL stopping interface file", "text", "comsol_muNe_SN.txt", "PHYSICS_INPUT", "fixed supplied input", "Geant4 11.3.2 option3 mean electromagnetic SN(E); no regeneration this round."),
        row("stopping_interpolation_argument", "stopping 插值自变量", "Stopping interpolation argument", "eV", "Ktotal", "PHYSICS_INPUT", "fixed", "Must use total kinetic energy, not Kperp alone."),
        row("dielectric_relative_permittivity", "代表性氧化铝相对介电常数", "Representative alumina relative permittivity", "1", "9.4", "ENGINEERING_ASSUMPTION", "8–10", "Representative permittivity only; breakdown strength intentionally not invented."),
        row("transport_survival_definition", "输运存活定义", "Transport-survival definition", "text", "reaches exit plane without wall/electrode hit", "PHYSICS_INPUT", "fixed", "Not real μ− survival probability; no atomic capture or nuclear capture."),
        row("ensemble_particle_count", "初版 ensemble 粒子数", "First-pass ensemble particle count", "1", "25", "TEST_ONLY", "100–500 next stage", "5×5 fixed grid used to keep first 3-D solve tractable; seed/grid is reproducible."),
    ]


def main() -> None:
    rows = build_rows()
    csv_path = TABLES / "parameter_reference.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    md_path = REPORTS / "PARAMETER_REFERENCE.md"
    with md_path.open("w", encoding="utf-8") as handle:
        handle.write("# Stage-1 3D parameter reference\n\n")
        handle.write("This table is generated by `scripts/build_parameter_reference.py`. "
                     "Values marked TEST_ONLY, DERIVED, PRE_SCAN_DERIVED or ENGINEERING_ASSUMPTION "
                     "are not final engineering design values.\n\n")
        handle.write("| parameter_name | Chinese_description | English_description | unit | baseline_value | parameter_type | scan_range | source_status | notes |\n")
        handle.write("|---|---|---|---|---:|---|---|---|---|\n")
        for item in rows:
            values = [item[key].replace("|", "\\|") for key in item]
            handle.write("| " + " | ".join(values) + " |\n")
        handle.write("\n## Canonical relationships\n\n")
        handle.write("- `Lstage1 = stage1_total_length = stage1_entrance_margin + 4*electrode_thickness + V1_to_V2_clear_spacing + V2_to_V3_clear_spacing + V3_to_V4_clear_spacing + stage1_exit_margin`.\n")
        handle.write("- `V2 = V1 + voltage_difference_V1_to_V2`; `V3 = V2 + voltage_difference_V2_to_V3`; `V4 = V3 + voltage_difference_V3_to_V4`.\n")
        handle.write("- `S_local = Ne_number_density * SN_muNe(Ktotal)`, where the supplied table is the Geant4 11.3.2 mean electromagnetic stopping baseline.\n")
        handle.write("- `transport_survival` means reaching the explicit exit plane without an electrode/wall hit; it is not a physical muon survival probability.\n")
    print(csv_path)
    print(md_path)


if __name__ == "__main__":
    main()
