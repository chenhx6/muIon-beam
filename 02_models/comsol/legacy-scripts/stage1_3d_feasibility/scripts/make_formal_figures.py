"""Create the compact formal figure set for the Stage-1 3-D feasibility study.

Figure contract
---------------
Core conclusion: the 3-D electrostatic/Lorentz/stopping model is solvable and
shows strong mean-stopping energy reduction, but the tested baseline family
does not yet form an exit-plane transport window because trajectories hit the
V2 aperture/rounded edge first.
Archetype: schematic-led composite plus quantitative diagnostic figures.
Backend: Python/matplotlib only.
Data: COMSOL-exported CSVs and the generated parameter-scan master table.
Reviewer risk: loss-event values are not exit values; no breakdown threshold or
physical muon survival probability is inferred.
"""

from __future__ import annotations

import csv
import math
import re
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from mpl_toolkits.mplot3d.art3d import Poly3DCollection


ROOT = Path(__file__).resolve().parents[1]
TABLES = ROOT / "tables"
FIGURES = ROOT / "figures"
FIGURES.mkdir(exist_ok=True)

mpl.rcParams.update(
    {
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
        "font.size": 8,
        "axes.spines.right": False,
        "axes.spines.top": False,
        "axes.linewidth": 0.8,
        "svg.fonttype": "none",
        "pdf.fonttype": 42,
        "savefig.facecolor": "white",
        "figure.facecolor": "white",
    }
)

COLORS = {
    "navy": "#17324D",
    "blue": "#2F6B9A",
    "cyan": "#4C9FAD",
    "orange": "#D37B3B",
    "red": "#B84A4A",
    "green": "#3D8B72",
    "gray": "#6D7782",
    "light": "#D9E2EA",
    "gold": "#C39A3A",
}


def save_pub(fig: mpl.figure.Figure, stem: Path) -> None:
    fig.savefig(stem.with_suffix(".png"), dpi=600, bbox_inches="tight")
    fig.savefig(stem.with_suffix(".tiff"), dpi=600, bbox_inches="tight")
    fig.savefig(stem.with_suffix(".svg"), bbox_inches="tight")
    fig.savefig(stem.with_suffix(".pdf"), bbox_inches="tight")
    plt.close(fig)


def read_numeric_csv(path: Path) -> list[list[float]]:
    rows: list[list[float]] = []
    with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("%"):
                continue
            try:
                rows.append([float(x) for x in line.split(",")])
            except ValueError:
                continue
    return rows


