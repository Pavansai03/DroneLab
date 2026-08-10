import * as THREE from "three";
import { makeMarkTexture, MARK_ASPECT } from "./brand.js";

/**
 * THE ASSEMBLY PLATFORM
 * =====================
 * The original eight-sided podium, exactly as it was, with the RajUddan mark
 * filling its surface.
 *
 * WHY A PATTERN AND NOT A SIGN
 * ----------------------------
 * Everything tried before this put the brand somewhere you look AT: a board
 * behind the bench, a stripe round a raised drum, a strip of lettering on the
 * deck. All of them are signage standing beside the machine, and the machine is
 * what anyone is here to look at.
 *
 * The mark belongs ON the deck — the centre-circle logo of a court, not a
 * hoarding at the side of it.
 *
 * ONE MARK, NOT A PATTERN
 * -----------------------
 * A scatter of small marks came before this and read as wallpaper — busy, and
 * none of them large enough to be the logo rather than a texture. A single mark
 * filling the deck is the stronger statement, and the aircraft standing on top
 * of it is the point of the picture anyway.
 */

/** Top surface of the podium. Set by the aircraft above it; do not move. */
export const DECK_Y = -0.59;
/** The bay floor. */
export const FLOOR_Y = -0.72;

/* The hex launch pad sits at -0.585. A hundredth of a metre above it is enough
   to settle the depth test and far too little to read as floating — any less
   and the two surfaces flicker against each other as the camera moves. */
const DECAL_Y = -0.575;

export function buildHangarDais() {
  const g = new THREE.Group();
  g.name = "assemblyPlatform";
  const disposables = [];

  /* The original podium. Geometry, material, position and shadow flag copied
     from the version this restores rather than re-derived, so "put it back"
     means exactly that. */
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(2.7, 2.95, 0.14, 8),
    new THREE.MeshStandardMaterial({ color: 0xeef5fb, roughness: 0.4, metalness: 0.25 })
  );
  podium.position.y = -0.66;
  podium.receiveShadow = true;
  g.add(podium);

  /* ------------------------------------------------------- the livery */
  /* ONE mark, as large as the platform will hold.
     Sized from the pad's radius rather than picked by eye: a rectangle of the
     artwork's own proportions, scaled until its diagonal exactly meets the
     2.6m pad. That is the largest it can be without a corner hanging over the
     edge, and it is arithmetic rather than a guess, so it stays right if the
     artwork is ever replaced with one of different proportions. */
  /* Sized from the podium, and reshaped when the artwork reports its true
     proportions — see makeMarkTexture. The plane is built 1x1 and scaled, so
     replacing the logo with one of a different shape needs no code change.

     REACH is how far the rectangle's CORNERS may sit from the centre. It is
     deliberately larger than the octagon's 2.49m inradius: the corners of this
     artwork are empty, with ink reaching only 87% of the way into them, so the
     rectangle may overhang a little while the logo itself stays on the deck.
     2.85 x 0.87 = 2.48, which lands just inside. */
  const REACH = 2.85;

  const sizeFor = (aspect) => {
    // (w/2)^2 + (h/2)^2 = REACH^2, with h = w / aspect
    const w = (2 * REACH) / Math.sqrt(1 + 1 / (aspect * aspect));
    return [w, w / aspect];
  };

  let decal = null;
  const mark = makeMarkTexture((aspect) => {
    if (!decal) return;
    const [w, h] = sizeFor(aspect);
    decal.scale.set(w, h, 1);
  });

  if (mark) {
    disposables.push(mark.dispose);
    const [w, h] = sizeFor(MARK_ASPECT);

    decal = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: mark.texture,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    decal.scale.set(w, h, 1);

    /* Squared to where the camera starts (azimuth 35 degrees), so the mark is
       upright the moment the bay opens. With a single mark there is no
       orientation that is right from everywhere — the camera orbits — so the
       one to get right is the first one anybody sees. */
    decal.rotation.set(-Math.PI / 2, 0, (35 * Math.PI) / 180);
    decal.position.set(0, DECAL_Y, 0);
    decal.renderOrder = 2;
    g.add(decal);
  }

  g.userData.dispose = () => disposables.forEach((d) => d());
  return g;
}
