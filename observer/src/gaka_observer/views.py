"""Image views for the Critic (concept section 10, steps 2-4): thumbnail, crop, change region."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class RatioBox:
    """A region in 0..1 ratios, matching the DSL's resolution-independent coordinates."""

    x: float
    y: float
    w: float
    h: float


def thumbnail(img: Image.Image, max_side: int = 256) -> Image.Image:
    out = img.convert("RGB")
    out.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return out


def crop(img: Image.Image, box: RatioBox) -> Image.Image:
    """Crop to `box`, clamped to the image. Always at least 1x1, even for x=1 or y=1."""
    left = min(img.width - 1, max(0, round(box.x * img.width)))
    top = min(img.height - 1, max(0, round(box.y * img.height)))
    right = min(img.width, left + max(1, round(box.w * img.width)))
    bottom = min(img.height, top + max(1, round(box.h * img.height)))
    return img.crop((left, top, right, bottom))


def change_bbox(before: Image.Image, after: Image.Image, threshold: int = 8) -> RatioBox | None:
    """Bounding box of pixels that changed by more than `threshold` (0-255). None if unchanged."""
    if before.size != after.size:
        raise ValueError(f"size mismatch: {before.size} vs {after.size}")
    a = np.asarray(before.convert("RGB"), dtype=np.int16)
    b = np.asarray(after.convert("RGB"), dtype=np.int16)
    changed = np.abs(a - b).max(axis=2) > threshold
    if not changed.any():
        return None
    ys, xs = np.nonzero(changed)
    w, h = before.size
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    return RatioBox(x=x0 / w, y=y0 / h, w=(x1 - x0) / w, h=(y1 - y0) / h)
