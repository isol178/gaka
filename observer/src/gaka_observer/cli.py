"""Command-line entry point. All output is JSON on stdout so any harness language can consume it."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from PIL import Image

from gaka_observer.metrics import compute_metrics
from gaka_observer.views import RatioBox, change_bbox, crop, thumbnail


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="gaka-observe")
    sub = p.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("metrics", help="numeric feedback for an image")
    m.add_argument("image", type=Path)

    t = sub.add_parser("thumbnail", help="write a downscaled copy")
    t.add_argument("image", type=Path)
    t.add_argument("out", type=Path)
    t.add_argument("--max-side", type=int, default=256)

    c = sub.add_parser("crop", help="write a crop given 0..1 ratios")
    c.add_argument("image", type=Path)
    c.add_argument("out", type=Path)
    for k in ("x", "y", "w", "h"):
        c.add_argument(f"--{k}", type=float, required=True)

    d = sub.add_parser("diff", help="bounding box of the changed region between two images")
    d.add_argument("before", type=Path)
    d.add_argument("after", type=Path)
    return p


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    result: object
    if args.cmd == "metrics":
        with Image.open(args.image) as img:
            result = compute_metrics(img).to_dict()
    elif args.cmd == "thumbnail":
        with Image.open(args.image) as img:
            out = thumbnail(img, args.max_side)
            out.save(args.out)
            result = {"path": str(args.out), "width": out.width, "height": out.height}
    elif args.cmd == "crop":
        with Image.open(args.image) as img:
            out = crop(img, RatioBox(args.x, args.y, args.w, args.h))
            out.save(args.out)
            result = {"path": str(args.out), "width": out.width, "height": out.height}
    else:
        with Image.open(args.before) as a, Image.open(args.after) as b:
            box = change_bbox(a, b)
            result = {"changed": box is not None, "box": asdict(box) if box else None}
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
