import * as THREE from "three";
import { makeMarkTexture, MARK_ASPECT } from "./brand.js";

/**
 * THE ASSEMBLY PLATFORM
 * =====================
 * The original eight-sided podium, exactly as it was, with the RajUddan mark
 * repeated across its surface as a livery.
 *
 * WHY A PATTERN AND NOT A SIGN
 * ----------------------------
 * Everything tried before this put the brand somewhere you look AT: a board
 * behind the bench, a stripe round a raised drum, a strip of lettering on the
 * deck. All of them are signage, and signage on a floor has one correct reading
 * angle. This camera orbits without stopping, so for most of every rotation
 * that lettering was upside down.
 *
 * A repeated mark has no reading angle. It is a surface finish rather than a
 * label — the way a brand appears on a workshop floor, a pit lane or a court —
 * and it stays right whichever way the camera has come round.
 *
 * HOW THEY ARE ARRANGED
 * ---------------------
 * Three concentric rings with counts that share no common factor (7, 11, 15).
 * Equal counts would line the marks up into radial spokes, and spokes are the
 * one thing that makes a scatter look mechanical. The rings are also offset by
 * half a step, and each mark is turned toward the centre, so the pattern reads as
 * laid out rather than dropped.
 *
 * Sizes fall off toward the rim and so does opacity, which does two things: it
 * keeps the eye on the aircraft in the middle, and it stops the outer ring
 * fighting the podium's edge for attention.
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
  const mark = makeMarkTexture();
  if (mark) {
    disposables.push(mark.dispose);

    const RINGS = [
      { r: 1.16, n: 7, w: 0.8, o: 0.95, phase: 0 },
      { r: 1.8, n: 11, w: 0.72, o: 0.85, phase: Math.PI / 11 },
      { r: 2.32, n: 15, w: 0.6, o: 0.7, phase: Math.PI / 15 },
    ];

    for (const ring of RINGS) {
      const h = ring.w / MARK_ASPECT;
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(ring.w, h),
        new THREE.MeshBasicMaterial({
          map: mark.texture,
          transparent: true,
          opacity: ring.o,
          depthWrite: false,
        }),
        ring.n
      );

      const o = new THREE.Object3D();
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2 + ring.phase;

        /* Turned so its top points at the CENTRE, not away from it.
           This is the opposite of the obvious choice and it matters. The camera
           looks down and inward, so for the marks nearest it — the ones seen
           largest and least foreshortened — a top pointing outward is a top
           pointing at the viewer, which lands upside down on screen. Pointing
           inward puts those the right way up. The far side inverts instead, but
           those are smaller, more foreshortened and half behind the aircraft.

           The plane is laid flat by a -90 degree turn about X, which sends its
           local +Y to world -Z; this solves for the spin that then aims +Y down
           the inward radius. Worth deriving rather than guessing — an angle out
           by 90 degrees gives a ring of marks all facing one way, which reads
           as a mistake rather than as a pattern. */
        const spin = Math.atan2(Math.cos(a), Math.sin(a));

        o.position.set(Math.cos(a) * ring.r, DECAL_Y, Math.sin(a) * ring.r);
        o.rotation.set(-Math.PI / 2, 0, spin);
        o.scale.set(1, 1, 1);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 2;
      g.add(mesh);
    }
  }

  g.userData.dispose = () => disposables.forEach((d) => d());
  return g;
}
