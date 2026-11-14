"""Numeric feedback (concept section 10, step 1): text the Critic can read without image tokens."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import numpy.typing as npt
from PIL import Image

FloatArray = npt.NDArray[np.float64]

# Rec. 709 luma weights on gamma-encoded values: cheap and stable, good enough for feedback.
_LUMA = np.array([0.2126, 0.7152, 0.0722])
_EDGE_THRESHOLD = 0.08


@dataclass(frozen=True)
class Metrics:
    width: int
    height: int
    luminance_mean: float
    luminance_std: float
    saturation_mean: float
    edge_density: float
    luminance_histogram: list[float]
    grid_luminance: list[list[float]]
    dominant_colors: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _rgb(img: Image.Image) -> FloatArray:
    return np.asarray(img.convert("RGB"), dtype=np.float64) / 255.0


def _saturation(rgb: FloatArray) -> FloatArray:
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0.0)


def _edge_density(lum: FloatArray) -> float:
    gx = np.abs(np.diff(lum, axis=1))[:-1, :]
    gy = np.abs(np.diff(lum, axis=0))[:, :-1]
    mag = np.hypot(gx, gy)
    return float((mag > _EDGE_THRESHOLD).mean()) if mag.size else 0.0


def _grid(lum: FloatArray, n: int = 3) -> list[list[float]]:
    h, w = lum.shape
    rows = [(r * h // n, (r + 1) * h // n) for r in range(n)]
    cols = [(c * w // n, (c + 1) * w // n) for c in range(n)]
    return [[round(float(lum[r0:r1, c0:c1].mean()), 4) for c0, c1 in cols] for r0, r1 in rows]


def _dominant_colors(rgb: FloatArray, k: int = 5) -> list[dict[str, Any]]:
    # Quantize to 4 bits per channel; deterministic and dependency-free (no k-means).
    q = (rgb * 15).round().astype(np.int64)
    codes = (q[..., 0] << 8) | (q[..., 1] << 4) | q[..., 2]
    values, counts = np.unique(codes.ravel(), return_counts=True)
    order = np.argsort(-counts, kind="stable")[:k]
    total = codes.size
    out = []
    for i in order:
        c = int(values[i])
        r, g, b = ((c >> 8) & 15) * 17, ((c >> 4) & 15) * 17, (c & 15) * 17
        out.append({"hex": f"#{r:02x}{g:02x}{b:02x}", "share": round(float(counts[i]) / total, 4)})
    return out


def compute_metrics(img: Image.Image) -> Metrics:
    rgb = _rgb(img)
    lum = rgb @ _LUMA
    hist, _ = np.histogram(lum, bins=8, range=(0.0, 1.0))
    return Metrics(
        width=img.width,
        height=img.height,
        luminance_mean=round(float(lum.mean()), 4),
        luminance_std=round(float(lum.std()), 4),
        saturation_mean=round(float(_saturation(rgb).mean()), 4),
        edge_density=round(_edge_density(lum), 4),
        luminance_histogram=[round(float(v) / lum.size, 4) for v in hist],
        grid_luminance=_grid(lum),
        dominant_colors=_dominant_colors(rgb),
    )
