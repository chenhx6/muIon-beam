"""Convert SolidWorks' lossless BMP previews to portable PNG copies."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
for bmp in (ROOT / "figures").glob("08_*.bmp"):
    with Image.open(bmp) as image:
        image.save(bmp.with_suffix(".png"), format="PNG", optimize=True)
for bmp in (ROOT / "figures").glob("09_*.bmp"):
    with Image.open(bmp) as image:
        image.save(bmp.with_suffix(".png"), format="PNG", optimize=True)
print("converted SolidWorks BMP previews to PNG")
