"""Create the centered-source figure set without relying on a GUI backend.

The COMSOL workstation used for this archive does not ship matplotlib, so the
figure layer is intentionally a small Pillow/numpy renderer.  It writes PNG
files with fixed 1600x1000 geometry, consistent coordinates, linear/log field
variants, and explicit ``actual``/``planned`` annotations.  The numerical
tables remain the source of truth; figures never read the legacy PNGs.
"""

from __future__ import annotations

import csv
import json
import math
import re
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
TABLES = ROOT / "tables" / "centered"
FIG = ROOT / "figures" / "centered"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_centered_results import read_particle_table, reduce_transport  # noqa: E402


W, H = 1600, 1000
MARGIN = (150, 85, 120, 135)  # left, top, right, bottom
FONT_PATH = "C:\\Windows\\Fonts\\arial.ttf"
FONT_BOLD_PATH = "C:\\Windows\\Fonts\\arialbd.ttf"


def font(size: int, bold: bool = False):
    try:
        return ImageFont.truetype(FONT_BOLD_PATH if bold else FONT_PATH, size)
    except OSError:
        return ImageFont.load_default()


F18 = font(18)
F20 = font(20)
F24 = font(24, True)
F28 = font(28, True)
F32 = font(32, True)


def mkdir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def save(img: Image.Image, path: Path) -> None:
    mkdir(path)
    img.save(path, "PNG", optimize=True)


def new_canvas(title: str, subtitle: str = "") -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    d.text((MARGIN[0], 24), title, fill="#17324D", font=F28)
    if subtitle:
        d.text((MARGIN[0], 58), subtitle, fill="#52606D", font=F18)
    return img, d


def plot_box(d: ImageDraw.ImageDraw) -> tuple[int, int, int, int]:
    return (MARGIN[0], MARGIN[1], W - MARGIN[2], H - MARGIN[3])


def finite_xy(x: Iterable[float], y: Iterable[float]) -> tuple[np.ndarray, np.ndarray]:
    x, y = np.asarray(list(x), float), np.asarray(list(y), float)
    mask = np.isfinite(x) & np.isfinite(y)
    return x[mask], y[mask]


def limits(v: np.ndarray, pad: float = 0.05) -> tuple[float, float]:
    v = v[np.isfinite(v)]
    if v.size == 0:
        return 0.0, 1.0
    lo, hi = float(np.min(v)), float(np.max(v))
    if lo == hi:
        delta = max(1.0, abs(lo) * 0.1)
        return lo - delta, hi + delta
    delta = (hi - lo) * pad
    return lo - delta, hi + delta


