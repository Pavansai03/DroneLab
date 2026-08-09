import * as THREE from "three";
import { makeBrandBandTexture } from "./brand.js";

/**
 * THE ASSEMBLY PLATFORM
 * =====================
 * The thing the drone is built on: a raised, pale platform in the bay's own
 * light blue palette, with the RajUddan livery wrapped around its side.
 *
 * TWO EARLIER VERSIONS, BOTH WRONG
 * --------------------------------
 * The first was a flat eight-sided disc sitting almost flush with the floor. It
 * read as a marking painted on the ground rather than as a structure, because
 * nothing about it had any depth — no thickness worth seeing, no side to catch
 * the light, no shadow underneath.
 *
 * The second gave it depth but in dark machined metal, and put the brand on a
 * raked board bolted to a side console. That fixed the depth and broke
 * everything else: the bay is a bright, light-blue holographic space, and
 * dropping a slab of gunmetal into the middle of it made the whole scene look
 * like two different products. The board was worse — a sign standing next to
 * the bench is scenery, and scenery is the first thing the eye learns to skip.
 *
 * So: the depth stays, the palette goes back to the bay's own, and the brand is
 * ON the platform — a livery band wrapped round its side, the way a maker's
 * name goes on a machine rather than on a placard beside it. It repeats round
 * the platform, so it is readable wherever the orbiting camera happens to be.
 */

/** Top surface of the deck. Set by the aircraft above it; do not move. */
export const DECK_Y = -0.59;
/** Where the bay floor sits, well below, so the platform stands proud. */
export const FLOOR_Y = -1.78;

const DECK_R = 3.6;

export function buildHangarDais() {
  const g = new THREE.Group();
  g.name = "hangarDais";
  const disposables = [];

  const height = DECK_Y - FLOOR_Y;

  /* The bay's own palette: near-white surfaces with a blue cast, lifted from
     the podium this replaces (0xeef5fb) and the sky-blue floor grid. */
  const pale = (color, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.22, ...opts });

  /* ------------------------------------------------------------- drum */
  /* Band height and repeat count are chosen together. Wrapped at radius 3.44
     the platform is 21.6m round, so five repeats give each one 4.32m of width;
     at 0.62m tall that is 7.0:1, against the artwork's own 6.7:1. Get this
     wrong and the lettering is visibly stretched all the way round. */
  const BAND_H = 0.62;
  const drumTop = DECK_Y - 0.2;

  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(DECK_R - 0.24, DECK_R - 0.46, height, 64, 1, true),
    pale(0xdae7f2, { roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide })
  );
  drum.position.y = FLOOR_Y + height / 2;
  drum.receiveShadow = true;
  g.add(drum);

  /* Fluting below the band. Twenty-four ribs standing proud of the drum, which
     is what turns a smooth cylinder into something built — each takes a
     different amount of light, so the curve is legible rather than a flat band
     of one colour. */
  {
    const ribH = drumTop - BAND_H - FLOOR_Y - 0.1;
    if (ribH > 0.1) {
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.12, ribH, 0.3),
        pale(0xc3d6e8, { roughness: 0.45 }),
        24
      );
      const o = new THREE.Object3D();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const r = DECK_R - 0.33;
        o.position.set(Math.cos(a) * r, FLOOR_Y + 0.06 + ribH / 2, Math.sin(a) * r);
        o.rotation.set(0, -a, 0);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      g.add(mesh);
    }
  }

  /* ----------------------------------------------------- the livery band */
  /* Wrapped round the widest part of the side, just under the deck lip, where
     a stripe goes on a real machine. Unlit (MeshBasicMaterial) on purpose: the
     brand's greens are specified colours, and letting the bay's blue-white key
     light tint them would put the logo slightly off-brand from every angle. */
  const band = makeBrandBandTexture();
  if (band) {
    disposables.push(band.dispose);
    const bandMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(DECK_R - 0.16, DECK_R - 0.16, BAND_H, 96, 1, true),
      new THREE.MeshBasicMaterial({ map: band.texture, side: THREE.DoubleSide })
    );
    bandMesh.position.y = drumTop - BAND_H / 2;
    g.add(bandMesh);
  }

  /* ---------------------------------------------------------- deck top */
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(DECK_R, DECK_R, 0.18, 64),
    pale(0xeef5fb, { roughness: 0.38, metalness: 0.25 })
  );
  deck.position.y = DECK_Y - 0.09;
  deck.receiveShadow = true;
  deck.castShadow = true;
  g.add(deck);

  // A slightly deeper ring, so the launch pad reads as recessed into the deck.
  const inset = new THREE.Mesh(
    new THREE.CylinderGeometry(2.92, 2.92, 0.04, 64),
    pale(0xcfe0ee, { roughness: 0.55, metalness: 0.15 })
  );
  inset.position.y = DECK_Y - 0.005;
  inset.receiveShadow = true;
  g.add(inset);

  const bevel = new THREE.Mesh(
    new THREE.TorusGeometry(DECK_R - 0.01, 0.05, 10, 96),
    pale(0xffffff, { roughness: 0.2, metalness: 0.4 })
  );
  bevel.rotation.x = Math.PI / 2;
  bevel.position.y = DECK_Y - 0.03;
  g.add(bevel);

  /* An emissive line under the deck lip. Not a light source — it lights
     nothing — but it is the detail that makes a platform read as powered, and
     it costs one unlit ring rather than a shadow-casting lamp. */
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(DECK_R - 0.03, DECK_R - 0.07, 0.05, 64, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x46e6cf, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  glow.position.y = DECK_Y - 0.19;
  g.add(glow);

  g.userData.dispose = () => disposables.forEach((d) => d());
  return g;
}
