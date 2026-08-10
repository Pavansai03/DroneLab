import * as THREE from "three";

/**
 * THE BRAND MARK, AS A TEXTURE
 * ============================
 * Loads `public/brand/logo-mark.png` and hands back a three.js texture.
 *
 * NO FALLBACK, DELIBERATELY
 * -------------------------
 * This file used to carry a hand-drawn imitation of the logo — an "RU" set in
 * Georgia with three green bars for a wing — for the case where no artwork had
 * been supplied. That case is long past: the artwork is in the repository and
 * every surface loads it.
 *
 * The imitation stayed anyway, and it did the one thing a placeholder must
 * never do. It appeared on the assembly platform looking enough like a logo to
 * be taken for one, and the report that came back was "you changed the logo".
 * Nothing on screen said anything had failed, because the failure drew
 * something plausible.
 *
 * So there is no fallback now. Either the real mark loads, or nothing is drawn
 * and the console says why. A missing logo is a bug someone can see and report
 * accurately; a convincing fake is a bug that costs an afternoon.
 *
 * NO CANVAS, EITHER
 * -----------------
 * The mark is an image, and is now used as one. The canvas existed only to host
 * that drawing, and keeping it meant resizing a canvas after its texture had
 * already been uploaded to the GPU — which works, but is precisely the sort of
 * thing that works on one machine and not another. An Image mapped straight to
 * a texture has no such state to get wrong.
 */

/** RajUddan's greens, for anything else that needs to match the mark. */
export const DEEP = "#1d6b52";
export const LEAF = "#8ab52f";

/**
 * Load the mark.
 *
 * Resolves with `{ texture, aspect }`, or rejects if the file cannot be loaded.
 * The caller decides what to do about that — on the platform, nothing is drawn.
 *
 * The URL resolves against the app's base rather than the document: served from
 * /sim the document URL may or may not carry a trailing slash, and a bare
 * relative path silently resolves to the PORTAL's /brand/... in one of those
 * cases, which 404s.
 */
export function loadMarkTexture() {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return Promise.reject(new Error("no DOM"));
  }

  const url = `${import.meta.env.BASE_URL}brand/logo-mark.png`;

  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const texture = new THREE.Texture(img);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
      resolve({ texture, aspect: img.width / img.height });
    };

    img.onerror = () => {
      /* Loud on purpose. This used to be swallowed, and the drawn stand-in
         covered for it — so a genuinely broken asset looked like a choice. */
      console.error(
        `[brand] Could not load ${url}. The logo will not be drawn. ` +
          `Check that public/brand/logo-mark.png exists and is deployed.`
      );
      reject(new Error(`failed to load ${url}`));
    };

    img.src = url;
  });
}