def read_csv_dict(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def finite_or_nan(value: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return math.nan
    return result if math.isfinite(result) else math.nan


def add_box(ax, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float,
            color: str, alpha: float, label: str | None = None) -> None:
    vertices = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    faces = [
        [vertices[i] for i in (0, 1, 2, 3)],
        [vertices[i] for i in (4, 5, 6, 7)],
        [vertices[i] for i in (0, 1, 5, 4)],
        [vertices[i] for i in (2, 3, 7, 6)],
        [vertices[i] for i in (1, 2, 6, 5)],
        [vertices[i] for i in (0, 3, 7, 4)],
    ]
    poly = Poly3DCollection(faces, facecolors=color, edgecolors=color,
                            linewidths=0.35, alpha=alpha, label=label)
    ax.add_collection3d(poly)


def add_annulus(ax, z0: float, z1: float, r_inner: float, r_outer: float,
                color: str, alpha: float, label: str | None = None) -> None:
    theta = np.linspace(0, 2 * np.pi, 80)
    surfaces = []
    for radius in (r_inner, r_outer):
        x = radius * np.cos(theta)
        y = radius * np.sin(theta)
        surfaces.append((x, y, np.full_like(x, z0)))
        surfaces.append((x, y, np.full_like(x, z1)))
    x_in, y_in, z_bot = surfaces[0]
    _, _, z_top = surfaces[1]
    x_out, y_out, _ = surfaces[2]
    verts = []
    for i in range(len(theta) - 1):
        j = i + 1
        verts.extend([
            [(x_in[i], y_in[i], z_bot[i]), (x_in[j], y_in[j], z_bot[j]),
             (x_out[j], y_out[j], z_bot[j]), (x_out[i], y_out[i], z_bot[i])],
            [(x_in[i], y_in[i], z_top[i]), (x_out[i], y_out[i], z_top[i]),
             (x_out[j], y_out[j], z_top[j]), (x_in[j], y_in[j], z_top[j])],
            [(x_in[i], y_in[i], z_bot[i]), (x_in[i], y_in[i], z_top[i]),
             (x_in[j], y_in[j], z_top[j]), (x_in[j], y_in[j], z_bot[j])],
            [(x_out[i], y_out[i], z_bot[i]), (x_out[j], y_out[j], z_bot[j]),
             (x_out[j], y_out[j], z_top[j]), (x_out[i], y_out[i], z_top[i])],
        ])
    poly = Poly3DCollection(verts, facecolors=color, edgecolors=color,
                            linewidths=0.25, alpha=alpha, label=label)
    ax.add_collection3d(poly)


def formal_geometry() -> None:
    fig = plt.figure(figsize=(7.2, 6.2))
    ax = fig.add_subplot(111, projection="3d")
    ax.set_box_aspect((1.0, 1.0, 5.9))
    # Use mm for readable display coordinates.
    outer_r, gas_r = 50.0, 45.0
    z_max = 597.0
    add_box(ax, -outer_r, outer_r, -outer_r, outer_r, 0, z_max,
            COLORS["gray"], 0.035, "grounded shell")
    add_box(ax, -gas_r, gas_r, -gas_r, gas_r, 0, z_max,
            COLORS["cyan"], 0.025, "Ne gas")
    z_centers = [26.5, 159.5, 382.5, 545.5]
    labels = ["V1", "V2", "V3", "V4"]
    electrode_colors = [COLORS["blue"], COLORS["blue"], COLORS["orange"], COLORS["red"]]
    for z, label, color in zip(z_centers, labels, electrode_colors):
        add_annulus(ax, z - 1.5, z + 1.5, 15.0, 40.0, color, 0.88, label)
        ax.text(41.5, 0, z, label, color=color, fontsize=9, weight="bold")

    # Source at V1/V2 midpoint for the 130 mm baseline clear gap.
    source_z = 26.5 + 3.0 / 2.0 + 65.0
    source_r = 0.10 * gas_r
    ax.scatter([source_r], [0], [source_z], s=38, color=COLORS["gold"],
               edgecolor="black", linewidth=0.5, zorder=10, label="Mu- source")
    ax.quiver(source_r, 0, source_z, -20, 0, 0, color=COLORS["gold"],
              linewidth=1.7, arrow_length_ratio=0.08)
    ax.text(source_r + 2, 0, source_z + 12, "radial inward source", fontsize=7,
            color=COLORS["gold"])

    ax.quiver(0, 0, 480, 0, 0, 80, color=COLORS["green"], linewidth=2.0,
              arrow_length_ratio=0.12)
    ax.text(2, 0, 575, "+z exit / transport", color=COLORS["green"], fontsize=8)
    ax.quiver(-42, -42, 470, 0, 12, 0, color=COLORS["navy"], linewidth=1.5,
              arrow_length_ratio=0.16)
    ax.text(-42, -30, 470, "Bz = 1 T", color=COLORS["navy"], fontsize=8)

    ax.set_xlim(-52, 52)
    ax.set_ylim(-52, 52)
    ax.set_zlim(0, z_max)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlabel("x (mm)", labelpad=3)
    ax.set_ylabel("y (mm)", labelpad=3)
    ax.set_zlabel("z (mm)", labelpad=3)
    ax.set_title("Stage-1 3-D master-like physics geometry\n"
                 "100 mm bore · φ30 mm aperture · 3 mm electrodes · 5 mm dielectric liner",
                 pad=12, fontsize=10, weight="bold")
    ax.view_init(elev=17, azim=-56)
    ax.legend(loc="upper left", bbox_to_anchor=(0.0, 0.91), fontsize=7,
              frameon=False, ncol=2)
    fig.subplots_adjust(bottom=0.13, top=0.84)
    fig.text(0.02, 0.015, "Schematic reconstruction of the COMSOL 3-D analytic geometry; "
             "source/inlet/pumping hardware are display placeholders only.", fontsize=6.5)
    save_pub(fig, FIGURES / "01_stage1_3d_cutaway")


def read_baseline_particle() -> tuple[np.ndarray, np.ndarray]:
    rows = np.asarray(read_numeric_csv(TABLES / "baseline_particle_timeseries.csv"), dtype=float)
    if rows.shape[1] < 18:
        raise ValueError("baseline particle table has fewer than 18 columns")
    event = np.where(np.max(rows[:, 14:18], axis=1) > 0.5)[0]
    stop = int(event[0] + 1) if event.size else len(rows)
    return rows[:stop], rows


def formal_trajectory() -> None:
    rows, _ = read_baseline_particle()
    fig = plt.figure(figsize=(7.0, 5.1))
    ax = fig.add_subplot(111, projection="3d")
    x, y, z = 1000 * rows[:, 1], 1000 * rows[:, 2], 1000 * rows[:, 3]
    ax.plot(x, y, z, color=COLORS["orange"], linewidth=1.5, label="Mu- trajectory")
    ax.scatter([x[0]], [y[0]], [z[0]], s=34, color=COLORS["gold"], label="Release")
    ax.scatter([x[-1]], [y[-1]], [z[-1]], s=34, color=COLORS["red"], label="First loss")
    ax.plot([0, 0], [0, 0], [0, 597], color=COLORS["gray"], linewidth=0.6,
            linestyle="--", alpha=0.7)
    ax.set_box_aspect((1, 1, 6.0))
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlabel("x (mm)")
    ax.set_ylabel("y (mm)")
    ax.set_zlabel("z (mm)")
    ax.set_title("Single mu- 3-D trajectory: radial injection -> gyro motion -> V2-edge loss",
                 fontsize=10, weight="bold", pad=12)
    ax.view_init(elev=20, azim=-58)
    ax.legend(loc="upper left", bbox_to_anchor=(0.0, 0.94), frameon=False, fontsize=7)
    fig.subplots_adjust(bottom=0.16, top=0.84)
    fig.text(0.02, 0.015, f"First flagged loss at t = {rows[-1,0]*1e9:.1f} ns; "
             "trajectory is truncated at the first wall/electrode flag.", fontsize=6.5)
    save_pub(fig, FIGURES / "02_single_muon_trajectory_3d")


def formal_energy() -> None:
    rows, _ = read_baseline_particle()
    t_ns = rows[:, 0] * 1e9
    kperp, kz, ktotal = rows[:, 7], rows[:, 8], rows[:, 9]
    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    ax.plot(t_ns, ktotal, color=COLORS["navy"], linewidth=1.7, label="Ktotal")
    ax.plot(t_ns, kperp, color=COLORS["orange"], linewidth=1.5, label="Kperp")
    ax.plot(t_ns, np.maximum(kz, 1e-4), color=COLORS["green"], linewidth=1.4, label="Kz")
    ax.set_yscale("log")
    ax.set_xlabel("time (ns)")
    ax.set_ylabel("kinetic energy (eV)")
    ax.set_title("Single mu- energy evolution under Geant4 mean stopping", fontsize=10, weight="bold")
    ax.grid(True, which="major", color=COLORS["light"], linewidth=0.5, alpha=0.7)
    ax.legend(frameon=False, ncol=3, loc="upper right", fontsize=7)
    ax.annotate("V2 rounded-edge loss\n(no exit-plane value)",
                xy=(t_ns[-1], max(kperp[-1], 1e-3)),
                xytext=(0.62, 0.62), textcoords="axes fraction",
                arrowprops={"arrowstyle": "-", "color": COLORS["red"], "lw": 0.8},
                fontsize=7, color=COLORS["red"])
    fig.subplots_adjust(bottom=0.22, top=0.84)
    fig.text(0.02, 0.015, "Kz is plotted with a 10^-4 eV display floor only; stopping interpolation uses Ktotal. "
             "The loss-time energies are not Kperp_exit/Kz_exit.", fontsize=6.5)
    save_pub(fig, FIGURES / "03_single_muon_energy")


def formal_density() -> None:
    rows = read_csv_dict(TABLES / "parameter_scan_master.csv")
    density_rows = [r for r in rows if r["parameter_set_id"].startswith("density_")]
    density_rows.sort(key=lambda r: finite_or_nan(r["Ne_number_density"]))
    n = np.array([finite_or_nan(r["Ne_number_density"]) for r in density_rows])
    radius = np.array([finite_or_nan(r["loss_event_radial_position"]) * 1000 for r in density_rows])
    time = np.array([finite_or_nan(r["loss_event_time"]) * 1e9 for r in density_rows])
    fig, axes = plt.subplots(1, 2, figsize=(6.7, 3.3), gridspec_kw={"wspace": 0.35})
    axes[0].semilogx(n, radius, "o-", color=COLORS["blue"], linewidth=1.4, markersize=4)
    axes[0].axhline(15, color=COLORS["red"], linewidth=0.8, linestyle="--", label="Aperture radius (φ30 mm)")
    axes[0].set_xlabel("Ne number density (m^-3)")
    axes[0].set_ylabel("first-loss radius (mm)")
    axes[0].set_title("Aperture acceptance")
    axes[0].legend(frameon=False, fontsize=6.5, loc="best")
    axes[1].semilogx(n, time, "o-", color=COLORS["orange"], linewidth=1.4, markersize=4)
    axes[1].set_xlabel("Ne number density (m^-3)")
    axes[1].set_ylabel("first-loss time (ns)")
    axes[1].set_title("Cooling/transport timing")
    for ax in axes:
        ax.grid(True, which="major", color=COLORS["light"], linewidth=0.5, alpha=0.7)
    fig.suptitle("Ne density scan: stronger stopping does not remove the V2 aperture bottleneck",
                 fontsize=10, weight="bold")
    fig.subplots_adjust(bottom=0.29, top=0.78)
    fig.text(0.02, 0.015, "All four density points have transmission_fraction = 0; values are first-loss diagnostics.", fontsize=6.5)
    save_pub(fig, FIGURES / "04_density_scan_summary")


def formal_voltage() -> None:
    rows = read_csv_dict(TABLES / "parameter_scan_master.csv")
    groups = [
        ("V1–V2 guidance", "V12_", "voltage_difference_V1_to_V2", COLORS["blue"]),
        ("V2–V3 transport", "V23_", "voltage_difference_V2_to_V3", COLORS["orange"]),
        ("V3–V4 adjustment", "V34_", "voltage_difference_V3_to_V4", COLORS["red"]),
    ]
    fig, axes = plt.subplots(1, 3, figsize=(7.2, 3.2), gridspec_kw={"wspace": 0.48})
    for ax, (title, prefix, field, color) in zip(axes, groups):
        selected = [r for r in rows if r["parameter_set_id"].startswith(prefix)]
        values = np.array([finite_or_nan(r[field]) / 1000 for r in selected])
        radius = np.array([finite_or_nan(r["loss_event_radial_position"]) * 1000 for r in selected])
        order = np.argsort(values)
        ax.plot(values[order], radius[order], "o-", color=color, linewidth=1.3, markersize=3.5)
        ax.axhline(15, color=COLORS["gray"], linewidth=0.7, linestyle="--")
        ax.set_xlabel("ΔV (kV)")
        ax.set_title(title, fontsize=8)
        for tick in ax.get_xticklabels():
            tick.set_rotation(20)
            tick.set_rotation_mode("anchor")
            tick.set_ha("right")
        ax.grid(True, color=COLORS["light"], linewidth=0.5, alpha=0.7)
    axes[0].set_ylabel("first-loss radius (mm)")
    fig.suptitle("Voltage scans: no tested setting reaches the explicit exit plane",
                 fontsize=10, weight="bold")
    fig.subplots_adjust(bottom=0.34, top=0.78)
    fig.text(0.02, 0.015, "Dashed line: 15 mm aperture radius. Every point is a loss diagnostic; no exit energy is reported.", fontsize=6.5)
    save_pub(fig, FIGURES / "05_voltage_scan_summary")


def formal_hv() -> None:
    row = read_csv_dict(TABLES / "baseline_result.csv")[0]
    labels = ["Ne gas", "aperture/electrode", "dielectric / TJ", "all domains"]
    values = [finite_or_nan(row["max_E_in_Ne"]) / 1e6,
              finite_or_nan(row["max_E_at_aperture"]) / 1e6,
              finite_or_nan(row["max_E_in_dielectric"]) / 1e6,
              finite_or_nan(row["max_E_total"]) / 1e6]
    colors = [COLORS["cyan"], COLORS["orange"], COLORS["gold"], COLORS["navy"]]
    fig, ax = plt.subplots(figsize=(5.8, 3.5))
    x = np.arange(len(labels))
    bars = ax.bar(x, values, color=colors, width=0.62)
    ax.set_xticks(x, labels)
    for tick in ax.get_xticklabels():
        tick.set_rotation(20)
        tick.set_rotation_mode("anchor")
        tick.set_ha("right")
    ax.set_ylabel("field magnitude (MV m^-1)")
    ax.set_title("Baseline 3-D electric-field screening", fontsize=10, weight="bold")
    ax.grid(axis="y", color=COLORS["light"], linewidth=0.5, alpha=0.8)
    for bar, value in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, value + max(values) * 0.025,
                f"{value:.2f}", ha="center", va="bottom", fontsize=7)
    ax.text(0.02, 0.94, "HV_RISK_SCREENING only\nno breakdown proof", transform=ax.transAxes,
            ha="left", va="top", fontsize=7, color=COLORS["red"])
    fig.subplots_adjust(bottom=0.27, top=0.84)
    fig.text(0.02, 0.015, "Representative alumina εr = 9.4; dielectric breakdown strength and Paschen threshold were not assumed.", fontsize=6.5)
    save_pub(fig, FIGURES / "06_hv_risk_summary")


def formal_window() -> None:
    rows = read_csv_dict(TABLES / "parameter_scan_master.csv")
    family_rules = [
        ("density", lambda n: n.startswith("density_")),
        ("source", lambda n: n.startswith("source_")),
        ("V12", lambda n: n.startswith("V12_")),
        ("V23", lambda n: n.startswith("V23_")),
        ("V34", lambda n: n.startswith("V34_")),
        ("spacing", lambda n: n.startswith("spacing_")),
        ("refine", lambda n: n.startswith("refine_")),
        ("phase", lambda n: n.startswith("phase_source")),
        ("velocity phase", lambda n: n.startswith("phase_f0p10_")),
        ("fine", lambda n: n.startswith("fine_")),
        ("fine2", lambda n: n.startswith("fine2_")),
        ("bridge", lambda n: n.startswith("bridge_")),
        ("shortgap", lambda n: n.startswith("shortgap_")),
        ("axial", lambda n: n.startswith("axial_")),
    ]
    families = [rule[0] for rule in family_rules]
    counts = []
    for _, predicate in family_rules:
        selected = [r for r in rows if predicate(r["parameter_set_id"])]
        counts.append((len(selected), sum(finite_or_nan(r["transmission_fraction"]) > 0.5 for r in selected)))
    fig, ax = plt.subplots(figsize=(6.4, 3.5))
    x = np.arange(len(families))
    total = np.array([v[0] for v in counts])
    exit_count = np.array([v[1] for v in counts])
    ax.bar(x, total, color=COLORS["light"], edgecolor=COLORS["gray"], linewidth=0.5, label="Tested cases")
    ax.bar(x, exit_count, color=COLORS["green"], label="Valid exit-plane transmissions")
    ax.set_xticks(x, families)
    for tick in ax.get_xticklabels():
        tick.set_rotation(35)
        tick.set_rotation_mode("anchor")
        tick.set_ha("right")
    ax.set_ylabel("number of cases")
    ax.set_title("First-pass feasibility window: no valid exit-plane case yet", fontsize=10, weight="bold")
    ax.legend(frameon=False, fontsize=7)
    ax.text(0.98, 0.92, "candidate_parameter_sets = 0", transform=ax.transAxes,
            ha="right", va="top", fontsize=8, color=COLORS["red"], weight="bold")
    fig.subplots_adjust(bottom=0.32, top=0.84)
    fig.text(0.02, 0.015, "A case is transmitted only if the explicit exit plane is reached without electrode/wall hit.", fontsize=6.5)
    save_pub(fig, FIGURES / "07_feasibility_window")


def main() -> None:
    formal_geometry()
    formal_trajectory()
    formal_energy()
    formal_density()
    formal_voltage()
    formal_hv()
    formal_window()
    print(f"wrote formal figures to {FIGURES}")


if __name__ == "__main__":
    main()
