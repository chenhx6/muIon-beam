"""Launch the reproducible Phase-B centered-source transport screening.

This is a thin orchestration layer around ``BuildCenteredStage1Model.class``:
each case gets its own COMSOL preferences/tmp directory, release file, MPH
checkpoint, metadata JSON, and stdout/stderr log.  The default list is a
small screening family; use ``--count 500`` for the formal ensemble (the
default is already 500) or ``--case`` to run one case while debugging.

The launcher does not parallelize COMSOL jobs: one particle-tracing license
and one memory footprint are kept at a time, and a failed high-field case is
recorded rather than hiding the failure behind a partially written table.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COMSOL = Path(r"C:\Program Files\COMSOL\COMSOL64\Multiphysics\bin\win64\comsolbatch.exe")
CASES = [
    # Baseline geometry and low-field transport diagnostic.
    dict(case_id="baseline_n1p0e24_dv23_2_a30", density="1e24", dv12="0.5", dv23="2.0", v4="1.0", aperture="30", gap12="130", source_z="93", wall="Freeze"),
    # Aperture-only comparison at the same field/density.
    dict(case_id="aperture60_n1p0e24_dv23_2", density="1e24", dv12="0.5", dv23="2.0", v4="1.0", aperture="60", gap12="130", source_z="93", wall="Freeze"),
    # Intermediate acceleration field.
    dict(case_id="aperture60_n1p5e24_dv23_5", density="1.5e24", dv12="0.5", dv23="5.0", v4="1.0", aperture="60", gap12="130", source_z="93", wall="Disappear"),
    # Nominal 10-kV C23 acceleration with the baseline source position.
    dict(case_id="aperture60_n1p0e24_dv23_10", density="1e24", dv12="0.5", dv23="10.0", v4="1.0", aperture="60", gap12="130", source_z="93", wall="Disappear"),
    # Short V1-V2 gap and source recentered at its midpoint.
    dict(case_id="aperture60_gap40_n1p5e24_dv23_10", density="1.5e24", dv12="0.5", dv23="10.0", v4="1.0", aperture="60", gap12="40", source_z="48", wall="Disappear"),
]


def token(value: str) -> str:
    return value.replace("+", "p").replace("-", "m").replace(".", "p")


def run_case(case: dict[str, str], count: int, seed: int, wall: str, dry_run: bool) -> int:
    case_id = case["case_id"]
    data_dir = ROOT / "data" / "centered_source"
    table_root = ROOT / "tables" / "centered" / "transport_cases" / case_id
    history_dir, field_dir = table_root / "history", table_root / "field"
    for directory in (history_dir, field_dir):
        directory.mkdir(parents=True, exist_ok=True)
    prefs = ROOT / "temporary" / ("comsol_prefs_centered_" + case_id)
    tmp = ROOT / "temporary" / ("comsol_tmp_centered_" + case_id)
    cfg = ROOT / "temporary" / ("comsol_cfg_centered_" + case_id)
    for directory in (prefs, tmp, cfg):
        directory.mkdir(parents=True, exist_ok=True)

    # Generate the release file in the component's mm position unit.  The
    # Python script's output is deterministic for a given count/seed/z.
    generator = ROOT / "scripts" / "generate_centered_release.py"
    subprocess.run([
        sys.executable, str(generator), "--count", str(count), "--seed", str(seed),
        "--source-z-mm", str(case["source_z"]), "--radius-mode", "nominal",
        "--comsol-position-unit", "mm", "--output-dir", str(data_dir),
    ], check=True)
    stem = f"centered_release_{count}_seed{seed}_z{case['source_z']}mm_nominal.txt".replace(".0mm", "mm")
    release = data_dir / stem
    stopping = ROOT.parent / "muon" / "ne" / "comsol_muNe_SN.txt"
    mph = ROOT / "comsol" / ("centered_stage1_" + case_id + ".mph")
    meta = dict(case)
    meta.update({
        "count": count, "seed": seed, "release_file": str(release),
        "stopping_file": str(stopping), "mph": str(mph),
        "table_root": str(table_root), "geometry_unit": "mm",
        "velocity_unit": "m/s", "model": "free mu-; Geant4 mean Ne stopping",
        "decay_weighting_applied": False,
    })
    (table_root / "case_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    stdout = ROOT / "intermediate" / ("centered_transport_" + case_id + "_stdout.txt")
    stderr = ROOT / "intermediate" / ("centered_transport_" + case_id + "_stderr.txt")
    args = [
        "-3drend", "sw", "-np", "1", "-nosave", "-prefsdir", str(prefs),
        "-configuration", str(cfg), "-tmpdir", str(tmp), "-inputfile",
        "BuildCenteredStage1Model.class", str(ROOT / "comsol" / "stage1_3d_feasibility.mph"),
        str(release), str(stopping), str(mph), case["density"], case["dv12"],
        case["dv23"], case["v4"], str(table_root), case["aperture"], case["gap12"],
        "-", "-", wall,
    ]
    print("CASE", case_id)
    print("COMMAND", str(COMSOL), *args)
    if dry_run:
        return 0
    with stdout.open("w", encoding="utf-8", errors="replace") as out, stderr.open("w", encoding="utf-8", errors="replace") as err:
        completed = subprocess.run([str(COMSOL), *args], cwd=str(ROOT / "scripts"), stdout=out, stderr=err)
    meta["return_code"] = completed.returncode
    meta["stdout_log"] = str(stdout)
    meta["stderr_log"] = str(stderr)
    (table_root / "case_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return completed.returncode


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", action="append", help="case_id to run; may be repeated")
    parser.add_argument("--count", type=int, default=500)
    parser.add_argument("--seed", type=int, default=20260907)
    parser.add_argument("--wall", choices=("Freeze", "Disappear"), default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    selected = CASES if not args.case else [c for c in CASES if c["case_id"] in set(args.case)]
    if args.case and not selected:
        raise SystemExit("No matching case_id; available: " + ", ".join(c["case_id"] for c in CASES))
    failures = 0
    for case in selected:
        failures += int(run_case(case, args.count, args.seed, args.wall or case["wall"], args.dry_run) != 0)
    print(json.dumps({"cases": len(selected), "failures": failures, "dry_run": args.dry_run}, indent=2))
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
