"""Reduce COMSOL Stage-1 3-D single-muon cases into formal tables.

The COMSOL CSV exports contain metadata/comment rows followed by one particle
time series.  This reducer deliberately treats a particle as transmitted only
when the exit-plane flag is reached.  Frozen wall/electrode values are retained
as loss diagnostics and are never relabeled as Kz_exit or Kperp_exit.
"""

from __future__ import annotations

import csv
import math
import re
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CASE_DIRS = [
    ROOT / "intermediate" / "results" / "single_sweep_cases",
    ROOT / "intermediate" / "results" / "refine_cases",
    ROOT / "intermediate" / "results" / "phase_refine_cases",
    ROOT / "intermediate" / "results" / "fine_acceptance_cases",
    ROOT / "intermediate" / "results" / "velocity_phase_cases",
    ROOT / "intermediate" / "results" / "aperture_phase_fine_cases",
    ROOT / "intermediate" / "results" / "transport_bridge_cases",
    ROOT / "intermediate" / "results" / "short_gap_bridge_cases",
    ROOT / "intermediate" / "results" / "axial_source_cases",
]
TABLE_DIR = ROOT / "tables"
TABLE_DIR.mkdir(parents=True, exist_ok=True)

K_B = 1.380649e-23
NE_TEMPERATURE_K = 300.0
MU_INITIAL_E = 100_000.0
EXIT_KZ_LOW_E = 500.0
EXIT_KZ_HIGH_E = 2_000.0


@dataclass(frozen=True)
class Parameters:
    density: float
    source_fraction: float
    dv12_kv: float
    dv23_kv: float
    dv34_kv: float
    gap12_mm: float = 130.0
    gap23_mm: float = 220.0
    gap34_mm: float = 160.0
    tangential_fraction: float = 0.0
    axial_source_fraction: float = 0.5

    @property
    def V1_kV(self) -> float:
        return 0.0

    @property
    def V2_kV(self) -> float:
        return self.dv12_kv

    @property
    def V3_kV(self) -> float:
        return self.dv12_kv + self.dv23_kv

    @property
    def V4_kV(self) -> float:
        return self.V3_kV + self.dv34_kv

    @property
    def Lstage1_mm(self) -> float:
        return 25.0 + 4.0 * 3.0 + self.gap12_mm + self.gap23_mm + self.gap34_mm + 50.0

    @property
    def pressure_pa(self) -> float:
        return self.density * K_B * NE_TEMPERATURE_K


DEFAULT = Parameters(1e23, 0.50, 0.5, 2.0, -1.5)


