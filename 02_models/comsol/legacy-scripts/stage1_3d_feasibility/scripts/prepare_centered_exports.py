"""Assemble the canonical centered-output tables from COMSOL exports.

This postprocessor does not synthesize field values.  It only reshapes the
direct CutPlane/CutLine and Particle Evaluation files into the filenames used
by the report contract, adds explicit coordinate units, and records which
completed case supplied each row.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np

from analyze_centered_results import ROOT, TABLES, read_particle_table, reduce_transport, write_csv


def read_numeric_rows(path: Path) -> np.ndarray:
    rows: list[list[float]] = []
    if not path.exists():
        return np.empty((0, 0))
    with path.open(encoding="utf-8-sig", errors="replace") as handle:
        for line in handle:
            if line.startswith("%") or not line.strip():
                continue
            values = []
            for token in line.strip().split(","):
                try:
                    values.append(float(token))
                except ValueError:
                    values.append(np.nan)
            rows.append(values)
    if not rows:
        return np.empty((0, 0))
    width = max(len(r) for r in rows)
    out = np.full((len(rows), width), np.nan)
    for i, row in enumerate(rows):
        out[i, : len(row)] = row
    return out


def choose_root() -> Path | None:
    for name in ("transport_highfield_10_v2", "transport_highfield_10", "transport_lowfield_1e24_a60_v2", "transport_lowfield_1e24_a60", "transport_highfield_smoke"):
        root = TABLES / name
        if (root / "field" / "field_global_xz.csv").exists():
            return root
    for path in sorted(TABLES.rglob("field_global_xz.csv")):
        return path.parent.parent
    return None


def field_rows(root: Path) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    path = root / "field" / "field_global_xz.csv"
    a = read_numeric_rows(path)
    rows, potential = [], []
    if a.size == 0 or a.shape[1] < 13:
        return rows, potential
    for r in a:
        x, y, z = r[0], r[1], r[2]
        # Coordinate block + requested x,y,z,V,Ex,Ey,Ez,E,Eperp,U.
        item = {
            "source_case": root.name, "plane": "y=0_xz", "x_mm": x, "y_mm": y, "z_mm": z,
            "V_V": r[6], "Ex_V_per_m": r[7], "Ey_V_per_m": r[8], "Ez_V_per_m": r[9],
            "E_V_per_m": r[10], "Eperp_V_per_m": r[11], "U_mu_eV": r[12],
        }
        rows.append(item); potential.append({"source_case": root.name, "plane": "y=0_xz", "x_mm": x, "y_mm": y, "z_mm": z, "V_V": r[6], "U_mu_eV": r[12]})
    ypath = root / "field" / "field_global_yz.csv"
    b = read_numeric_rows(ypath)
    if b.size and b.shape[1] >= 13:
        for r in b:
            rows.append({"source_case": root.name, "plane": "x=0_yz", "x_mm": r[0], "y_mm": r[1], "z_mm": r[2], "V_V": r[6], "Ex_V_per_m": r[7], "Ey_V_per_m": r[8], "Ez_V_per_m": r[9], "E_V_per_m": r[10], "Eperp_V_per_m": r[11], "U_mu_eV": r[12]})
            potential.append({"source_case": root.name, "plane": "x=0_yz", "x_mm": r[0], "y_mm": r[1], "z_mm": r[2], "V_V": r[6], "U_mu_eV": r[12]})
    return rows, potential


def main() -> None:
    root = choose_root()
    if root is None:
        print("No completed centered field export found")
        return
    rows, potential = field_rows(root)
    write_csv(TABLES / "field_global_planes.csv", rows)
    write_csv(TABLES / "potential_global_planes.csv", potential)
    # Region definitions are expressed in actual Stage-1 z coordinates.
    regions = {"C0": (0, 25), "C12": (28, 158), "C23": (161, 381), "C34": (384, 544), "C4": (547, 597)}
    cavity = []
    for row in rows:
        z = float(row["z_mm"])
        for name, (za, zb) in regions.items():
            if za <= z <= zb:
                item = dict(row); item["cavity"] = name; item["Ne_density_m^-3"] = 1e24; item["E_over_N_Td"] = float(row["E_V_per_m"]) / 1e24 * 1e21; cavity.append(item); break
    write_csv(TABLES / "field_cavity_slices.csv", cavity)
    aperture = []
    for row in rows:
        if row["plane"] != "y=0_xz": continue
        z = float(row["z_mm"]); rho = abs(float(row["x_mm"]))
        for i, z0 in enumerate((26.5, 159.5, 382.5, 545.5), 1):
            if abs(z - z0) <= 5.0 and 10.0 <= rho <= 25.0:
                item = dict(row); item["electrode"] = f"V{i}"; item["rho_mm"] = rho; aperture.append(item); break
    write_csv(TABLES / "field_aperture_zoom.csv", aperture)

    # Long-form particle field history.  Keep every tenth output time and all
    # 500 particles when available; this is sufficient for percentiles and
    # makes the report table portable (~50k rows instead of millions).
    transport = TABLES / "transport_lowfield_1e24_a60_v2"
    if not (transport / "history" / "E_total_local_history.csv").exists():
        transport = TABLES / "transport_highfield_10_v2"
    if (transport / "history" / "E_total_local_history.csv").exists():
        names = ["E_total_local_history.csv", "E_radial_local_history.csv", "P_E_history.csv", "Kperp_eV_history.csv", "Ktotal_eV_history.csv", "U_mu_eV_history.csv", "qz_history.csv"]
        loaded = {}
        for name in names:
            try: loaded[name] = read_particle_table(transport / "history" / name)
            except (OSError, ValueError): pass
        if loaded:
            t = next(iter(loaded.values()))[0]
            n = min(v[1].shape[1] for v in loaded.values())
            history = []
            for i in range(0, len(t), 10):
                for j in range(n):
                    history.append({
                        "source_case": transport.name, "particle_id": j + 1, "time_ns": t[i] * 1e9,
                        "z_mm": loaded["qz_history.csv"][1][i, j] if "qz_history.csv" in loaded else np.nan,
                        "E_V_per_m": loaded["E_total_local_history.csv"][1][i, j] if "E_total_local_history.csv" in loaded else np.nan,
                        "E_radial_V_per_m": loaded["E_radial_local_history.csv"][1][i, j] if "E_radial_local_history.csv" in loaded else np.nan,
                        "P_E_W": loaded["P_E_history.csv"][1][i, j] if "P_E_history.csv" in loaded else np.nan,
                        "Kperp_eV": loaded["Kperp_eV_history.csv"][1][i, j] if "Kperp_eV_history.csv" in loaded else np.nan,
                        "Ktotal_eV": loaded["Ktotal_eV_history.csv"][1][i, j] if "Ktotal_eV_history.csv" in loaded else np.nan,
                        "U_mu_eV": loaded["U_mu_eV_history.csv"][1][i, j] if "U_mu_eV_history.csv" in loaded else np.nan,
                    })
            write_csv(TABLES / "particle_field_history.csv", history)
    # A compact field summary suitable for the markdown report.
    field_summary = []
    for name in ("field_summary_comsol.csv",):
        a = read_numeric_rows(root / "field" / name)
        if a.size:
            field_summary.append({"source_case": root.name, "max_E_total_V_per_m": a[0, 0], "max_E_in_Ne_V_per_m": a[0, 1], "max_E_at_aperture_V_per_m": a[0, 2], "average_E_V1_V2_V_per_m": a[0, 3], "average_E_V2_V3_V_per_m": a[0, 4], "average_E_V3_V4_V_per_m": a[0, 5], "Ne_density_m^-3": 1e24, "max_E_over_N_Td": a[0, 1] / 1e24 * 1e21})
    write_csv(TABLES / "field_summary.csv", field_summary)
    print(json.dumps({"field_root": str(root), "global_rows": len(rows), "cavity_rows": len(cavity), "aperture_rows": len(aperture)}, indent=2))


if __name__ == "__main__":
    main()
