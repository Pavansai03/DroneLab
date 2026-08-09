# Brand assets

Save the RajUddan logo here as **`logo.png`**.

- Transparent PNG, square-ish, at least 512x512.
- It is drawn onto a white tile on the hangar sign in the assembly bay, so a
  logo with a transparent background and dark ink is exactly right — which is
  what the supplied artwork already is.

Until the file exists the sign draws a plain typeset fallback. That is
deliberate: a missing logo should be visibly missing, not silently absent, and
it must never stop the workshop rendering.

See `src/three/brand.js`.
