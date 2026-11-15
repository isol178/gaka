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

    o = sub.add_parser(
        "observe",
        help="everything one Critic observation needs, in one process (metrics + requested views)",
    )
    o.add_argument("image", type=Path)
    o.add_argument("out_dir", type=Path)
    o.add_argument("--thumbnail", action="store_true", help="write thumbnail.png")
    o.add_argument("--max-side", type=int, default=256)
    o.add_argument("--focus", type=float, nargs=4, metavar=("X", "Y", "W", "H"))
    o.add_argument("--previous", type=Path, help="diff against this image and crop the change")
    return p


def _observe(args: argparse.Namespace) -> dict[str, object]:
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    result: dict[str, object] = {}
    with Image.open(args.image) as img:
        result["metrics"] = compute_metrics(img).to_dict()
        if args.thumbnail:
            path = out_dir / "thumbnail.png"
            thumbnail(img, args.max_side).save(path)
            result["thumbnail"] = str(path)
        if args.focus:
            path = out_dir / "focus.png"
            crop(img, RatioBox(*args.focus)).save(path)
            result["focus"] = str(path)
        if args.previous:
            with Image.open(args.previous) as prev:
                box = change_bbox(prev, img)
            result["changed_region"] = asdict(box) if box else None
            if box:
                path = out_dir / "changed.png"
                crop(img, box).save(path)
                result["changed"] = str(path)
    return result


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
    elif args.cmd == "observe":
        result = _observe(args)
    else:
        with Image.open(args.before) as a, Image.open(args.after) as b:
            box = change_bbox(a, b)
            result = {"changed": box is not None, "box": asdict(box) if box else None}
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
