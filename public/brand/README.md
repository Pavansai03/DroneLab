# Brand assets

**`logo-mark.png` is the file the applications use.** Transparent PNG, the RU
emblem with the RajUddan wordmark beneath it.

It appears in the portal's top bar on every page, larger on the login screen, on
both approval screens, in the simulator's top bar, on the assembly platform, and
as the browser tab icon. Replace this one file and all of them change; nothing
references any other name.

Two things it must be:

- **Transparent.** It is placed on white cards, on a translucent top bar and on
  a pale 3D platform. An opaque background shows as a rectangle behind the mark
  on every one of them.
- **Cropped to the ink.** Empty margin inside the file is wasted space
  everywhere it is drawn — on the platform the decal is sized to the file, so a
  quarter of blank border made the logo a quarter smaller than it should be.

## If you only have an opaque version

`scripts/make-logo-mark.py` converts one. Put the opaque file at
`public/brand/logo.png` and run:

    python scripts/make-logo-mark.py

It knocks out the light background with a soft threshold so curved edges stay
smooth, crops to the ink, and writes `logo-mark.png`. It needs Pillow, which is
not a dependency of anything else here — it is a one-off tool, not part of the
build.

`logo.png` is only ever an input. It is not served and nothing reads it at
runtime, so it does not need to be in the repository.
