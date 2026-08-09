import * as THREE from "three";
import { makeBrandBandTexture, BAND_ASPECT } from "./brand.js";

/**
 * THE ASSEMBLY PLATFORM
 * =====================
 * The original eight-sided podium, exactly as it was, with the RajUddan mark
 * laid flat on its surface.
 *
 * WHAT WAS TRIED AND UNDONE
 * -------------------------
 * Two versions came between this and the one it restores. The first raised the
 * platform on a machined drum in dark metal — which fixed a complaint about it
 * looking flat and, in doing so, made the bay look like two different products
 * bolted together, because this is a bright light-blue holographic space and
 * that was gunmetal. The second kept the height but re-skinned it pale and
 * wrapped the brand round the side.
 *
 * Both were wrong about the same thing: the podium was never the problem. It is
 * the bench, it has been the bench from the beginning, and the whole scene is
 * composed around it sitting low and unobtrusive under the aircraft. So the
 * height is gone, the geometry and material are the originals to the decimal,
 * and the brand is where it was actually asked for — on top, flat, like the
 * markings on a helipad.
 *
 * TWO DECALS, NOT ONE
 * -------------------
 * The camera orbits continuously. A single decal reads correctly from one side
 * and upside down from the other, which is worse than not having it at all. So
 * there are two, front and back, each turned to face outward — the same reason
 * a real helipad paints its markings at both ends of the approach.
 */

/** Top surface of the podium. Set by the aircraft above it; do not move. */
export const DECK_Y = -0.59;
/** The bay floor, back where it always was. */
export const FLOOR_Y = -0.72;

export function buildHangarDais() {
  const g = new THREE.Group();
  g.name = "assemblyPlatform";
  const disposables = [];

  /* The original podium. Geometry, material, position and shadow flag are
     unchanged from the version this restores — copied rather than re-derived,
     so "put it back" means exactly that. */
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(2.7, 2.95, 0.14, 8),
    new THREE.MeshStandardMaterial({ color: 0xeef5fb, roughness: 0.4, metalness: 0.25 })
  );
  podium.position.y = -0.66;
  podium.receiveShadow = true;
  g.add(podium);

  /* ----------------------------------------------------- the markings */
  const brand = makeBrandBandTexture();
  if (brand) {
    disposables.push(brand.dispose);

    const W = 2.5;
    const H = W / BAND_ASPECT;

    /* Sits just above the hex launch pad at -0.585. A hundredth of a metre is
       enough to settle the depth test and far too little to read as floating —
       any less and the two surfaces flicker against each other as the camera
       moves, which is the one artefact nobody can ignore. */
    const Y = -0.575;

    for (const [z, turn] of [
      [1.72, 0],
      [-1.72, Math.PI],
    ]) {
      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(W, H),
        new THREE.MeshBasicMaterial({
          map: brand.texture,
          transparent: true,
          depthWrite: false,
        })
      );
      decal.rotation.x = -Math.PI / 2; // lie flat
      decal.rotation.z = turn; // face outward
      decal.position.set(0, Y, z);
      decal.renderOrder = 2;
      g.add(decal);
    }
  }

  g.userData.dispose = () => disposables.forEach((d) => d());
  return g;
}
