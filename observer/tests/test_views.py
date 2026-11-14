import json
from pathlib import Path

import pytest
from PIL import Image

from gaka_observer import change_bbox, crop, thumbnail
from gaka_observer.cli import main
from gaka_observer.views import RatioBox


def test_thumbnail_keeps_aspect() -> None:
    out = thumbnail(Image.new("RGB", (1024, 512)), 256)
    assert out.size == (256, 128)


def test_crop_uses_ratios() -> None:
    out = crop(Image.new("RGB", (200, 100)), RatioBox(0.5, 0.5, 0.25, 0.5))
    assert out.size == (50, 50)


def test_change_bbox_finds_modified_region() -> None:
    a = Image.new("RGB", (100, 100), (255, 255, 255))
    b = a.copy()
    b.paste((0, 0, 0), (10, 20, 30, 60))
    assert change_bbox(a, b) == RatioBox(0.1, 0.2, 0.2, 0.4)
    assert change_bbox(a, a.copy()) is None


def test_change_bbox_rejects_size_mismatch() -> None:
    with pytest.raises(ValueError, match="size mismatch"):
        change_bbox(Image.new("RGB", (2, 2)), Image.new("RGB", (3, 3)))


def test_cli_metrics_outputs_json(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "x.png"
    Image.new("RGB", (8, 8), (255, 255, 255)).save(path)
    assert main(["metrics", str(path)]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["luminance_mean"] == 1.0
