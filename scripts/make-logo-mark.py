#!/usr/bin/env python3
"""
Derive a transparent logo from the supplied artwork.

    python scripts/make-logo-mark.py

Reads  public/brand/logo.png   (the artwork as supplied — never modified)
Writes public/brand/logo-mark.png  (the same mark on transparency)

WHY
---
The supplied file is RGB with no alpha, on a light grey ground of about
#ECECEE. That is invisible against a photograph and perfectly fine on the 3D
platform, where it is composited onto a white tile anyway — but on a web page
it renders as a faint grey rectangle behind the mark, and it shows on every
card, every top bar and every white background in the portal.

Rather than edit the original, this derives a second file. The original stays
the source of truth; delete the derived one and everything falls back to it.

HOW
---
The mark is deep green and olive; the ground is near-white. Those are far
enough apart that a luminance threshold separates them cleanly, with a soft
band between so edges stay anti-aliased instead of going to jagged pixels.

Re-run it whenever the logo changes. It is not part of the build: it needs
Pillow, which is not a dependency of anything else here, and a logo changes
about once a year.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "brand" / "logo.png"
OUT = ROOT / "public" / "brand" / "logo-mark.png"

# Fully opaque at or below SOLID, fully transparent at or above CLEAR, and a
# linear ramp between — that ramp is what keeps the curved edges smooth.
SOLID = 190
CLEAR = 225


def main() -> int:
    if not SRC.exists():
        print(f"no artwork at {SRC}")
        return 1

    im = Image.open(SRC).convert("RGBA")
    px = im.load()
    w, h = im.size

    knocked = 0
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if lum >= CLEAR:
                px[x, y] = (r, g, b, 0)
                knocked += 1
            elif lum > SOLID:
                a = int(255 * (CLEAR - lum) / (CLEAR - SOLID))
                px[x, y] = (r, g, b, a)

    # Crop to what is left, so the mark has no dead margin to centre against.
    box = im.getbbox()
    if box:
        im = im.crop(box)

    im.save(OUT)
    pct = 100 * knocked / (w * h)
    print(f"{SRC.name} {w}x{h} -> {OUT.name} {im.size[0]}x{im.size[1]}")
    print(f"  {pct:.0f}% of pixels were background and are now transparent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
