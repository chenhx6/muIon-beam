"""Small Python-backend Nature-figure integration check using migrated data."""
from __future__ import annotations

import csv
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "03_runs/formal/RUN-LEGACY-SMOKE-001-stage1-centered/input/legacy/stage1_3d_feasibility/tables/centered/cooling_density_summary.csv"
OUTPUT = Path(__file__).resolve().parent / "neon-density-radial-cooling-smoke"

mpl.rcParams.update(
    {
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
        "svg.fonttype": "none",
        "pdf.fonttype": 42,
        "font.size": 7,
        "axes.spines.right": False,
        "axes.spines.top": False,
        "axes.linewidth": 0.8,
    }
)


def load_rows() -> list[dict[str, float]]:
    with SOURCE.open(newline="", encoding="utf-8-sig") as handle:
        rows = []
        for row in csv.DictReader(handle):
            rows.append(
                {
                    "density": float(row["density_m^-3"]),
                    "cooling_time": float(row["P90_t10_ns_censored_at_100"]),
                }
            )
    if not rows:
        raise ValueError("source CSV has no observations")
    return rows


def main() -> None:
    rows = load_rows()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    x = [row["density"] / 1e24 for row in rows]
    y = [row["cooling_time"] for row in rows]
    # 89 mm single-column width, expressed in inches for Matplotlib.
    fig, axis = plt.subplots(figsize=(3.5039, 2.4409), constrained_layout=True)
    axis.plot(x, y, marker="o", linewidth=1.2, markersize=3.5, color="#2f5597")
    axis.axhline(100, color="#777777", linestyle="--", linewidth=0.8, label="Limit: 100 ns")
    axis.set_xlabel("Ne number density (10^24 m^-3)")
    axis.set_ylabel("P90 cooling time (ns)")
    axis.set_title("Historical migration smoke figure")
    axis.set_ylim(bottom=0)
    axis.legend(frameon=False, fontsize=6)
    axis.text(0.02, 0.05, "Historical data; n = 500 per point", transform=axis.transAxes, fontsize=6)
    for suffix, kwargs in [("svg", {}), ("pdf", {}), ("tiff", {"dpi": 600})]:
        fig.savefig(OUTPUT.with_suffix(f".{suffix}"), bbox_inches="tight", **kwargs)
    plt.close(fig)
    print(f"created {OUTPUT}.svg/.pdf/.tiff from {SOURCE}")


if __name__ == "__main__":
    main()