def case_parameters(name: str) -> Parameters:
    if name.startswith("density_"):
        density = {
            "density_1e22": 1e22,
            "density_3e22": 3e22,
            "density_1e23": 1e23,
            "density_3e23_extended": 3e23,
        }[name]
        return Parameters(density, 0.50, 0.5, 2.0, -1.5)
    if name.startswith("source_"):
        fraction = {"source_0p30_n3e23": 0.30, "source_0p40_n3e23": 0.40,
                    "source_0p50_n3e23": 0.50}[name]
        return Parameters(3e23, fraction, 0.5, 2.0, -1.5)
    if name.startswith("V12_"):
        dv12 = {"V12_0p25kV_n3e23": 0.25, "V12_0p50kV_n3e23": 0.50,
                "V12_1p00kV_n3e23": 1.00}[name]
        return Parameters(3e23, 0.40, dv12, 2.0, 1.0 - (dv12 + 2.0))
    if name.startswith("V23_"):
        dv23 = {"V23_1p0kV_n3e23": 1.0, "V23_2p0kV_n3e23": 2.0,
                "V23_3p0kV_n3e23": 3.0}[name]
        return Parameters(3e23, 0.40, 0.5, dv23, 1.0 - (0.5 + dv23))
    if name.startswith("V34_"):
        dv34 = {"V34_minus0p5kV_n3e23": -0.5, "V34_minus1p0kV_n3e23": -1.0,
                "V34_minus1p5kV_n3e23": -1.5, "V34_minus2p0kV_n3e23": -2.0}[name]
        return Parameters(3e23, 0.40, 0.5, 2.0, dv34)
    if name.startswith("spacing_"):
        parts = name.removeprefix("spacing_").removesuffix("_n3e23").split("_")
        return Parameters(3e23, 0.40, 0.5, 2.0, -1.5,
                          float(parts[0]), float(parts[1]), float(parts[2]))
    if name.startswith("refine_source_"):
        fraction = float(name.removeprefix("refine_source_").replace("p", "."))
        return Parameters(3e23, fraction, 0.5, 2.0, -1.5)
    if name.startswith("refine_V12_"):
        dv12 = float(name.removeprefix("refine_V12_").removesuffix("kV").replace("p", "."))
        return Parameters(3e23, 0.20, dv12, 2.0, -1.0 - dv12)
    if name.startswith("refine_gap12_"):
        gap12 = float(name.removeprefix("refine_gap12_").removesuffix("mm"))
        return Parameters(3e23, 0.20, 1.0, 2.0, -2.0, gap12, 220.0, 160.0)
    if name.startswith("phase_source0p10_t"):
        suffix = name.removeprefix("phase_source0p10_t")
        tangent = {"minus0p15": -0.15, "minus0p10": -0.10, "minus0p05": -0.05,
                   "zero": 0.0, "plus0p05": 0.05, "plus0p10": 0.10,
                   "plus0p15": 0.15}[suffix]
        return Parameters(3e23, 0.10, 0.5, 2.0, -1.5,
                          tangential_fraction=tangent)
    if name.startswith("phase_source0p") and name.endswith("_tzero"):
        fraction = name.removeprefix("phase_source").removesuffix("_tzero")
        return Parameters(3e23, float(fraction.replace("p", ".")), 0.5, 2.0, -1.5)
    if name.startswith("phase_source0p10_gap"):
        gap12 = float(name.removeprefix("phase_source0p10_gap").removesuffix("mm"))
        return Parameters(3e23, 0.10, 0.5, 2.0, -1.5, gap12, 220.0, 160.0)
    if name.startswith("fine_source_"):
        fraction = float(name.removeprefix("fine_source_").replace("p", "."))
        return Parameters(3e23, fraction, 0.5, 2.0, -1.5)
    if name.startswith("fine_gap12_"):
        gap12 = float(name.removeprefix("fine_gap12_").removesuffix("mm"))
        return Parameters(3e23, 0.10, 0.5, 2.0, -1.5, gap12, 220.0, 160.0)
    if name.startswith("phase_f0p10_t"):
        suffix = name.removeprefix("phase_f0p10_t")
        tangent = {"minus0p50": -0.50, "minus0p40": -0.40, "minus0p30": -0.30,
                   "minus0p20": -0.20, "minus0p10": -0.10, "0": 0.0,
                   "0p10": 0.10, "0p20": 0.20, "0p30": 0.30,
                   "0p40": 0.40, "0p50": 0.50}[suffix]
        return Parameters(3e23, 0.10, 0.5, 2.0, -1.5,
                          tangential_fraction=tangent)
    if name.startswith("phase_f0p10_n"):
        density = {"phase_f0p10_n1e22": 1e22, "phase_f0p10_n3e22": 3e22,
                   "phase_f0p10_n1e23": 1e23}[name]
        return Parameters(density, 0.10, 0.5, 2.0, -1.5)
    if name.startswith("fine2_gap12_"):
        gap12 = float(name.removeprefix("fine2_gap12_").removesuffix("mm").replace("p", "."))
        return Parameters(3e23, 0.10, 0.5, 2.0, -1.5, gap12, 220.0, 160.0)
    if name.startswith("axial_source_gap"):
        match = re.match(r"axial_source_gap(?P<gap>\d+)mm_frac(?P<fraction>0p\d+)$", name)
        if match is None:
            raise KeyError(f"unknown axial-source case format: {name}")
        gap12 = float(match.group("gap"))
        axial_fraction = float(match.group("fraction").replace("p", "."))
        return Parameters(3e23, 0.10, 5.0, 5.0, -9.0,
                          gap12, 220.0, 160.0,
                          axial_source_fraction=axial_fraction)
    if name.startswith("bridge_gap"):
        match = re.match(r"bridge_gap(?P<gap>\d+p\d+)(?P<qual>.*?)_V23_(?P<v23>\d+)kV$", name)
        if match is None:
            raise KeyError(f"unknown bridge case format: {name}")
        gap12 = float(match.group("gap").replace("p", "."))
        dv23 = float(match.group("v23"))
        tail = match.group("qual")
        density = 3e23
        fraction = 0.10
        dv12 = 0.5
        if "source0p05" in tail:
            fraction = 0.05
        elif "source0p075" in tail:
            fraction = 0.075
        if "n1e23" in tail:
            density = 1e23
        if "V12_1kV" in tail:
            dv12 = 1.0
        elif "V12_2kV" in tail:
            dv12 = 2.0
        return Parameters(density, fraction, dv12, dv23, 1.0 - dv12 - dv23,
                          gap12, 220.0, 160.0)
    if name.startswith("shortgap_"):
        match = re.match(
            r"shortgap_(?P<gap>\d+)mm_f(?P<fraction>0p05|0p10)_V12_(?P<dv12>\d+)kV$",
            name,
        )
        if match is None:
            raise KeyError(f"unknown short-gap case format: {name}")
        gap12 = float(match.group("gap"))
        fraction = float(match.group("fraction").replace("p", "."))
        dv12 = float(match.group("dv12"))
        return Parameters(3e23, fraction, dv12, 5.0, 1.0 - dv12 - 5.0,
                          gap12, 220.0, 160.0)
    raise KeyError(f"no parameter map for case {name}")


