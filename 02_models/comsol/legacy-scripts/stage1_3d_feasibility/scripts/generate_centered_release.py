"""Generate a reproducible 3-D centered-Larmor-source ensemble.

The COMSOL ReleaseFromDataFile node reads the first three columns as position
and the next three columns as velocity.  A companion CSV retains the random
draws and derived quantities used to make the release file auditable.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from pathlib import Path


M_MU = 1.8835315557426432e-28  # kg
E_CHARGE = 1.602176634e-19  # C = J/eV
B0 = 1.0  # T
K_MEAN_EV = 100_000.0
K_SIGMA_EV = 5_000.0
ANGLE_SIGMA_DEG = 9.0
K_MIN_EV = 85_000.0
K_MAX_EV = 115_000.0


def normal(rng: random.Random) -> float:
    """A deterministic standard normal draw independent of gauss cache state."""
    u1 = 0.0
    while u1 <= 0.0:
        u1 = rng.random()
    u2 = rng.random()
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def truncated_energy(rng: random.Random) -> float:
    while True:
        value = K_MEAN_EV + K_SIGMA_EV * normal(rng)
        if K_MIN_EV <= value <= K_MAX_EV:
            return value


def centered_particle(
    rng: random.Random,
    source_z_m: float,
    radius_mode: str,
) -> dict[str, float]:
    k_ev = truncated_energy(rng)
    k_j = k_ev * E_CHARGE
    speed = math.sqrt(2.0 * k_j / M_MU)
    r_larmor = M_MU * speed / (E_CHARGE * B0)
    r_source = r_larmor if radius_mode == "energy-matched" else (
        M_MU * math.sqrt(2.0 * K_MEAN_EV * E_CHARGE / M_MU) / (E_CHARGE * B0)
    )

    phi = 2.0 * math.pi * rng.random()
    e_r = (math.cos(phi), math.sin(phi), 0.0)
    e_phi = (-math.sin(phi), math.cos(phi), 0.0)

    sigma_component = math.radians(ANGLE_SIGMA_DEG) / math.sqrt(2.0)
    cutoff = math.radians(3.0 * ANGLE_SIGMA_DEG)
    while True:
        a = sigma_component * normal(rng)
        b = sigma_component * normal(rng)
        theta = math.hypot(a, b)
        if theta <= cutoff:
            break
    psi = math.atan2(b, a)
    direction = (
        math.cos(theta) * e_phi[0]
        + math.sin(theta) * (math.cos(psi) * e_r[0]),
        math.cos(theta) * e_phi[1]
        + math.sin(theta) * (math.cos(psi) * e_r[1]),
        math.sin(theta) * math.sin(psi),
    )

    x = r_source * e_r[0]
    y = r_source * e_r[1]
    vx, vy, vz = (speed * component for component in direction)

    # For q=-e and B=+z, the nominal +phi launch has its guiding center at
    # the axis.  The following is the corresponding analytic guiding-center
    # estimate, retained as a diagnostic for the perturbed ensemble.
    # r_gc = r + (m/(q B)) (v x B) in Cartesian form.
    q = -E_CHARGE
    gc_x = x + M_MU / (q * B0) * (vy * B0)
    gc_y = y + M_MU / (q * B0) * (-vx * B0)
    gc_r = math.hypot(gc_x, gc_y)

    return {
        "x_m": x,
        "y_m": y,
        "z_m": source_z_m,
        "vx_m_per_s": vx,
        "vy_m_per_s": vy,
        "vz_m_per_s": vz,
        "K0_eV": k_ev,
        "speed_m_per_s": speed,
        "r_larmor_m": r_larmor,
        "r_source_m": r_source,
        "phi0_rad": phi,
        "theta_rad": theta,
        "theta_deg": math.degrees(theta),
        "angle_component_1_deg": math.degrees(a),
        "angle_component_2_deg": math.degrees(b),
        "guiding_center_x_m": gc_x,
        "guiding_center_y_m": gc_y,
        "guiding_center_r_m": gc_r,
    }


def generate(count: int, seed: int, source_z_m: float, radius_mode: str) -> list[dict[str, float]]:
    rng = random.Random(seed)
    rows: list[dict[str, float]] = []
    for particle_id in range(1, count + 1):
        row = centered_particle(rng, source_z_m, radius_mode)
        row["particle_id"] = particle_id
        rows.append(row)
    return rows


def write_outputs(rows: list[dict[str, float]], txt_path: Path, csv_path: Path, summary_path: Path,
                  seed: int, source_z_m: float, radius_mode: str,
                  comsol_position_unit: str = "mm") -> None:
    txt_path.parent.mkdir(parents=True, exist_ok=True)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.parent.mkdir(parents=True, exist_ok=True)

    with txt_path.open("w", encoding="ascii", newline="\n") as handle:
        handle.write("% Centered Larmor source for COMSOL ReleaseFromDataFile\n")
        # ReleaseFromDataFile interprets position columns in the component's
        # geometry unit.  The Stage-1 component is explicitly in mm, whereas
        # particle velocities remain SI (m/s).  Writing SI positions here
        # would silently place a 15.3-mm source at 0.0153 mm and a 93-mm
        # source at 0.093 mm.  Keep the companion CSV in SI for auditability,
        # but emit the COMSOL input in the declared model unit.
        if comsol_position_unit == "mm":
            handle.write("% columns: x[mm] y[mm] z[mm] vx[m/s] vy[m/s] vz[m/s]\n")
            position_scale = 1000.0
        else:
            handle.write("% columns: x[m] y[m] z[m] vx[m/s] vy[m/s] vz[m/s]\n")
            position_scale = 1.0
        handle.write("% q=-e, Bz=+1 T, nominal K=100 keV, direction sigma=9 deg\n")
        handle.write("% COMSOL ReleaseFromDataFile position unit: " + comsol_position_unit + "\n")
        for row in rows:
            handle.write(" ".join(
                f"{(row[key] * position_scale if key.endswith('_m') else row[key]):.16e}"
                for key in ("x_m", "y_m", "z_m", "vx_m_per_s", "vy_m_per_s", "vz_m_per_s")
            ) + "\n")

    fields = [
        "particle_id", "x_m", "y_m", "z_m", "vx_m_per_s", "vy_m_per_s", "vz_m_per_s",
        "K0_eV", "speed_m_per_s", "r_larmor_m", "r_source_m", "phi0_rad", "theta_rad",
        "theta_deg", "angle_component_1_deg", "angle_component_2_deg",
        "guiding_center_x_m", "guiding_center_y_m", "guiding_center_r_m",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows({key: row[key] for key in fields} for row in rows)

    def mean(key: str) -> float:
        return sum(row[key] for row in rows) / len(rows)

    def rms(key: str) -> float:
        return math.sqrt(sum(row[key] ** 2 for row in rows) / len(rows))

    summary = {
        "count": len(rows),
        "seed": seed,
        "source_z_m": source_z_m,
        "radius_mode": radius_mode,
        "nominal_energy_eV": K_MEAN_EV,
        "energy_sigma_eV": K_SIGMA_EV,
        "direction_sigma_total_deg": ANGLE_SIGMA_DEG,
        "direction_cutoff_3sigma_deg": 3.0 * ANGLE_SIGMA_DEG,
        "mean_K0_eV": mean("K0_eV"),
        "std_K0_eV": math.sqrt(sum((row["K0_eV"] - mean("K0_eV")) ** 2 for row in rows) / len(rows)),
        "mean_r_larmor_mm": mean("r_larmor_m") * 1000.0,
        "rms_direction_angle_deg": rms("theta_rad") * 180.0 / math.pi,
        "mean_guiding_center_radius_mm": mean("guiding_center_r_m") * 1000.0,
        "max_guiding_center_radius_mm": max(row["guiding_center_r_m"] for row in rows) * 1000.0,
        "comsol_position_unit": comsol_position_unit,
        "comsol_file": str(txt_path),
        "metadata_file": str(csv_path),
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=500)
    parser.add_argument("--seed", type=int, default=20260907)
    parser.add_argument("--source-z-mm", type=float, default=93.0)
    parser.add_argument("--radius-mode", choices=("nominal", "energy-matched"), default="nominal")
    parser.add_argument(
        "--comsol-position-unit", choices=("mm", "m"), default="mm",
        help="Position unit written to the COMSOL release file (Stage-1 uses mm).",
    )
    parser.add_argument("--output-dir", type=Path, default=None)
    args = parser.parse_args()

    if args.count <= 0:
        raise SystemExit("count must be positive")
    root = Path(__file__).resolve().parents[1]
    out_dir = args.output_dir or (root / "data" / "centered_source")
    z_token = f"{args.source_z_mm:g}".replace(".", "p")
    stem = f"centered_release_{args.count}_seed{args.seed}_z{z_token}mm_{args.radius_mode}"
    rows = generate(args.count, args.seed, args.source_z_mm * 1e-3, args.radius_mode)
    write_outputs(
        rows,
        out_dir / f"{stem}.txt",
        out_dir / f"{stem}.csv",
        out_dir / f"{stem}.json",
        args.seed,
        args.source_z_mm * 1e-3,
        args.radius_mode,
        args.comsol_position_unit,
    )
    print(out_dir / f"{stem}.txt")
    print(out_dir / f"{stem}.csv")
    print(out_dir / f"{stem}.json")


if __name__ == "__main__":
    main()
