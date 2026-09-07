"""Pre-estimate Stage-1 length and time scales from the Geant4 stopping table.

This is deliberately a light-weight, non-COMSOL calculation.  It is used to
choose a tractable first 3-D geometry and to document the scale mismatch
between the Geant4 mean-stopping baseline and a compact electrode stack.
The stopping table is the supplied Geant4 interface; no stopping data are
regenerated here.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STOPPING = ROOT.parent / "muon" / "ne" / "comsol_muNe_SN.txt"
OUT = ROOT / "intermediate" / "results"

E_CHARGE = 1.602176634e-19  # C = J/eV
M_MU = 1.8835315557426432e-28  # kg, reliable mu- mass used by Geant4 metadata
B0 = 1.0  # T
TEMPERATURE = 300.0  # K
K_B = 1.380649e-23  # J/K


def read_two_column_table(path: Path) -> tuple[list[float], list[float]]:
    energies: list[float] = []
    sn: list[float] = []
    with path.open("r", encoding="ascii") as handle:
        for raw in handle:
            row = raw.strip()
            if not row or row.startswith("#"):
                continue
            fields = row.split()
            if len(fields) < 2:
                continue
            energies.append(float(fields[0]))
            sn.append(float(fields[1]))
    if len(energies) < 2:
        raise ValueError(f"stopping table has too few rows: {path}")
    if any(b <= a for a, b in zip(energies, energies[1:])):
        raise ValueError("stopping energies must be strictly increasing")
    if any(value <= 0.0 or not math.isfinite(value) for value in sn):
        raise ValueError("stopping cross sections must be positive and finite")
    return energies, sn


def log_interp(x: float, xp: list[float], fp: list[float]) -> float:
    if math.isclose(x, xp[0], rel_tol=0.0, abs_tol=1.0e-10 * max(1.0, xp[0])):
        return fp[0]
    if math.isclose(x, xp[-1], rel_tol=0.0, abs_tol=1.0e-10 * max(1.0, xp[-1])):
        return fp[-1]
    if x < xp[0] or x > xp[-1]:
        raise ValueError(f"energy {x:g} eV outside table [{xp[0]:g}, {xp[-1]:g}]")
    lo = 0
    hi = len(xp) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xp[mid] <= x:
            lo = mid
        else:
            hi = mid
    lx = math.log(x)
    x0, x1 = math.log(xp[lo]), math.log(xp[hi])
    y0, y1 = math.log(fp[lo]), math.log(fp[hi])
    return math.exp(y0 + (lx - x0) * (y1 - y0) / (x1 - x0))


def integrate_cooling(
    e_hi: float, e_lo: float, density: float, energies: list[float], sn: list[float]
) -> tuple[float, float]:
    # Integrate in log-energy space so the low-energy table is resolved.
    n = 6000
    log_hi = math.log(e_hi)
    log_lo = math.log(e_lo)
    total_path = 0.0
    total_time = 0.0
    previous_e = e_hi
    previous_s = density * log_interp(e_hi, energies, sn)
    previous_v = math.sqrt(2.0 * e_hi * E_CHARGE / M_MU)
    for index in range(1, n + 1):
        frac = index / n
        current_e = math.exp(log_hi + frac * (log_lo - log_hi))
        current_s = density * log_interp(current_e, energies, sn)
        current_v = math.sqrt(2.0 * current_e * E_CHARGE / M_MU)
        de = previous_e - current_e
        total_path += 0.5 * de * (1.0 / previous_s + 1.0 / current_s)
        total_time += 0.5 * de * (
            1.0 / (previous_s * previous_v) + 1.0 / (current_s * current_v)
        )
        previous_e, previous_s, previous_v = current_e, current_s, current_v
    return total_path, total_time


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    energies, sn = read_two_column_table(STOPPING)
    densities = [1e21, 3e21, 1e22, 3e22, 1e23, 3e23]
    targets = [10.0, 100.0, 1_000.0, 10_000.0]

    omega = E_CHARGE * B0 / M_MU
    gyro_period = 2.0 * math.pi / omega
    e0 = 100_000.0
    v0 = math.sqrt(2.0 * e0 * E_CHARGE / M_MU)
    r_larmor = M_MU * v0 / (E_CHARGE * B0)

    scale_path = OUT / "preestimate_cooling_scales.csv"
    with scale_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "Ne_number_density_1_per_m3",
                "initial_energy_eV",
                "target_energy_eV",
                "cooling_path_m",
                "cooling_time_s",
                "gyro_period_s",
                "gyro_turns",
                "axial_velocity_at_target_m_per_s",
                "axial_displacement_at_target_velocity_m",
                "Ne_pressure_Pa",
            ]
        )
        for density in densities:
            for target in targets:
                path, time = integrate_cooling(e0, target, density, energies, sn)
                vz = math.sqrt(2.0 * target * E_CHARGE / M_MU)
                writer.writerow(
                    [
                        f"{density:.8e}",
                        f"{e0:.8e}",
                        f"{target:.8e}",
                        f"{path:.8e}",
                        f"{time:.8e}",
                        f"{gyro_period:.8e}",
                        f"{time / gyro_period:.8e}",
                        f"{vz:.8e}",
                        f"{vz * time:.8e}",
                        f"{density * K_B * TEMPERATURE:.8e}",
                    ]
                )

    axial_path = OUT / "preestimate_axial_scales.csv"
    kz_values = [10.0, 50.0, 100.0, 500.0, 1_000.0, 5_000.0, 10_000.0]
    with axial_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "Kz_eV",
                "axial_velocity_m_per_s",
                "axial_displacement_10ns_m",
                "axial_displacement_50ns_m",
                "axial_displacement_100ns_m",
            ]
        )
        for kz in kz_values:
            vz = math.sqrt(2.0 * kz * E_CHARGE / M_MU)
            writer.writerow(
                [
                    f"{kz:.8e}",
                    f"{vz:.8e}",
                    f"{vz * 10e-9:.8e}",
                    f"{vz * 50e-9:.8e}",
                    f"{vz * 100e-9:.8e}",
                ]
            )

    summary = OUT / "preestimate_summary.md"
    with summary.open("w", encoding="utf-8") as handle:
        handle.write("# Stage-1 3D pre-estimate\n\n")
        handle.write(f"- Input: supplied Geant4 SN(E), {len(energies)} rows.\n")
        handle.write(f"- Bz: {B0:g} T; mu- mass: {M_MU:.16e} kg.\n")
        handle.write(f"- 100 keV speed: {v0:.6e} m/s.\n")
        handle.write(f"- Larmor radius: {r_larmor:.6e} m.\n")
        handle.write(f"- Gyro period: {gyro_period:.6e} s.\n\n")
        handle.write(
            "The integrated paths and times are mean electromagnetic stopping "
            "estimates only. They are not COMSOL trajectory results and do not "
            "include angular scattering, atomic capture, or muon decay.\n"
        )
    print(f"wrote {scale_path}")
    print(f"wrote {axial_path}")
    print(f"wrote {summary}")


if __name__ == "__main__":
    main()