def find_case_file(name: str, suffix: str) -> Path:
    for case_dir in CASE_DIRS:
        candidate = case_dir / f"{name}{suffix}"
        if candidate.exists():
            return candidate
    return CASE_DIRS[0] / f"{name}{suffix}"


def read_numeric_rows(path: Path) -> list[list[float]]:
    rows: list[list[float]] = []
    with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("%"):
                continue
            fields = line.split(",")
            try:
                rows.append([float(field) for field in fields])
            except ValueError:
                continue
    return rows


def read_field(path: Path) -> list[float]:
    rows = read_numeric_rows(path)
    if not rows:
        raise ValueError(f"no numeric field row in {path}")
    return rows[0]


def summarize_case(name: str) -> dict[str, object]:
    params = case_parameters(name)
    series_path = find_case_file(name, "_timeseries.csv")
    field_path = find_case_file(name, "_field.csv")
    if not series_path.exists():
        return {"parameter_set_id": name, "model_status": "FAILED_NO_TIMESERIES"}

    rows = read_numeric_rows(series_path)
    if not rows or any(len(row) < 18 for row in rows):
        return {"parameter_set_id": name, "model_status": "FAILED_BAD_TIMESERIES"}
    exit_rows = [row for row in rows if row[14] > 0.5]
    flagged_rows = [row for row in rows if max(row[14:18]) > 0.5]
    loss_event = flagged_rows[0] if flagged_rows else rows[-1]
    transmission = 1.0 if exit_rows else 0.0
    final = exit_rows[0] if exit_rows else rows[-1]
    loss_rows = rows if not exit_rows else exit_rows
    max_electrode = max(row[16] for row in rows) > 0.5
    max_wall = max(row[15] for row in rows) > 0.5
    max_backward = max(row[17] for row in rows) > 0.5
    if transmission:
        loss_location = "exit_plane"
        transit_time = final[0]
        kperp_exit = final[7]
        kz_exit = final[8]
        ktotal_exit = final[9]
    elif max_electrode:
        loss_location = "electrode_or_aperture_edge"
        transit_time = math.nan
        kperp_exit = math.nan
        kz_exit = math.nan
        ktotal_exit = math.nan
    elif max_wall:
        loss_location = "dielectric_or_grounded_wall"
        transit_time = math.nan
        kperp_exit = math.nan
        kz_exit = math.nan
        ktotal_exit = math.nan
    elif max_backward:
        loss_location = "backward_plane"
        transit_time = math.nan
        kperp_exit = math.nan
        kz_exit = math.nan
        ktotal_exit = math.nan
    else:
        loss_location = "timeout_or_unclassified"
        transit_time = math.nan
        kperp_exit = math.nan
        kz_exit = math.nan
        ktotal_exit = math.nan

    field = read_field(field_path) if field_path.exists() else [math.nan] * 8
    max_e_total, max_e_ne, max_e_diel, max_e_ap, max_e_tj = field[:5]
    avg12, avg23, avg34 = field[5:8]
    candidate = bool(
        transmission
        and EXIT_KZ_LOW_E < kz_exit < EXIT_KZ_HIGH_E
        and kperp_exit < MU_INITIAL_E
    )
    note = (
        "HV_RISK_SCREENING only; no Ne Paschen or dielectric flashover proof. "
        "5e6 V/m is a reference field scale, not a breakdown threshold."
    )
    return {
        "parameter_set_id": name,
        "geometry_id": "baseline_spacing" if params == DEFAULT else "spacing_variant",
        "Ne_number_density": params.density,
        "Ne_temperature": NE_TEMPERATURE_K,
        "Ne_pressure": params.pressure_pa,
        "V1": params.V1_kV * 1e3,
        "V2": params.V2_kV * 1e3,
        "V3": params.V3_kV * 1e3,
        "V4": params.V4_kV * 1e3,
        "voltage_difference_V1_to_V2": params.dv12_kv * 1e3,
        "voltage_difference_V2_to_V3": params.dv23_kv * 1e3,
        "voltage_difference_V3_to_V4": params.dv34_kv * 1e3,
        "V1_to_V2_clear_spacing": params.gap12_mm / 1000.0,
        "V2_to_V3_clear_spacing": params.gap23_mm / 1000.0,
        "V3_to_V4_clear_spacing": params.gap34_mm / 1000.0,
        "Lstage1": params.Lstage1_mm / 1000.0,
        "magnetic_field_axial": 1.0,
        "source_radial_fraction_of_gas_radius": params.source_fraction,
        "source_fraction_between_V1_V2": params.axial_source_fraction,
        "initial_tangential_fraction": params.tangential_fraction,
        "transmission_fraction": transmission,
        "mean_Kperp_exit": kperp_exit,
        "mean_Kz_exit": kz_exit,
        "mean_Ktotal_exit": ktotal_exit,
        "mean_transit_time": transit_time,
        "max_E_in_Ne": max_e_ne,
        "max_E_total": max_e_total,
        "max_E_at_aperture": max_e_ap,
        "max_E_in_dielectric": max_e_diel,
        "max_E_at_triple_junction": max_e_tj,
        "average_E_V1_V2": avg12,
        "average_E_V2_V3": avg23,
        "average_E_V3_V4": avg34,
        "loss_location": loss_location,
        "loss_event_time": loss_event[0],
        "loss_event_x": loss_event[1],
        "loss_event_y": loss_event[2],
        "loss_event_z": loss_event[3],
        "loss_event_radial_position": loss_event[10],
        "loss_event_Kperp": loss_event[7],
        "loss_event_Kz": loss_event[8],
        "loss_event_Ktotal": loss_event[9],
        "candidate_feasibility_window": int(candidate),
        "HV_risk_notes": note,
        "model_status": "SUCCESS_EXIT" if transmission else "SUCCESS_LOSS_DIAGNOSTIC",
    }


