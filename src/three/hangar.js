import * as THREE from "three";
import { makeBrandTexture, BRAND_ASPECT, LEAF } from "./brand.js";

/**
 * THE ASSEMBLY DAIS
 * =================
 * The thing the drone is built on: a raised, machined platform with a lit rim
 * and a branded console projecting from one side.
 *
 * It replaces a flat 8-sided disc that sat almost flush with the floor. That
 * disc read as a marking painted on the ground rather than as a structure,
 * because nothing about it had any depth — no thickness worth seeing, no shadow
 * under it, no side to catch the light. A workshop bench is a solid object you
 * could walk around, and this now is one.
 *
 * HOW THE DEPTH IS FOUND
 * ----------------------
 * The deck cannot move: the aircraft, the placement slots and the launch pad
 * are all positioned against it, and raising it would lift the drone off its
 * own hardpoints. So the FLOOR drops instead. Everything above deck level is
 * where it always was, and the room simply falls away beneath it — which is
 * what makes the platform read as standing proud.
 *
 * THE CONSOLE
 * -----------
 * The brand lives on a raked face on the side extension, not on a sign behind
 * the bench. A sign is scenery you look past; the console is part of the
 * machine, the way a maker's plate is on a real one. Raked rather than vertical
 * because the camera orbits at a high polar angle and spends most of its time
 * looking down — a vertical panel would be edge-on for much of every rotation.
 */

/** Top surface of the deck. Set by the aircraft above it; do not move. */
export const DECK_Y = -0.59;
/** Where the bay floor now sits. */
export const FLOOR_Y = -1.78;

const DECK_R = 3.6;

function metal(color, { rough = 0.42, metal: m = 0.85, ...rest } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: m, ...rest });
}

