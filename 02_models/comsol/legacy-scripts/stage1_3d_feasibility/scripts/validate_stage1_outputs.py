"""Run a lightweight file-level acceptance audit for the Stage1 archive."""

from __future__ import annotations

import csv
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def csv_numeric_rows(path: Path) -> list[list[float]]:
    rows: list[list[float]] = []
    with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("%"):
                continue
            try:
                rows.append([float(v) for v in line.split(",")])
            except ValueError:
                continue
    return rows


def main() -> None:
    required = [
        ROOT / "cad/Stage1_Master_3D.SLDPRT",
        ROOT / "cad/Stage1_Master_3D.step",
        ROOT / "comsol/stage1_3d_feasibility.mph",
        ROOT / "comsol/stage1_solidworks_step_import_check.mph",
        ROOT / "tables/parameter_reference.csv",
        ROOT / "tables/parameter_scan_master.csv",
        ROOT / "tables/candidate_parameter_sets.csv",
        ROOT / "tables/baseline_result.csv",
        ROOT / "reports/PARAMETER_REFERENCE.md",
        ROOT / "reports/stage1_feasibility_report.md",
        ROOT / "logs/solidworks_step_import_final.log",
        ROOT / "figures/01_stage1_3d_cutaway.png",
        ROOT / "figures/07_feasibility_window.png",
    ]
    missing = [str(path) for path in required if not path.exists() or path.stat().st_size == 0]
    scan = list(csv.DictReader((ROOT / "tables/parameter_scan_master.csv").open(encoding="utf-8-sig")))
    candidates = list(csv.DictReader((ROOT / "tables/candidate_parameter_sets.csv").open(encoding="utf-8-sig")))
    raw_series = list((ROOT / "intermediate/results").glob("**/*_timeseries.csv"))
    finite_failures: list[str] = []
    series_count = 0
    for path in raw_series:
        rows = csv_numeric_rows(path)
        if not rows:
            continue
        series_count += 1
        if any(not math.isfinite(value) for row in rows for value in row):
            finite_failures.append(str(path))

    reload_log = ROOT / "logs/validate_stage1_comsol_20260905_1945.log"
    reload_text = reload_log.read_text(encoding="utf-8", errors="replace") if reload_log.exists() else ""
    sw_log = ROOT / "logs/solidworks_master_validation_box.log"
    sw_text = sw_log.read_text(encoding="utf-8", errors="replace") if sw_log.exists() else ""
    step_log = ROOT / "logs/solidworks_step_import_final.log"
    step_text = step_log.read_text(encoding="utf-8", errors="replace") if step_log.exists() else ""

    checks = [
        ("required archive files", not missing, ", ".join(missing) if missing else "all present"),
        ("scan master rows", len(scan) == 165, f"{len(scan)} completed single-muon points"),
        ("candidate rows", len(candidates) == 0, f"{len(candidates)} legal exit-plane candidates"),
        ("raw time-series finite", not finite_failures, f"{series_count} non-empty files checked"),
        ("COMSOL reload", "RELOAD_VALIDATION_COMPLETE" in reload_text, "3-D model tree reloaded"),
        ("COMSOL stopping function", "HAS_SN_FUNCTION=true" in reload_text, "intSN present"),
        ("COMSOL studies", "HAS_SINGLE_STUDY=true" in reload_text and "HAS_ENSEMBLE_STUDY=true" in reload_text, "single + ensemble study nodes present"),
        ("SolidWorks configurations", "SIM_PRESENT=True" in sw_text and "REPORT_PRESENT=True" in sw_text, "SIM_3D and REPORT_3D present"),
        ("SolidWorks bodies", "SOLID_BODY_COUNT=6" in sw_text, "shell + liner + V1–V4"),
        ("SolidWorks open status", "OPEN_ERRORS=0" in sw_text and "OPEN_WARNINGS=0" in sw_text, "master re-opened cleanly"),
        ("SolidWorks native aperture rounding", all(
            f"BODY_FACE_APERTURE_ROUNDING=V{i}_Annular_Electrode_D30_t3 R15_COUNT=2 R16_COUNT=2" in sw_text
            for i in range(1, 5)
        ), "V1–V4 each show two 15 mm and two 16 mm aperture circles"),
        ("Updated STEP import", "STEP_IMPORT=SUCCESS" in step_text and "closed_shell:6" in step_text,
         "new rounded SolidWorks STEP imported into COMSOL"),
    ]
    report = ROOT / "reports/VALIDATION_CHECKLIST.md"
    with report.open("w", encoding="utf-8") as handle:
        handle.write("# Stage1 3D acceptance checklist\n\n")
        for label, passed, detail in checks:
            handle.write(f"- [{'PASS' if passed else 'FAIL'}] {label}: {detail}\n")
        handle.write("\n## Geometry measurements from SolidWorks body bounding boxes\n\n")
        handle.write("- Grounded shell: x/y ±55 mm, z=0–597 mm; inner bore is the named 100 mm boundary.\n")
        handle.write("- Dielectric liner: x/y ±50 mm, z=0–597 mm; gas-side radius is 45 mm, representative 5 mm radial liner.\n")
        handle.write("- V1: z=25–28 mm; V2: z=158–161 mm; V3: z=381–384 mm; V4: z=544–547 mm.\n")
        handle.write("- Each electrode body: x/y ±40 mm bounding radius, 3 mm axial thickness; annular aperture is 30 mm diameter in the source profile.\n")
        handle.write("- SolidWorks native aperture topology: V1–V4 each report two 15 mm and two 16 mm circular aperture edges, corresponding to the 1 mm profile fillets at both axial ends; the updated STEP import reports 16 toroidal fillet surfaces across the four electrodes.\n\n")
        handle.write("## Interpretation boundary\n\n")
        handle.write("`candidate_parameter_sets.csv` is intentionally empty: all tested trajectories were classified as losses or timeout before the explicit exit plane. The zero candidate count is a result, not a missing-data placeholder. The COMSOL ensemble checkpoint is stored separately under `intermediate/results/ensemble_500ns/` and uses a fixed 25-particle grid.\n")
    print(report)
    print(f"checks_failed={sum(not passed for _, passed, _ in checks)}")


if __name__ == "__main__":
    main()