def write_csv(path: Path, rows: list[dict[str, object]], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fields})


def main() -> None:
    names = sorted({
        p.name.removesuffix("_timeseries.csv")
        for case_dir in CASE_DIRS
        for p in case_dir.glob("*_timeseries.csv")
    })
    rows = [summarize_case(name) for name in names]
    master_fields = [
        "parameter_set_id", "geometry_id", "Ne_number_density", "Ne_temperature", "Ne_pressure",
        "V1", "V2", "V3", "V4", "voltage_difference_V1_to_V2",
        "voltage_difference_V2_to_V3", "voltage_difference_V3_to_V4",
        "V1_to_V2_clear_spacing", "V2_to_V3_clear_spacing", "V3_to_V4_clear_spacing", "Lstage1",
        "magnetic_field_axial", "source_radial_fraction_of_gas_radius", "transmission_fraction",
        "source_fraction_between_V1_V2",
        "initial_tangential_fraction",
        "mean_Kperp_exit", "mean_Kz_exit", "mean_Ktotal_exit", "mean_transit_time",
        "loss_event_time", "loss_event_x", "loss_event_y", "loss_event_z",
        "loss_event_radial_position", "loss_event_Kperp", "loss_event_Kz", "loss_event_Ktotal",
        "max_E_in_Ne", "max_E_total", "max_E_at_aperture", "max_E_in_dielectric",
        "max_E_at_triple_junction", "average_E_V1_V2", "average_E_V2_V3", "average_E_V3_V4",
        "loss_location", "candidate_feasibility_window", "HV_risk_notes", "model_status",
    ]
    write_csv(TABLE_DIR / "parameter_scan_master.csv", rows, master_fields)

    candidates = [row for row in rows if row.get("candidate_feasibility_window") == 1]
    write_csv(TABLE_DIR / "candidate_parameter_sets.csv", candidates, master_fields)

    baseline = next((row for row in rows if row.get("parameter_set_id") == "density_1e23"), None)
    if baseline is None:
        baseline = summarize_case("density_1e23")
    write_csv(TABLE_DIR / "baseline_result.csv", [baseline], master_fields)

    risk_fields = [
        "parameter_set_id", "Ne_number_density", "Ne_pressure", "V1", "V2", "V3", "V4",
        "V1_to_V2_clear_spacing", "V2_to_V3_clear_spacing", "V3_to_V4_clear_spacing",
        "average_E_V1_V2", "average_E_V2_V3", "average_E_V3_V4", "max_E_in_Ne",
        "max_E_at_aperture", "max_E_in_dielectric", "max_E_at_triple_junction",
        "max_E_total", "HV_risk_notes",
    ]
    write_csv(TABLE_DIR / "electric_field_risk_summary.csv", rows, risk_fields)

    loss_fields = [
        "parameter_set_id", "loss_location", "loss_event_time", "loss_event_x",
        "loss_event_y", "loss_event_z", "loss_event_radial_position",
        "loss_event_Kperp", "loss_event_Kz", "loss_event_Ktotal",
        "Ne_number_density", "source_radial_fraction_of_gas_radius", "source_fraction_between_V1_V2",
        "initial_tangential_fraction",
        "V1", "V2", "V3", "V4", "Lstage1", "model_status",
    ]
    write_csv(ROOT / "intermediate/results/single_sweep_loss_diagnostics.csv", rows, loss_fields)

    print(f"cases={len(rows)} candidates={len(candidates)}")
    print(f"master={TABLE_DIR / 'parameter_scan_master.csv'}")
    print(f"candidates={TABLE_DIR / 'candidate_parameter_sets.csv'}")


if __name__ == "__main__":
    main()