export function buildHangarDais() {
  const g = new THREE.Group();
  g.name = "hangarDais";
  const disposables = [];

  const height = DECK_Y - FLOOR_Y; // 1.19

  /* ---------------------------------------------------------- the drum */
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(DECK_R - 0.22, DECK_R - 0.52, height, 64, 1, true),
    metal(0x2a3340, { rough: 0.55, metal: 0.7, side: THREE.DoubleSide })
  );
  drum.position.y = FLOOR_Y + height / 2;
  drum.receiveShadow = true;
  g.add(drum);

  /* Fluting. Twenty-four ribs standing proud of the drum, which is what turns a
     smooth cylinder into something machined — each one takes a different amount
     of light, so the curve is legible instead of being a flat grey band. */
  {
    const rib = new THREE.BoxGeometry(0.13, height * 0.86, 0.34);
    const mat = metal(0x39434f, { rough: 0.38 });
    const mesh = new THREE.InstancedMesh(rib, mat, 24);
    const o = new THREE.Object3D();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = DECK_R - 0.34;
      o.position.set(Math.cos(a) * r, FLOOR_Y + height * 0.47, Math.sin(a) * r);
      o.rotation.set(0, -a, 0);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    g.add(mesh);
  }

  /* ------------------------------------------------------- the deck top */
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(DECK_R, DECK_R, 0.16, 64),
    metal(0xb9c4d0, { rough: 0.34, metal: 0.78 })
  );
  deck.position.y = DECK_Y - 0.08;
  deck.receiveShadow = true;
  deck.castShadow = true;
  g.add(deck);

  // A darker inset ring, so the launch pad reads as recessed into the deck.
  const inset = new THREE.Mesh(
    new THREE.CylinderGeometry(2.92, 2.92, 0.035, 64),
    metal(0x6d7a88, { rough: 0.6, metal: 0.5 })
  );
  inset.position.y = DECK_Y - 0.005;
  inset.receiveShadow = true;
  g.add(inset);

  /* ---------------------------------------------------------- the light */
  /* An emissive band tucked under the deck lip. Not a light source — it lights
     nothing — but it is the single detail that makes a platform look powered,
     and it costs one unlit ring rather than a shadow-casting lamp. */
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(DECK_R - 0.05, DECK_R - 0.14, 0.075, 64, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x46e6cf, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  glow.position.y = DECK_Y - 0.2;
  g.add(glow);

  const bevel = new THREE.Mesh(
    new THREE.TorusGeometry(DECK_R - 0.01, 0.045, 10, 96),
    metal(0xd7dee6, { rough: 0.22, metal: 0.95 })
  );
  bevel.rotation.x = Math.PI / 2;
  bevel.position.y = DECK_Y - 0.02;
  g.add(bevel);

  /* --------------------------------------------------- the side console */
  /* Placed back-left. The camera orbits continuously, so there is no permanent
     front to avoid — but the transmitter stand sits front-left, and two objects
     competing for the same quarter of the deck is what makes a workshop look
     cluttered rather than equipped. */
  const console_ = new THREE.Group();
  const ANGLE = Math.PI * 0.72;
  console_.position.set(Math.cos(ANGLE) * (DECK_R - 0.3), 0, Math.sin(ANGLE) * (DECK_R - 0.3));
  console_.rotation.y = -ANGLE + Math.PI / 2;
  g.add(console_);

  const CW = 3.5; // width along the console
  const CD = 1.35; // how far it projects

  // The apron: a slab at deck height, extending outward.
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(CW, 0.15, CD),
    metal(0xa7b3c0, { rough: 0.36 })
  );
  apron.position.set(0, DECK_Y - 0.075, CD / 2);
  apron.castShadow = true;
  apron.receiveShadow = true;
  console_.add(apron);

  // Skirt below it, so the apron is a solid thing rather than a floating shelf.
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(CW - 0.18, 0.42, CD - 0.12),
    metal(0x2a3340, { rough: 0.55, metal: 0.7 })
  );
  skirt.position.set(0, DECK_Y - 0.36, CD / 2);
  console_.add(skirt);

  // Two legs to the floor.
  for (const x of [-CW / 2 + 0.45, CW / 2 - 0.45]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.095, DECK_Y - 0.57 - FLOOR_Y, 12),
      metal(0x8f9aa6, { rough: 0.4 })
    );
    leg.position.set(x, (DECK_Y - 0.57 + FLOOR_Y) / 2, CD - 0.28);
    leg.castShadow = true;
    console_.add(leg);
  }

  /* THE BRAND FACE.
     Raked back 32 degrees from vertical — near enough to horizontal to catch
     the orbiting camera's downward view for most of a rotation, steep enough
     that it still reads as a face rather than as a decal on the floor. */
  const brand = makeBrandTexture();
  const PANEL_W = CW - 0.5;
  const PANEL_H = PANEL_W / BRAND_ASPECT;

  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W, PANEL_H),
    brand
      ? new THREE.MeshStandardMaterial({ map: brand.texture, roughness: 0.45, metalness: 0.1 })
      : metal(0x1d6b52, { rough: 0.6, metal: 0.1 })
  );
  if (brand) disposables.push(brand.dispose);

  const RAKE = THREE.MathUtils.degToRad(58);
  panel.rotation.x = -RAKE;
  panel.position.set(0, DECK_Y + Math.cos(RAKE) * PANEL_H * 0.5 + 0.02, CD * 0.52 + Math.sin(RAKE) * PANEL_H * 0.5);
  console_.add(panel);

  // A frame around it, in the leaf green, so the panel is mounted rather than printed.
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(PANEL_W + 0.13, PANEL_H + 0.13, 0.05),
    new THREE.MeshStandardMaterial({ color: LEAF, roughness: 0.45, metalness: 0.35 })
  );
  frame.rotation.x = -RAKE;
  frame.position.copy(panel.position);
  frame.translateZ(-0.035);
  frame.castShadow = true;
  console_.add(frame);

  /* Bench detail on the apron in front of the panel: a couple of tool trays, so
     the console reads as a working surface and not a plinth for a logo. */
  const trayMat = metal(0x596574, { rough: 0.5 });
  for (const [x, w] of [
    [-CW / 2 + 0.62, 0.85],
    [CW / 2 - 0.62, 0.85],
  ]) {
    const tray = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.42), trayMat);
    tray.position.set(x, DECK_Y + 0.025, CD - 0.3);
    tray.castShadow = true;
    console_.add(tray);
  }

  g.userData.dispose = () => disposables.forEach((d) => d());
  return g;
}