def axes(d: ImageDraw.ImageDraw, xlim: tuple[float, float], ylim: tuple[float, float],
         xlabel: str, ylabel: str, xticks: int = 6, yticks: int = 6) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = plot_box(d)
    d.rectangle((x0, y0, x1, y1), outline="#637381", width=2)
    for i in range(xticks + 1):
        t = i / xticks
        x = int(x0 + t * (x1 - x0))
        d.line((x, y1, x, y1 + 8), fill="#637381", width=1)
        value = xlim[0] + t * (xlim[1] - xlim[0])
        d.text((x - 30, y1 + 15), f"{value:.3g}", fill="#263238", font=F18)
    for i in range(yticks + 1):
        t = i / yticks
        y = int(y1 - t * (y1 - y0))
        d.line((x0 - 8, y, x0, y), fill="#637381", width=1)
        value = ylim[0] + t * (ylim[1] - ylim[0])
        d.text((x0 - 105, y - 10), f"{value:.3g}", fill="#263238", font=F18)
    d.text(((x0 + x1) // 2 - len(xlabel) * 5, y1 + 55), xlabel, fill="#263238", font=F20)
    d.text((18, (y0 + y1) // 2), ylabel, fill="#263238", font=F20)
    return x0, y0, x1, y1


def sx(v: float, lim: tuple[float, float], box: tuple[int, int, int, int]) -> int:
    return int(box[0] + (v - lim[0]) / (lim[1] - lim[0]) * (box[2] - box[0]))


def sy(v: float, lim: tuple[float, float], box: tuple[int, int, int, int]) -> int:
    return int(box[3] - (v - lim[0]) / (lim[1] - lim[0]) * (box[3] - box[1]))


def line_plot(path: Path, title: str, subtitle: str, x: np.ndarray, ys: list[tuple[np.ndarray, str, str]],
              xlabel: str, ylabel: str, ylog: bool = False, markers: bool = True) -> None:
    img, d = new_canvas(title, subtitle)
    xx = x[np.isfinite(x)]
    values = []
    for y, _, _ in ys:
        yy = np.asarray(y, float)
        if ylog:
            yy = np.log10(np.maximum(np.abs(yy), 1e-30))
        values.append(yy)
    all_y = np.concatenate([v[np.isfinite(v)] for v in values]) if values else np.array([0, 1])
    box = axes(d, limits(xx), limits(all_y), xlabel, ylabel)
    colors = ["#2F6B9A", "#D37B3B", "#3D8B72", "#B84A4A", "#8A5AA8"]
    for k, (y, label, _) in enumerate(ys):
        yy = np.asarray(y, float)
        if ylog:
            yy = np.log10(np.maximum(np.abs(yy), 1e-30))
        mask = np.isfinite(x) & np.isfinite(yy)
        pts = [(sx(float(a), limits(xx), box), sy(float(b), limits(all_y), box)) for a, b in zip(x[mask], yy[mask])]
        if len(pts) > 1:
            d.line(pts, fill=colors[k % len(colors)], width=4)
        if markers:
            for px, py in pts[:: max(1, len(pts) // 25)]:
                d.ellipse((px - 5, py - 5, px + 5, py + 5), fill=colors[k % len(colors)])
        d.line((W - 420, 120 + 32 * k, W - 370, 120 + 32 * k), fill=colors[k % len(colors)], width=4)
        d.text((W - 355, 108 + 32 * k), label, fill="#263238", font=F18)
    if ylog:
        d.text((MARGIN[0], H - 50), "log10(abs(value)); display transform only", fill="#B84A4A", font=F18)
    save(img, path)


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def read_numeric_rows(path: Path) -> np.ndarray:
    rows: list[list[float]] = []
    if not path.exists():
        return np.empty((0, 0))
    with path.open(encoding="utf-8-sig", errors="replace") as handle:
        for line in handle:
            if line.startswith("%") or not line.strip():
                continue
            vals = []
            for token in line.strip().split(","):
                try:
                    vals.append(float(token))
                except ValueError:
                    vals.append(float("nan"))
            rows.append(vals)
    if not rows:
        return np.empty((0, 0))
    width = max(map(len, rows))
    out = np.full((len(rows), width), np.nan)
    for i, row in enumerate(rows):
        out[i, : len(row)] = row
    return out


def color(v: float, lo: float, hi: float, diverging: bool = False) -> tuple[int, int, int]:
    if not np.isfinite(v):
        return 245, 245, 245
    t = float(np.clip((v - lo) / max(hi - lo, 1e-30), 0, 1))
    if diverging:
        if t < 0.5:
            u = t * 2
            return int(40 * u + 45 * (1 - u)), int(100 * u + 75 * (1 - u)), int(180 * u + 160 * (1 - u))
        u = (t - 0.5) * 2
        return int(45 * (1 - u) + 190 * u), int(175 * (1 - u) + 55 * u), int(205 * (1 - u) + 55 * u)
    # blue -> cyan -> yellow -> red
    if t < 0.33:
        u = t / 0.33
        return int(20 * (1 - u) + 40 * u), int(75 * (1 - u) + 180 * u), int(170 * (1 - u) + 210 * u)
    if t < 0.66:
        u = (t - 0.33) / 0.33
        return int(40 * (1 - u) + 245 * u), int(180 * (1 - u) + 205 * u), int(210 * (1 - u) + 60 * u)
    u = (t - 0.66) / 0.34
    return int(245 * (1 - u) + 190 * u), int(205 * (1 - u) + 40 * u), int(60 * (1 - u) + 40 * u)


def heatmap(path: Path, title: str, subtitle: str, x: np.ndarray, y: np.ndarray, v: np.ndarray,
            xlabel: str, ylabel: str, label: str, log_value: bool = False,
            diverging: bool = False, overlay: str = "") -> None:
    img, d = new_canvas(title, subtitle)
    mask = np.isfinite(x) & np.isfinite(y) & np.isfinite(v)
    if not np.any(mask):
        d.text((MARGIN[0], MARGIN[1] + 80), "No sampled COMSOL cases yet", fill="#B84A4A", font=F24)
        save(img, path)
        return
    x, y, v = x[mask], y[mask], v[mask]
    if log_value:
        v = np.log10(np.maximum(np.abs(v), 1e-30))
    xlim, ylim = limits(x), limits(y)
    box = axes(d, xlim, ylim, xlabel, ylabel)
    vlo, vhi = limits(v, 0.0)
    # Draw each sample as a large cell, preserving the sparse nature of the
    # actual scan rather than inventing interpolated transport results.
    dx = max((xlim[1] - xlim[0]) * 0.035, 1e-9)
    dy = max((ylim[1] - ylim[0]) * 0.035, 1e-9)
    for a, b, q in zip(x, y, v):
        px, py = sx(float(a), xlim, box), sy(float(b), ylim, box)
        rx = max(10, int(dx / (xlim[1] - xlim[0]) * (box[2] - box[0])))
        ry = max(10, int(dy / (ylim[1] - ylim[0]) * (box[3] - box[1])))
        d.rectangle((px - rx, py - ry, px + rx, py + ry), fill=color(float(q), vlo, vhi, diverging), outline="#17324D", width=2)
        d.ellipse((px - 5, py - 5, px + 5, py + 5), fill="#17324D")
    # compact colorbar
    cbx0, cbx1, cby0, cby1 = W - 250, W - 205, 170, 670
    for i in range(cby1 - cby0):
        q = vhi - i / (cby1 - cby0) * (vhi - vlo)
        d.line((cbx0, cby0 + i, cbx1, cby0 + i), fill=color(q, vlo, vhi, diverging), width=1)
    d.text((cbx1 + 15, cby0 - 10), f"{vhi:.3g}", fill="#263238", font=F18)
    d.text((cbx1 + 15, cby1 - 10), f"{vlo:.3g}", fill="#263238", font=F18)
    d.text((cbx0 - 10, cby1 + 25), label, fill="#263238", font=F18)
    if overlay:
        d.text((MARGIN[0], H - 50), overlay, fill="#B84A4A", font=F18)
    save(img, path)


def field_arrays(path: Path) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray]]:
    a = read_numeric_rows(path)
    if a.size == 0 or a.shape[1] < 8:
        return np.array([]), np.array([]), {}
    # Data export includes x,y,z once as coordinates and again as the first
    # three requested expressions.  Use the coordinate block and expression
    # columns by their stable order in BuildCenteredStage1Model.java.
    x, y, z = a[:, 0], a[:, 1], a[:, 2]
    offset = 3 if a.shape[1] >= 13 else 0
    fields: dict[str, np.ndarray] = {}
    if a.shape[1] >= offset + 10:
        fields = {
            "V": a[:, offset + 3], "Ex": a[:, offset + 4], "Ey": a[:, offset + 5],
            "Ez": a[:, offset + 6], "E": a[:, offset + 7],
            "Eperp": a[:, offset + 8], "U": a[:, offset + 9],
        }
        rho = np.sqrt(x * x + y * y)
        fields["Er"] = np.divide(x * fields["Ex"] + y * fields["Ey"], rho,
                                  out=np.zeros_like(rho), where=rho > 1e-12)
    return x, z, fields


def electrode_overlay(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int], xlim: tuple[float, float], zlim: tuple[float, float]) -> None:
    z_centers = [26.5, 159.5, 382.5, 545.5]
    for i, z in enumerate(z_centers, 1):
        if zlim[0] <= z <= zlim[1]:
            px = sx(z, zlim, box)
            d.line((px, box[1], px, box[3]), fill="#B84A4A", width=2)
            d.text((px + 4, box[1] + 10), f"V{i}", fill="#B84A4A", font=F18)


def field_map(path: Path, outdir: Path, name: str, key: str, log_mode: bool, signed: bool = False) -> None:
    x, z, f = field_arrays(path)
    if x.size == 0 or key not in f:
        return
    # x-z export is already a y=0 section; coordinates are mm.
    v = f[key]
    if log_mode:
        display = np.log10(np.maximum(np.abs(v), 1.0))
        label = f"log10(abs({key})) [floor=1 V/m]"
    else:
        display = v
        label = f"{key} (V/m)" if key != "V" and key != "U" else key
    # Use binned rectangles so irregular finite-element nodes are visible.
    nx, nz = 150, 190
    xlim, zlim = limits(x, 0.01), limits(z, 0.01)
    grid = np.full((nz, nx), np.nan)
    count = np.zeros_like(grid)
    ix = np.clip(((x - xlim[0]) / (xlim[1] - xlim[0]) * (nx - 1)).astype(int), 0, nx - 1)
    iz = np.clip(((z - zlim[0]) / (zlim[1] - zlim[0]) * (nz - 1)).astype(int), 0, nz - 1)
    for i, j, q in zip(ix, iz, display):
        if np.isfinite(q):
            if not np.isfinite(grid[j, i]): grid[j, i] = 0.0
            grid[j, i] += q; count[j, i] += 1
    grid[count > 0] /= count[count > 0]
    finite = grid[np.isfinite(grid)]
    if not finite.size: return
    lo, hi = float(np.min(finite)), float(np.max(finite))
    if signed and not log_mode:
        m = max(abs(lo), abs(hi)); lo, hi = -m, m
    img, d = new_canvas(f"Centered Stage-1: {key} {'log' if log_mode else 'linear'}", "COMSOL CutPlane export; x and z in mm; values are not inferred from PNG")
    box = axes(d, xlim, zlim, "x or rho (mm)", "z (mm)")
    for j in range(nz):
        for i in range(nx):
            q = grid[j, i]
            if not np.isfinite(q): continue
            xa = xlim[0] + i / nx * (xlim[1] - xlim[0]); xb = xlim[0] + (i + 1) / nx * (xlim[1] - xlim[0])
            za = zlim[0] + j / nz * (zlim[1] - zlim[0]); zb = zlim[0] + (j + 1) / nz * (zlim[1] - zlim[0])
            p0, p1 = sx(xa, xlim, box), sx(xb, xlim, box)
            py0, py1 = sy(za, zlim, box), sy(zb, zlim, box)
            d.rectangle((p0, py1, p1 + 1, py0 + 1), fill=color(float(q), lo, hi, signed and not log_mode))
    # A fixed-density vector overlay on linear |E| maps helps distinguish a
    # weak broad field from a narrow fringe peak.  Arrow length is normalized
    # for display, so it never implies a second magnitude scale.
    if not log_mode and key == "E" and "Ex" in f and "Ez" in f:
        stride = max(1, len(x) // 80)
        for xx, zz, ex, ez, ee in zip(x[::stride], z[::stride], f["Ex"][::stride], f["Ez"][::stride], f["E"][::stride]):
            if not np.isfinite(xx + zz + ex + ez + ee) or ee <= 1e-6:
                continue
            px, py = sx(float(xx), xlim, box), sy(float(zz), zlim, box)
            length = 13.0; norm = math.hypot(float(ex), float(ez));
            if norm <= 0: continue
            tx, ty = px + int(length * ex / norm), py - int(length * ez / norm)
            d.line((px, py, tx, ty), fill="#263238", width=1)
            d.polygon([(tx, ty), (tx - 4, ty + 3), (tx + 3, ty + 4)], fill="#263238")
    electrode_overlay(d, box, xlim, zlim)
    d.text((MARGIN[0], H - 52), label, fill="#263238", font=F18)
    save(img, outdir / f"{name}.png")


def potential_plot(field_path: Path, outdir: Path) -> None:
    x, z, f = field_arrays(field_path)
    if x.size == 0: return
    # Reuse field map renderer for V and U but label units explicitly.
    field_map(field_path, outdir, "potential_global_V_linear", "V", False)
    field_map(field_path, outdir, "potential_global_U_mu_linear", "U", False)
    # Axis curves from the separate CutLine export.
    axis = read_numeric_rows(field_path.parent / "field_axis_centered.csv")
    if axis.size and axis.shape[1] >= 10:
        zaxis = axis[:, 2]
        # axis export order: coordinates (3) + x,y,z,V,Ez,E,U
        V = axis[:, 6] if axis.shape[1] > 6 else np.array([])
        Ez = axis[:, 7] if axis.shape[1] > 7 else np.array([])
        U = axis[:, 9] if axis.shape[1] > 9 else np.array([])
        line_plot(outdir / "axis_potential_and_Ez.png", "Axis potential and axial field", "COMSOL CutLine3D at x=y=0; z in mm", zaxis, [(V, "V (V)", "#2F6B9A"), (Ez, "Ez (V/m)", "#D37B3B")], "z (mm)", "value")
        line_plot(outdir / "axis_muon_potential_energy.png", "Axis μ− electrostatic potential energy", "Uμ=qμ(V−V1), qμ=−e; U in eV", zaxis, [(U, "Uμ (eV)", "#3D8B72")], "z (mm)", "Uμ (eV)")


def equipotential_plot(field_path: Path, outdir: Path) -> None:
    """Render approximate equipotential contours from the FE CutPlane nodes."""
    x, z, f = field_arrays(field_path)
    if x.size == 0 or "V" not in f:
        return
    nx, nz = 150, 190; xlim, zlim = limits(x, 0.01), limits(z, 0.01)
    grid = np.full((nz, nx), np.nan); count = np.zeros_like(grid)
    ix = np.clip(((x - xlim[0]) / (xlim[1] - xlim[0]) * (nx - 1)).astype(int), 0, nx - 1)
    iz = np.clip(((z - zlim[0]) / (zlim[1] - zlim[0]) * (nz - 1)).astype(int), 0, nz - 1)
    for i, j, q in zip(ix, iz, f["V"]):
        if np.isfinite(q):
            if not np.isfinite(grid[j, i]): grid[j, i] = 0.0
            grid[j, i] += q; count[j, i] += 1
    grid[count > 0] /= count[count > 0]
    finite = grid[np.isfinite(grid)]
    if finite.size == 0: return
    lo, hi = float(np.min(finite)), float(np.max(finite)); levels = np.linspace(lo, hi, 12)
    img, d = new_canvas("Global equipotential contours", "Contours reconstructed from the direct COMSOL y=0 CutPlane export; coordinates in mm")
    box = axes(d, xlim, zlim, "x or rho (mm)", "z (mm)")
    # Background potential bins.
    for j in range(nz):
        for i in range(nx):
            q = grid[j, i]
            if np.isfinite(q):
                xa = xlim[0] + i / nx * (xlim[1] - xlim[0]); xb = xlim[0] + (i + 1) / nx * (xlim[1] - xlim[0])
                za = zlim[0] + j / nz * (zlim[1] - zlim[0]); zb = zlim[0] + (j + 1) / nz * (zlim[1] - zlim[0])
                p0, p1 = sx(xa, xlim, box), sx(xb, xlim, box); py0, py1 = sy(za, zlim, box), sy(zb, zlim, box)
                d.rectangle((p0, py1, p1 + 1, py0 + 1), fill=color(float(q), lo, hi, False))
    # Marching-square-lite edge marks: a dark segment wherever an adjacent
    # FE bin straddles a contour level.  It is a display contour, not a new
    # field solve.
    for level in levels[1:-1]:
        for j in range(nz - 1):
            for i in range(nx - 1):
                q = grid[j, i]; qx = grid[j, i + 1]; qz = grid[j + 1, i]
                if np.isfinite(q) and ((q - level) * (qx - level) < 0):
                    xa = xlim[0] + (i + 0.5) / nx * (xlim[1] - xlim[0]); za = zlim[0] + j / nz * (zlim[1] - zlim[0])
                    p = sx(xa, xlim, box); py = sy(za, zlim, box); d.line((p - 4, py, p + 4, py), fill="#263238", width=1)
                if np.isfinite(q) and np.isfinite(qz) and ((q - level) * (qz - level) < 0):
                    xa = xlim[0] + i / nx * (xlim[1] - xlim[0]); za = zlim[0] + (j + 0.5) / nz * (zlim[1] - zlim[0])
                    p = sx(xa, xlim, box); py = sy(za, zlim, box); d.line((p, py - 4, p, py + 4), fill="#263238", width=1)
    electrode_overlay(d, box, xlim, zlim); d.text((MARGIN[0], H - 52), "V (V); black marks are equipotential contour crossings", fill="#263238", font=F18); save(img, outdir / "potential_global_equipotential.png")


def read_history(root: Path, name: str) -> tuple[np.ndarray, np.ndarray] | None:
    path = root / "history" / name
    if not path.exists(): return None
    try: return read_particle_table(path)
    except (OSError, ValueError): return None


def trajectory_and_particle_figures(root: Path) -> None:
    qz_item, qx_item, qy_item = read_history(root, "qz_history.csv"), read_history(root, "qx_history.csv"), read_history(root, "qy_history.csv")
    kp_item, kt_item = read_history(root, "Kperp_eV_history.csv"), read_history(root, "Ktotal_eV_history.csv")
    if qz_item and qx_item and qy_item:
        t, qz = qz_item; _, qx = qx_item; _, qy = qy_item
        r = np.sqrt(qx * qx + qy * qy)
        # Downsample particle trajectories for readable overplotting.
        img, d = new_canvas("Centered-source particle trajectories", "COMSOL particle history; r and z in mm; first 40 finite tracks")
        mask = np.isfinite(qz) & np.isfinite(r)
        xx, yy = qz[mask], r[mask]
        box = axes(d, limits(xx), limits(yy), "z (mm)", "r (mm)")
        colors = ["#2F6B9A", "#D37B3B", "#3D8B72", "#B84A4A", "#8A5AA8"]
        for j in range(min(40, qz.shape[1])):
            good = np.isfinite(qz[:, j]) & np.isfinite(r[:, j])
            pts = [(sx(float(a), limits(xx), box), sy(float(b), limits(yy), box)) for a, b in zip(qz[good, j], r[good, j])]
            if len(pts) > 1: d.line(pts, fill=colors[j % len(colors)], width=2)
        for z0 in [26.5, 159.5, 382.5, 545.5]:
            if limits(xx)[0] <= z0 <= limits(xx)[1]:
                px = sx(z0, limits(xx), box); d.line((px, box[1], px, box[3]), fill="#B84A4A", width=2)
        save(img, FIG / "particle" / "centered_trajectories_rz.png")
        # Transverse projection for beam-spot / guiding-center inspection.
        img2, d2 = new_canvas("Centered-source transverse trajectories", "x-y projection; finite tracks only; aperture radius is shown for reference")
        xx2, yy2 = qx[np.isfinite(qx)], qy[np.isfinite(qy)]; box2 = axes(d2, limits(xx2), limits(yy2), "x (mm)", "y (mm)")
        for j in range(min(60, qx.shape[1])):
            good = np.isfinite(qx[:, j]) & np.isfinite(qy[:, j]); pts = [(sx(float(a), limits(xx2), box2), sy(float(b), limits(yy2), box2)) for a, b in zip(qx[good, j], qy[good, j])]
            if len(pts) > 1: d2.line(pts, fill=colors[j % len(colors)], width=2)
        save(img2, FIG / "particle" / "centered_trajectories_xy.png")
    if kp_item and kt_item:
        t, kp = kp_item; _, kt = kt_item
        # Plot P10/P50/P90 envelopes at each output time.
        p10, p50, p90 = [], [], []
        for i in range(kp.shape[0]):
            vals = kp[i, np.isfinite(kp[i])]
            p10.append(np.percentile(vals, 10) if vals.size else np.nan); p50.append(np.percentile(vals, 50) if vals.size else np.nan); p90.append(np.percentile(vals, 90) if vals.size else np.nan)
        line_plot(FIG / "particle" / "energy_history_Kperp.png", "Transverse cooling history", "500-particle COMSOL history; solid lines are P10/P50/P90", t * 1e9, [(np.array(p10), "K⊥ P10 (eV)", "#2F6B9A"), (np.array(p50), "K⊥ P50 (eV)", "#D37B3B"), (np.array(p90), "K⊥ P90 (eV)", "#B84A4A")], "time (ns)", "K⊥ (eV)", ylog=True)
        total50 = np.array([np.percentile(kt[i, np.isfinite(kt[i])], 50) if np.any(np.isfinite(kt[i])) else np.nan for i in range(kt.shape[0])])
        line_plot(FIG / "particle" / "energy_history_total.png", "Total kinetic-energy history", "Ktotal from individual COMSOL tracks; no μ decay weight applied", t * 1e9, [(total50, "Ktotal P50 (eV)", "#3D8B72")], "time (ns)", "Ktotal (eV)", ylog=True)
    e_item, p_item, u_item = read_history(root, "E_total_local_history.csv"), read_history(root, "P_E_history.csv"), read_history(root, "U_mu_eV_history.csv")
    if e_item and p_item:
        t, E = e_item; _, P = p_item
        medE = np.nanmedian(E, axis=1); medP = np.nanmedian(P, axis=1)
        line_plot(FIG / "particle" / "field_effect_history.png", "Electric-field effect along particle tracks", "Median of finite tracks; PE=qμ E·v is instantaneous work power", t * 1e9, [(medE, "|E| (V/m)", "#2F6B9A"), (medP, "PE (W)", "#D37B3B")], "time (ns)", "field / power (mixed units)", ylog=True)
    if u_item:
        t, U = u_item
        medU = np.nanmedian(U, axis=1)
        line_plot(FIG / "particle" / "potential_energy_history.png", "μ− potential-energy history", "Uμ=qμ(V−V1); static-field diagnostic, not a decay model", t * 1e9, [(medU, "Uμ (eV)", "#3D8B72")], "time (ns)", "Uμ (eV)")


def scan_figures() -> None:
    rows = read_csv_rows(TABLES / "cooling_density_summary.csv")
    if rows:
        rows = sorted(rows, key=lambda r: float(r["density_m^-3"]) if r["density_m^-3"] not in ("nan", "") else 0)
        n = np.array([float(r["density_m^-3"]) for r in rows]); p90 = np.array([float(r["P90_Kperp_end_eV"]) for r in rows]); t90 = np.array([float(r["P90_t10_ns_censored_at_100"]) for r in rows])
        line_plot(FIG / "scans" / "neon_number_density_radial_cooling_time.png", "Ne density versus radial cooling time", "Phase A: P90 t10; censored at 100 ns when threshold was not reached", n, [(t90, "P90 t10 (ns)", "#2F6B9A")], "Ne number density (m⁻³)", "P90 radial-cooling time (ns)")
        line_plot(FIG / "scans" / "neon_number_density_Kperp.png", "Ne density versus residual transverse energy", "Phase A: P90 K⊥ at 100 ns; 10-eV acceptance line is shown in report", n, [(p90, "P90 K⊥ at 100 ns (eV)", "#D37B3B")], "Ne number density (m⁻³)", "P90 K⊥ at 100 ns (eV)", ylog=True)
        # fraction crossing
        frac = np.array([float(r["fraction_t10_reached"]) for r in rows])
        line_plot(FIG / "scans" / "neon_number_density_threshold_fraction.png", "Ne density versus threshold fraction", "Fraction of 500 tracks reaching K⊥≤10 eV by 100 ns", n, [(frac, "fraction reached", "#3D8B72")], "Ne number density (m⁻³)", "fraction")
    # Compare every available transport root (actual values only).
    roots = [TABLES / "transport_lowfield_1e24_a60_v2", TABLES / "transport_lowfield_1e24_a60", TABLES / "transport_highfield_10_v2", TABLES / "transport_highfield_10", TABLES / "transport_candidate10_gap40_a70"]
    data = []
    for root in roots:
        rr = reduce_transport(root)
        if rr: data.extend(rr)
    if data:
        labels = [Path(str(r["case_directory"])).name for r in data]
        metrics = [("T_geom", "transport rate", "#2F6B9A"), ("P90_t_exit_ns", "P90 exit time (ns)", "#D37B3B"), ("mean_Ktotal_exit_eV", "mean Kexit (eV)", "#3D8B72")]
        img, d = new_canvas("Baseline/candidate/final comparison", "Only completed COMSOL roots are shown; missing exits remain NaN")
        x0, y0, x1, y1 = plot_box(d); boxw = (x1 - x0) / max(1, len(data)); ymax = 1.0
        vals = np.array([float(r.get("T_geom", np.nan)) for r in data]); vals = np.where(np.isfinite(vals), vals, 0)
        d.rectangle((x0, y0, x1, y1), outline="#637381", width=2)
        for i, (lab, val) in enumerate(zip(labels, vals)):
            px = int(x0 + (i + 0.5) * boxw); top = int(y1 - val / ymax * (y1 - y0)); d.rectangle((px - 35, top, px + 35, y1), fill="#2F6B9A")
            d.text((px - 45, y1 + 15), lab[:16], fill="#263238", font=F18); d.text((px - 22, top - 30), f"{val:.2f}", fill="#17324D", font=F18)
        d.text((x0, y1 + 55), "case", fill="#263238", font=F20); d.text((25, y0 + 100), "Tgeom", fill="#263238", font=F20)
        save(img, FIG / "scans" / "baseline_candidate_final_comparison.png")


def density_field_figures() -> None:
    # Build a sparse, honest density×field diagnostic from completed field
    # exports.  E/N is reported in Td (1 Td = 1e−21 V m²); no breakdown
    # threshold is imposed because this model is not a Paschen/discharge solve.
    cases = [(1e24, TABLES / "transport_lowfield_1e24_a60_v2", "low field"), (1e24, TABLES / "transport_highfield_10_v2", "high field")]
    xs, ys, tvals, kvals, means, sigmas, joint = [], [], [], [], [], [], []
    for n, root, _ in cases:
        a = read_numeric_rows(root / "field" / "field_summary_comsol.csv")
        if a.size == 0 or a.shape[1] < 5: continue
        E23 = a[0, 4]
        row = next((r for r in reduce_transport(root)), None)
        xs.append(n); ys.append(E23); tvals.append(float(row["P90_t_exit_ns"]) if row and np.isfinite(float(row["P90_t_exit_ns"])) else np.nan); kvals.append(float(row["T_geom"]) if row else np.nan); means.append(float(row["mean_Ktotal_exit_eV"]) if row and np.isfinite(float(row["mean_Ktotal_exit_eV"])) else np.nan); sigmas.append(float(row["std_Ktotal_exit_eV"]) if row and np.isfinite(float(row["std_Ktotal_exit_eV"])) else np.nan); joint.append(1.0 if row and bool(row.get("joint_pass", False)) else 0.0)
    if xs:
        x, y = np.array(xs), np.array(ys); heatmap(FIG / "scans" / "density_x_field_P90_exit_time.png", "Density × field: exit-time diagnostic", "Sparse actual samples; y is C23 average |Ez| (V/m); blank cells are unsolved", x, y, np.array(tvals), "Ne density (m⁻³)", "C23 average |Ez| (V/m)", "P90 t_exit (ns)", overlay="No Paschen/breakdown threshold is asserted in this study")
        heatmap(FIG / "scans" / "density_x_field_transport_rate.png", "Density × field: geometric transmission", "Sparse actual samples; 0 means no particle reached the exit in the completed run", x, y, np.array(kvals), "Ne density (m⁻³)", "C23 average |Ez| (V/m)", "Tgeom", overlay="Acceptance boundary: Tgeom > 0.75")
        heatmap(FIG / "scans" / "density_x_field_mean_Kexit.png", "Density × field: mean exit energy", "Sparse actual samples; NaN means no exit sample", x, y, np.array(means), "Ne density (m⁻³)", "C23 average |Ez| (V/m)", "mean Kexit (eV)", overlay="Target centre: 1000 eV ± 50 eV")
        heatmap(FIG / "scans" / "density_x_field_sigma_Kexit.png", "Density × field: exit-energy spread", "Sparse actual samples; NaN means no exit sample", x, y, np.array(sigmas), "Ne density (m⁻³)", "C23 average |Ez| (V/m)", "sigma Kexit (eV)", overlay="Acceptance: sigma Kexit ≤ 50 eV")
        heatmap(FIG / "scans" / "density_x_field_joint_pass.png", "Density × field: joint acceptance", "1 only when all formal criteria pass; sparse actual samples", x, y, np.array(joint), "Ne density (m⁻³)", "C23 average |Ez| (V/m)", "joint pass (0/1)", overlay="P90 time, Tgeom, energy centre/spread, and Kperp are all required")
        EN = y / x * 1e21
        line_plot(FIG / "scans" / "density_x_field_EN.png", "E/N diagnostic", "E/N in Td; diagnostic only, not a breakdown probability", x, [(EN, "C23 |Ez|/N (Td)", "#B84A4A")], "Ne density (m⁻³)", "E/N (Td)")


def electric_field_figures() -> None:
    """Plot field-strength versus acceleration diagnostics from completed runs."""
    roots = [TABLES / "transport_lowfield_1e24_a60_v2", TABLES / "transport_lowfield_1e24_a60", TABLES / "transport_highfield_10_v2", TABLES / "transport_highfield_10"]
    labels, e23, acc_time, vz_end = [], [], [], []
    for root in roots:
        summary = read_numeric_rows(root / "field" / "field_summary_comsol.csv")
        vz_item = read_history(root, "vz_history.csv")
        qz_item = read_history(root, "qz_history.csv")
        if summary.size == 0 or summary.shape[1] < 5 or vz_item is None or qz_item is None:
            continue
        t, vz = vz_item; _, qz = qz_item
        labels.append(root.name); e23.append(float(summary[0, 4]))
        # Define an acceleration time operationally as first crossing of the
        # V2 plane, if any; otherwise use a censored 100 ns value.
        crossing = []
        for j in range(qz.shape[1]):
            ii = np.flatnonzero(np.isfinite(qz[:, j]) & (qz[:, j] >= 158.0))
            crossing.append(t[ii[0]] * 1e9 if ii.size else 100.0)
        acc_time.append(float(np.nanmedian(crossing)))
        vz_end.append(float(np.nanmedian(vz[-1])))
    if len(e23) >= 1:
        x = np.array(e23); order = np.argsort(x); x = x[order]
        line_plot(FIG / "scans" / "electric_field_strength_acceleration_time.png", "Electric-field strength versus acceleration time", "C23 average |Ez| from COMSOL field summaries; 100 ns is a censoring limit", x, [(np.array(acc_time)[order], "median V2-crossing time (ns)", "#D37B3B")], "C23 average |Ez| (V/m)", "acceleration / V2-crossing time (ns)")
        line_plot(FIG / "scans" / "electric_field_strength_axial_velocity.png", "Electric-field strength versus axial velocity", "Median final vz of finite particle tracks; no decay weighting", x, [(np.array(vz_end)[order], "median vz at 100 ns (m/s)", "#2F6B9A")], "C23 average |Ez| (V/m)", "axial velocity (m/s)")


def aperture_reference() -> None:
    # Only aperture=60 mm has a completed COMSOL field export so far.  Keep a
    # planned sweep image to make the missing parameter space visible.
    img, d = new_canvas("Aperture effect on local peak field", "Completed COMSOL point: 60-mm aperture; other points are intentionally pending")
    x0, y0, x1, y1 = plot_box(d); d.rectangle((x0, y0, x1, y1), outline="#637381", width=2)
    apertures = [30, 40, 50, 60]; maxe = np.nan
    a = read_numeric_rows(TABLES / "transport_lowfield_1e24_a60_v2" / "field" / "field_summary_comsol.csv")
    if a.size and a.shape[1] >= 3: maxe = a[0, 2]
    for i, ap in enumerate(apertures):
        px = int(x0 + (i + 0.5) / len(apertures) * (x1 - x0)); d.text((px - 15, y1 + 20), str(ap), fill="#263238", font=F18)
        if ap == 60 and np.isfinite(maxe):
            top = int(y1 - 0.75 * (y1 - y0)); d.rectangle((px - 45, top, px + 45, y1), fill="#D37B3B"); d.text((px - 50, top - 30), f"{maxe:.2g}", fill="#17324D", font=F18)
        else:
            d.rectangle((px - 45, y1 - 10, px + 45, y1), outline="#AAB4BE", width=2); d.text((px - 25, y1 - 45), "pending", fill="#7C8791", font=F18)
    d.text((x0, y1 + 58), "aperture diameter (mm)", fill="#263238", font=F20); d.text((20, y0 + 100), "peak |E| (V/m)", fill="#263238", font=F20)
    save(img, FIG / "scans" / "aperture_peak_field_reference.png")


def aperture_maps(field_path: Path) -> None:
    """Export V1--V4 local aperture maps from the same FE field table."""
    x, z, f = field_arrays(field_path)
    if x.size == 0: return
    for i, z0 in enumerate((26.5, 159.5, 382.5, 545.5), 1):
        mask = (abs(z - z0) <= 5.0) & (abs(x) >= 10.0) & (abs(x) <= 25.0)
        if not np.any(mask): continue
        tmp = TABLES / "_tmp_centered_aperture.csv"
        with tmp.open("w", encoding="utf-8") as h:
            for row in zip(x[mask], np.zeros(np.sum(mask)), z[mask], f["V"][mask], f["Ex"][mask], f["Ey"][mask], f["Ez"][mask], f["E"][mask], f["Eperp"][mask], f["U"][mask]): h.write(",".join(map(str, row)) + "\n")
        field_map(tmp, FIG / "field" / "apertures" / "linear", f"V{i}_aperture_E_linear", "E", False, False)
        field_map(tmp, FIG / "field" / "apertures" / "log", f"V{i}_aperture_E_log", "E", True, False)
        field_map(tmp, FIG / "field" / "apertures" / "linear", f"V{i}_aperture_Ez_linear", "Ez", False, True)
        field_map(tmp, FIG / "field" / "apertures" / "log", f"V{i}_aperture_Ez_log", "Ez", True, False)
        field_map(tmp, FIG / "field" / "apertures" / "linear", f"V{i}_aperture_Er_linear", "Er", False, True)
        field_map(tmp, FIG / "field" / "apertures" / "log", f"V{i}_aperture_Er_log", "Er", True, False)
        try: tmp.unlink()
        except OSError: pass


def main() -> None:
    # Identify a solved field root; high-field 10-particle contains the most
    # informative acceleration fringe field, while lowfield carries 500-track
    # transport statistics.
    field_root = TABLES / "transport_highfield_10_v2"
    if not (field_root / "field" / "field_global_xz.csv").exists():
        field_root = TABLES / "transport_lowfield_1e24_a60_v2"
    field_path = field_root / "field" / "field_global_xz.csv"
    if field_path.exists():
        overall = FIG / "field" / "overall"
        for key, signed in [("E", False), ("Ez", True), ("Er", True), ("Eperp", False)]:
            field_map(field_path, overall / "linear", f"overall_{key}_linear", key, False, signed)
            field_map(field_path, overall / "log", f"overall_{key}_log", key, True, False)
        potential_plot(field_path, FIG / "potential")
        equipotential_plot(field_path, FIG / "potential")
        aperture_maps(field_path)
        # Each cavity is a real-coordinate subset of the same FE export.
        x, z, f = field_arrays(field_path)
        cavities = {"C0": (0, 25), "C12": (28, 158), "C23": (161, 381), "C34": (384, 544), "C4": (547, 597)}
        for name, (za, zb) in cavities.items():
            mask = (z >= za) & (z <= zb)
            if np.any(mask):
                # Write a temporary reduced field table in memory by drawing
                # directly through the common renderer using the original
                # exported coordinate range.
                for key, signed in [("E", False), ("Ez", True), ("Er", True)]:
                    # Create a small synthetic CSV only for the renderer's
                    # stable parser; it is derived from FE data, not a model.
                    tmp = TABLES / "_tmp_centered_cavity.csv"
                    with tmp.open("w", encoding="utf-8") as h:
                        for row in zip(x[mask], np.zeros(np.sum(mask)), z[mask], f["V"][mask], f["Ex"][mask], f["Ey"][mask], f["Ez"][mask], f["E"][mask], f["Eperp"][mask], f["U"][mask]):
                            h.write(",".join(map(str, row)) + "\n")
                    field_map(tmp, FIG / "field" / "cavities" / "linear", f"{name}_{key}_linear", key, False, signed)
                    field_map(tmp, FIG / "field" / "cavities" / "log", f"{name}_{key}_log", key, True, False)
                try: tmp.unlink()
                except OSError: pass
    trajectory_and_particle_figures(TABLES / "transport_lowfield_1e24_a60_v2")
    scan_figures(); density_field_figures(); electric_field_figures(); aperture_reference()
    # Source-distribution plot using the deterministic companion CSV.
    source = ROOT / "data" / "centered_source" / "centered_release_500_seed20260907_z93mm_nominal.csv"
    rows = read_csv_rows(source)
    if rows:
        k = np.array([float(r["K0_eV"]) for r in rows]); th = np.array([float(r["theta_deg"]) for r in rows]); gc = np.array([float(r["guiding_center_r_m"]) * 1000 for r in rows])
        line_plot(FIG / "scans" / "source_K_theta_distribution.png", "Centered Larmor-source release distribution", "500 particles; K σ=5 keV, 2-D angle σ=9° (total RMS ≈9°); >3σ rejected", k, [(th, "direction θ (deg)", "#2F6B9A"), (gc, "guiding-center r (mm)", "#D37B3B")], "initial K (eV)", "value")
    print("CENTERED_FIGURES_COMPLETE")


if __name__ == "__main__":
    main()
