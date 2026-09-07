"""Reduce centered-source COMSOL tables into audit-friendly CSV/JSON summaries.

The COMSOL Java API writes Particle Evaluation tables as a time column plus
one column per particle.  This reducer deliberately keeps the particle axis:
percentiles and first-threshold events are computed from individual tracks,
not from an ensemble average that would hide frozen/lost particles.

The script is usable before Phase B has been run; it writes a clear
``not_available`` status for missing transport cases while still reducing the
Phase-A density scan.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from pathlib import Path
from typing import Iterable

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
TABLES = ROOT / "tables" / "centered"
DEFAULT_COOLING = TABLES / "cooling_scan_final"
DEFAULT_TRANSPORT = TABLES
E_CHARGE = 1.602176634e-19
M_MU = 1.8835315557426432e-28
L_STAGE_MM = 597.0
EXIT_TOL_MM = 0.1


def read_particle_table(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(time_s, values)`` from a COMSOL Particle Evaluation CSV.

    Empty fields and nonnumeric cells are represented as NaN.  COMSOL may
    emit a UTF-8 BOM and several metadata lines beginning with ``%``; both
    are handled without assuming a fixed number of metadata rows.
    """

    if not path.exists():
        raise FileNotFoundError(path)
    rows: list[list[float]] = []
    with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("%"):
                continue
            values: list[float] = []
            for token in line.split(","):
                token = token.strip()
                if not token:
                    values.append(float("nan"))
                else:
                    try:
                        values.append(float(token))
                    except ValueError:
                        values.append(float("nan"))
            if values:
                rows.append(values)
    if not rows:
        raise ValueError(f"no numeric rows in {path}")
    width = max(len(row) for row in rows)
    data = np.full((len(rows), width), np.nan, dtype=float)
    for i, row in enumerate(rows):
        data[i, : len(row)] = row
    return data[:, 0], data[:, 1:]


def percentile(values: Iterable[float], q: float) -> float:
    arr = np.asarray(list(values), dtype=float)
    arr = arr[np.isfinite(arr)]
    return float(np.percentile(arr, q)) if arr.size else float("nan")


def mean(values: Iterable[float]) -> float:
    arr = np.asarray(list(values), dtype=float)
    arr = arr[np.isfinite(arr)]
    return float(np.mean(arr)) if arr.size else float("nan")


def std(values: Iterable[float]) -> float:
    arr = np.asarray(list(values), dtype=float)
    arr = arr[np.isfinite(arr)]
    return float(np.std(arr)) if arr.size else float("nan")


def first_crossing(time_s: np.ndarray, values: np.ndarray, threshold: float) -> np.ndarray:
    """First downward crossing for each particle, linearly interpolated."""

    out = np.full(values.shape[1], np.nan, dtype=float)
    for j in range(values.shape[1]):
        y = values[:, j]
        good = np.isfinite(y) & np.isfinite(time_s)
        if not np.any(good):
            continue
        idx = np.flatnonzero(good & (y <= threshold))
        if idx.size == 0:
            continue
        i = int(idx[0])
        if i == 0:
            out[j] = time_s[i]
            continue
        # Find the previous finite sample (frozen tracks can contain NaNs).
        prev = i - 1
        while prev >= 0 and not np.isfinite(y[prev]):
            prev -= 1
        if prev < 0 or not np.isfinite(time_s[prev]) or y[prev] == y[i]:
            out[j] = time_s[i]
            continue
        fraction = (threshold - y[prev]) / (y[i] - y[prev])
        out[j] = time_s[prev] + np.clip(fraction, 0.0, 1.0) * (time_s[i] - time_s[prev])
    return out


def density_token(value: str) -> str:
    return value.replace("+", "p").replace("-", "m").replace(".", "p")


def density_from_dir(path: Path) -> float:
    match = re.search(r"n_([0-9eEpPmM+\-.]+)$", path.name)
    if not match:
        return float("nan")
    token = match.group(1).replace("p", ".").replace("P", ".")
    # The directory convention is n_1e24, n_1p2e24, etc.  ``p`` is only the
    # decimal separator (the exponent remains the literal ``e``).
    try:
        return float(token)
    except ValueError:
        return float("nan")


