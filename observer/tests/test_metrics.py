from PIL import Image

from gaka_observer import compute_metrics


def test_flat_black_image() -> None:
    m = compute_metrics(Image.new("RGB", (32, 16), (0, 0, 0)))
    assert (m.width, m.height) == (32, 16)
    assert m.luminance_mean == 0.0
    assert m.luminance_std == 0.0
    assert m.edge_density == 0.0
    assert m.luminance_histogram[0] == 1.0
    assert m.dominant_colors == [{"hex": "#000000", "share": 1.0}]


def test_split_image_has_edges_and_contrast() -> None:
    img = Image.new("RGB", (40, 40), (255, 255, 255))
    img.paste((0, 0, 0), (0, 0, 20, 40))
    m = compute_metrics(img)
    assert 0.45 < m.luminance_mean < 0.55
    assert m.luminance_std > 0.4
    assert m.edge_density > 0
    assert m.grid_luminance[0][0] == 0.0
    assert m.grid_luminance[0][2] == 1.0


def test_saturation_distinguishes_gray_from_color() -> None:
    gray = compute_metrics(Image.new("RGB", (8, 8), (128, 128, 128)))
    red = compute_metrics(Image.new("RGB", (8, 8), (255, 0, 0)))
    assert gray.saturation_mean == 0.0
    assert red.saturation_mean == 1.0