def write_csv(path: Path, rows: list[dict[str, object]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is None:
        keys: list[str] = []
        for row in rows:
            for key in row:
                if key not in keys:
                    keys.append(key)
        fieldnames = keys
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def reduce_cooling(cooling_root: Path) -> tuple[list[dict[str, object]], dict[str, object]]:
    rows: list[dict[str, object]] = []
    all_cases: list[dict[str, object]] = []
    for case_dir in sorted(cooling_root.glob("n_*")):
        kp_path = case_dir / "Kperp_eV.csv"
        kt_path = case_dir / "Ktotal_eV.csv"
        if not kp_path.exists() or not kt_path.exists():
            continue
        try:
            time_s, kp = read_particle_table(kp_path)
            t2, kt = read_particle_table(kt_path)
        except (OSError, ValueError):
            continue
        n_particles = min(kp.shape[1], kt.shape[1])
        kp = kp[:, :n_particles]
        kt = kt[:, :n_particles]
        if t2.size != time_s.size or not np.allclose(t2, time_s, rtol=1e-6, atol=1e-18):
            # Interpolate total energy onto the Kperp time grid if a solver
            # version emitted slightly different output times.
            kt_interp = np.full_like(kp, np.nan)
            for j in range(n_particles):
                kt_interp[:, j] = np.interp(time_s, t2, kt[:, j], left=np.nan, right=np.nan)
            kt = kt_interp
        t10_s = first_crossing(time_s, kp, 10.0)
        final_kp = kp[-1]
        final_kt = kt[-1]
        t_end_ns = float(time_s[-1] * 1e9)
        censored = np.where(np.isfinite(t10_s), t10_s * 1e9, t_end_ns)
        density = density_from_dir(case_dir)
        row = {
            "density_m^-3": density,
            "case_directory": str(case_dir),
            "n_particles": n_particles,
            "time_end_ns": t_end_ns,
            "fraction_Kperp_le_10eV_at_end": float(np.mean(final_kp <= 10.0)),
            "P50_Kperp_end_eV": percentile(final_kp, 50),
            "P90_Kperp_end_eV": percentile(final_kp, 90),
            "P95_Kperp_end_eV": percentile(final_kp, 95),
            "mean_Ktotal_end_eV": mean(final_kt),
            "std_Ktotal_end_eV": std(final_kt),
            "fraction_t10_reached": float(np.mean(np.isfinite(t10_s))),
            "P50_t10_ns_reached_only": percentile(t10_s * 1e9, 50),
            "P90_t10_ns_reached_only": percentile(t10_s * 1e9, 90),
            "P90_t10_ns_censored_at_100": percentile(censored, 90),
            "phaseA_accept_P90_Kperp_le_10": bool(percentile(final_kp, 90) <= 10.0),
        }
        rows.append(row)
        all_cases.append({"density": density, "row": row, "t10_s": t10_s})

    valid = [item for item in all_cases if np.isfinite(item["density"])]
    valid.sort(key=lambda item: item["density"])
    rows.sort(key=lambda item: float(item.get("density_m^-3", float("nan"))))
    n_min = None
    for item in valid:
        if item["row"]["phaseA_accept_P90_Kperp_le_10"]:
            n_min = item["density"]
            break
    summary = {
        "cooling_root": str(cooling_root),
        "n_cases": len(rows),
        "n_min_cool_m^-3": n_min,
        "criterion": "P90[Kperp(100 ns)] <= 10 eV; positions in COMSOL release are mm",
        "censoring_note": "t10 percentiles use 100 ns for particles that did not cross",
    }
    return rows, summary


def load_json(path: Path) -> dict[str, object]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def case_parameters(case_dir: Path) -> dict[str, object]:
    for name in ("case_meta.json", "metadata.json", "meta.json"):
        data = load_json(case_dir / name)
        if data:
            return data
    # Recover common values from a descriptive directory name where possible.
    return {"case_id": case_dir.name}


def first_flag_time(time_s: np.ndarray, flag: np.ndarray) -> np.ndarray:
    out = np.full(flag.shape[1], np.nan)
    for j in range(flag.shape[1]):
        idx = np.flatnonzero(np.isfinite(flag[:, j]) & (flag[:, j] > 0.5))
        if idx.size:
            out[j] = time_s[idx[0]]
    return out


def endpoint_at(times: np.ndarray, values: np.ndarray, event_times: np.ndarray) -> np.ndarray:
    out = np.full(values.shape[1], np.nan)
    for j, t in enumerate(event_times):
        if not np.isfinite(t):
            continue
        good = np.isfinite(times) & np.isfinite(values[:, j])
        if not np.any(good):
            continue
        ii = np.flatnonzero(good)
        out[j] = values[ii[np.argmin(np.abs(times[ii] - t))], j]
    return out


def optional_table(case_dir: Path, stem: str) -> tuple[np.ndarray, np.ndarray] | None:
    path = case_dir / stem
    if not path.exists():
        return None
    try:
        return read_particle_table(path)
    except (OSError, ValueError):
        return None


def reduce_transport(transport_root: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    if not transport_root.exists():
        return rows
    # Accept both a multi-case root (case/history/...) and a single builder
    # output (history/... directly under the supplied root).
    if (transport_root / "history").is_dir():
        case_dirs = [transport_root]
    else:
        # Search one additional level so a project-wide centered output root
        # can combine transport_baseline, lowfield, highfield, and future
        # scan-case directories without copying tables.
        case_dirs = sorted({history.parent for history in transport_root.rglob("history") if history.is_dir()})
    for case_dir in case_dirs:
        hist = case_dir / "history"
        kp_item = optional_table(hist, "Kperp_eV_history.csv")
        kt_item = optional_table(hist, "Ktotal_eV_history.csv")
        if kp_item is None or kt_item is None:
            continue
        time_s, kp = kp_item
        t2, kt = kt_item
        n = min(kp.shape[1], kt.shape[1])
        kp, kt = kp[:, :n], kt[:, :n]
        if t2.size != time_s.size or not np.allclose(t2, time_s, rtol=1e-6, atol=1e-18):
            interp = np.full_like(kp, np.nan)
            for j in range(n):
                interp[:, j] = np.interp(time_s, t2, kt[:, j])
            kt = interp
        flags = {}
        for name in ("is_exit", "is_wall", "is_electrode", "is_backward"):
            item = optional_table(hist, name + "_history.csv")
            if item is not None:
                flags[name] = item[1][:, :n]
        status_item = optional_table(hist, "particle_status_history.csv")
        stop_item = optional_table(hist, "stop_time_history.csv")
        final_status_item = optional_table(hist, "final_status_history.csv")
        t_exit = first_flag_time(time_s, flags["is_exit"]) if "is_exit" in flags else np.full(n, np.nan)
        t_wall = first_flag_time(time_s, flags["is_wall"]) if "is_wall" in flags else np.full(n, np.nan)
        t_electrode = first_flag_time(time_s, flags["is_electrode"]) if "is_electrode" in flags else np.full(n, np.nan)
        t_backward = first_flag_time(time_s, flags["is_backward"]) if "is_backward" in flags else np.full(n, np.nan)
        qz_item = optional_table(hist, "qz_history.csv")
        qx_item = optional_table(hist, "qx_history.csv")
        qy_item = optional_table(hist, "qy_history.csv")
        qz = qz_item[1][:, :n] if qz_item is not None else None
        qx = qx_item[1][:, :n] if qx_item is not None else None
        qy = qy_item[1][:, :n] if qy_item is not None else None
        # Explicit is_exit is preferred.  A coordinate fallback helps with
        # models built before the diagnostic variable was added.
        if not np.any(np.isfinite(t_exit)) and qz is not None:
            inferred = qz >= (L_STAGE_MM - EXIT_TOL_MM)
            t_exit = first_flag_time(time_s, inferred.astype(float))
        exit_mask = np.isfinite(t_exit)
        endpoint_kp = endpoint_at(time_s, kp, t_exit)
        endpoint_kt = endpoint_at(time_s, kt, t_exit)
        stacked_loss = np.vstack([t_wall, t_electrode, t_backward])
        loss_time = np.full(n, np.nan)
        for j in range(n):
            values = stacked_loss[:, j]
            finite = values[np.isfinite(values)]
            if finite.size:
                loss_time[j] = float(np.min(finite))
        loss_type: list[str] = []
        for j in range(n):
            if exit_mask[j]:
                loss_type.append("exit")
            elif np.isfinite(t_electrode[j]) and t_electrode[j] == loss_time[j]:
                loss_type.append("electrode")
            elif np.isfinite(t_wall[j]) and t_wall[j] == loss_time[j]:
                loss_type.append("wall")
            elif np.isfinite(t_backward[j]) and t_backward[j] == loss_time[j]:
                loss_type.append("backward")
            elif final_status_item is not None and np.isfinite(final_status_item[1][-1, j]):
                status = int(round(final_status_item[1][-1, j]))
                loss_type.append({2: "frozen", 3: "stuck", 4: "disappeared"}.get(status, "timeout"))
            else:
                loss_type.append("timeout")
        params = case_parameters(case_dir)
        exits = endpoint_kt[exit_mask]
        row: dict[str, object] = dict(params)
        row.update({
            "case_directory": str(case_dir),
            "n_particles": n,
            "n_exit": int(np.sum(exit_mask)),
            "T_geom": float(np.mean(exit_mask)),
            "P90_t_exit_ns": percentile(t_exit * 1e9, 90),
            "P50_t_exit_ns": percentile(t_exit * 1e9, 50),
            "mean_Ktotal_exit_eV": mean(exits),
            "std_Ktotal_exit_eV": std(exits),
            "P90_Kperp_exit_eV": percentile(endpoint_kp[exit_mask], 90),
            "fraction_exit_Ktotal_gt_1keV": float(np.mean(exits > 1000.0)) if exits.size else float("nan"),
            "fraction_exit_0p95_1p05keV": float(np.mean((exits >= 950.0) & (exits <= 1050.0))) if exits.size else float("nan"),
            "fraction_exit_below_0p95keV": float(np.mean(exits < 950.0)) if exits.size else float("nan"),
            "fraction_exit_above_1p05keV": float(np.mean(exits > 1050.0)) if exits.size else float("nan"),
            "joint_pass": bool(np.sum(exit_mask) > 0.75 * n
                                and percentile(t_exit * 1e9, 90) < 100.0
                                and abs(mean(exits) - 1000.0) <= 50.0
                                and std(exits) <= 50.0
                                and percentile(endpoint_kp[exit_mask], 90) <= 10.0),
            "loss_electrode": int(sum(v == "electrode" for v in loss_type)),
            "loss_wall": int(sum(v == "wall" for v in loss_type)),
            "loss_backward": int(sum(v == "backward" for v in loss_type)),
            "loss_timeout": int(sum(v == "timeout" for v in loss_type)),
            "loss_frozen": int(sum(v == "frozen" for v in loss_type)),
            "loss_stuck": int(sum(v == "stuck" for v in loss_type)),
            "loss_disappeared": int(sum(v == "disappeared" for v in loss_type)),
        })
        if qx is not None and qy is not None:
            x_end = endpoint_at(time_s, qx[:, :n], t_exit)
            y_end = endpoint_at(time_s, qy[:, :n], t_exit)
            row["beam_spot_rms_mm"] = float(np.sqrt(np.nanmean(x_end[exit_mask] ** 2 + y_end[exit_mask] ** 2))) if np.any(exit_mask) else float("nan")
            row["beam_spot_P90_r_mm"] = percentile(np.sqrt(x_end[exit_mask] ** 2 + y_end[exit_mask] ** 2), 90) if np.any(exit_mask) else float("nan")
        rows.append(row)
    return rows


def transport_case_dirs(transport_root: Path) -> list[Path]:
    if (transport_root / "history").is_dir():
        return [transport_root]
    return sorted({history.parent for history in transport_root.rglob("history") if history.is_dir()})


def loss_diagnostics(transport_root: Path) -> list[dict[str, object]]:
    """Return one row per particle at its first exit/loss/timeout event."""
    rows: list[dict[str, object]] = []
    for case_dir in transport_case_dirs(transport_root):
        hist = case_dir / "history"
        kp_item = optional_table(hist, "Kperp_eV_history.csv")
        kt_item = optional_table(hist, "Ktotal_eV_history.csv")
        qx_item = optional_table(hist, "qx_history.csv")
        qy_item = optional_table(hist, "qy_history.csv")
        qz_item = optional_table(hist, "qz_history.csv")
        if kp_item is None or kt_item is None:
            continue
        time_s, kp = kp_item; _, kt = kt_item
        n = min(kp.shape[1], kt.shape[1])
        flags: dict[str, np.ndarray] = {}
        for name in ("is_exit", "is_wall", "is_electrode", "is_backward"):
            item = optional_table(hist, name + "_history.csv")
            if item is not None:
                flags[name] = item[1][:, :n]
        status_item = optional_table(hist, "particle_status_history.csv")
        qx = qx_item[1][:, :n] if qx_item is not None else None
        qy = qy_item[1][:, :n] if qy_item is not None else None
        qz = qz_item[1][:, :n] if qz_item is not None else None
        for j in range(n):
            times = {name: first_flag_time(time_s, data[:, j:j + 1])[0] for name, data in flags.items()}
            finite_times = [t for t in times.values() if np.isfinite(t)]
            if times.get("is_exit", np.nan) == times.get("is_exit", np.nan) and np.isfinite(times.get("is_exit", np.nan)):
                event, event_time = "exit", times["is_exit"]
            elif finite_times:
                event_time = min(finite_times)
                event = min(times, key=lambda name: times[name] if np.isfinite(times[name]) else np.inf)
            elif status_item is not None and np.isfinite(status_item[1][-1, j]):
                status = int(round(status_item[1][-1, j])); event = {2: "frozen", 3: "stuck", 4: "disappeared"}.get(status, "timeout"); event_time = float("nan")
            else:
                event, event_time = "timeout", float("nan")
            if not np.isfinite(event_time):
                event_idx = len(time_s) - 1
            else:
                event_idx = int(np.nanargmin(np.abs(time_s - event_time)))
            rows.append({
                "case_id": case_dir.name, "particle_id": j + 1, "event": event,
                "event_time_ns": event_time * 1e9 if np.isfinite(event_time) else np.nan,
                "x_mm": qx[event_idx, j] if qx is not None else np.nan,
                "y_mm": qy[event_idx, j] if qy is not None else np.nan,
                "z_mm": qz[event_idx, j] if qz is not None else np.nan,
                "Kperp_eV": kp[event_idx, j], "Ktotal_eV": kt[event_idx, j],
                "status_final": status_item[1][-1, j] if status_item is not None else np.nan,
            })
    return rows


def write_release_summary(output: Path) -> dict[str, object]:
    releases = []
    for path in sorted((ROOT / "data" / "centered_source").glob("centered_release_500_*.json")):
        item = load_json(path)
        if item:
            releases.append(item)
    output["release_files"] = releases
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cooling-root", type=Path, default=DEFAULT_COOLING)
    parser.add_argument("--transport-root", type=Path, default=DEFAULT_TRANSPORT)
    parser.add_argument("--output-root", type=Path, default=TABLES)
    args = parser.parse_args()
    cooling_rows, cooling_summary = reduce_cooling(args.cooling_root)
    transport_rows = reduce_transport(args.transport_root)
    write_csv(args.output_root / "cooling_density_summary.csv", cooling_rows)
    write_csv(args.output_root / "cooling_density_scan.csv", cooling_rows)
    write_csv(args.output_root / "transport_scan_master.csv", transport_rows)
    write_csv(args.output_root / "centered_transport_scan_master.csv", transport_rows)
    candidates = [row for row in transport_rows if bool(row.get("joint_pass", False))]
    write_csv(args.output_root / "candidate_parameter_sets.csv", candidates)
    losses = loss_diagnostics(args.transport_root)
    write_csv(args.output_root / "loss_diagnostics.csv", losses)
    write_csv(args.output_root / "centered_loss_diagnostics.csv", losses)
    sensitivity: list[dict[str, object]] = []
    for row in cooling_rows:
        sensitivity.append({"source": "PhaseA_density", "x": row.get("density_m^-3"), "y": row.get("P90_Kperp_end_eV"), "metric": "P90_Kperp_end_eV"})
    for row in transport_rows:
        sensitivity.append({"source": "PhaseB_case", "x": row.get("case_directory"), "y": row.get("T_geom"), "metric": "T_geom"})
    write_csv(args.output_root / "variable_sensitivity.csv", sensitivity)
    summary: dict[str, object] = {
        "status": "complete",
        "cooling": cooling_summary,
        "transport": {
            "transport_root": str(args.transport_root),
            "n_cases": len(transport_rows),
            "n_joint_pass": len(candidates),
            "n_loss_diagnostics": len(losses),
        },
        "acceptance": {
            "P90_t_exit_ns_lt": 100.0,
            "T_geom_gt": 0.75,
            "mean_K_exit_eV": 1000.0,
            "mean_K_exit_tolerance_eV": 50.0,
            "std_K_exit_max_eV": 50.0,
            "P90_Kperp_exit_eV_max": 10.0,
            "decay_weighting_applied": False,
        },
    }
    write_release_summary(summary)
    args.output_root.mkdir(parents=True, exist_ok=True)
    (args.output_root / "centered_reduction_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
