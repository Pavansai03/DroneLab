import * as THREE from "three";
import { GATES } from "../sim/flightSim.js";
import { cylinder, box } from "../sim/obstacles.js";

/**
 * FLIGHT FIELDS
 * =============
 * The scenery the drone flies through. Each builder returns a THREE.Group that
 * the scene drops in and out wholesale, so switching fields costs one add and
 * one dispose rather than rebuilding the world.
 *
 * These exist for more than decoration. Judging height and speed needs objects
 * of KNOWN size to judge against — an empty plane gives a pilot nothing, which
 * is exactly why real training fields have markers. So everything here is built
 * to a stated real-world scale: a storey is 3.2 m, a car is 4.4 m long, a person
 * is 1.7 m. A student who clears a six-storey roof has genuinely flown to 20 m.
 *
 * Both fields share a flat ground plane at y=0 and leave the area within ~12 m
 * of the origin clear, because that is where the launch pad and the first
 * mission gate live.
 *
 * COLLIDERS
 * ---------
 * Every solid thing a drone could hit also pushes an analytic collider onto
 * `g.userData.obstacles`, which the simulator queries each frame. Scenery and
 * collider are created in the same place on purpose: a tree that is drawn but
 * not registered is a tree you fly straight through, and keeping the two lines
 * adjacent is the only reliable way to stop that drifting apart.
 */

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Keep the mission course flyable.
 *
 * Scenery is scattered randomly, and a 22 m tree dropped on a gate at 8 m makes
 * that gate literally impossible to pass — the student would be failing at an
 * accident of the random seed, not at flying. So nothing tall is allowed within
 * this radius of a gate, or of the straight line between consecutive gates.
 */
const GATE_CLEARANCE = 9;

function nearGateCourse(x, z, pad = 0) {
  const r = GATE_CLEARANCE + pad;
  for (let i = 0; i < GATES.length; i++) {
    const g = GATES[i];
    if (Math.hypot(x - g.x, z - g.z) < r) return true;
    // Also keep the leg between this gate and the next one clear
    const n = GATES[i + 1];
    if (!n) continue;
    const dx = n.x - g.x;
    const dz = n.z - g.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) continue;
    let t = ((x - g.x) * dx + (z - g.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = g.x + dx * t;
    const pz = g.z + dz * t;
    if (Math.hypot(x - px, z - pz) < r * 0.75) return true;
  }
  return false;
}

/** Deterministic-ish scatter that never lands inside the launch clearing. */
function scatter(count, minR, maxR, fn) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(minR, maxR);
    fn(Math.cos(a) * r, Math.sin(a) * r, i);
  }
}

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.02, ...opts });

/* ==================================================================== */
/* FOREST                                                               */
/* ==================================================================== */

/** A conifer: tapered trunk with two or three stacked cones. */
function conifer(height) {
  const g = new THREE.Group();
  const trunkH = height * 0.34;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(height * 0.022, height * 0.045, trunkH, 7),
    mat(0x4a3826)
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);

  const shades = [0x1f5c34, 0x27693c, 0x2f7645];
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(height * (0.3 - t * 0.14), height * 0.34, 9),
      mat(shades[i % shades.length])
    );
    cone.position.y = trunkH + height * (0.14 + t * 0.26);
    cone.castShadow = true;
    g.add(cone);
  }
  return g;
}

/** A broadleaf: trunk with a cluster of overlapping spheres for the canopy. */
function broadleaf(height) {
  const g = new THREE.Group();
  const trunkH = height * 0.45;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(height * 0.035, height * 0.06, trunkH, 8),
    mat(0x5b4632)
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);

  const shades = [0x2c7a3f, 0x35894a, 0x256a36];
  const blobs = 4;
  for (let i = 0; i < blobs; i++) {
    const r = height * rand(0.16, 0.24);
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 7), mat(pick(shades)));
    const a = (i / blobs) * Math.PI * 2;
    blob.position.set(
      Math.cos(a) * height * 0.11,
      trunkH + height * rand(0.14, 0.26),
      Math.sin(a) * height * 0.11
    );
    blob.castShadow = true;
    g.add(blob);
  }
  return g;
}

/** A deer-ish quadruped. Low poly on purpose — it reads at 30 m, which is the point. */
function deer() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.9, 4, 8), mat(0x8a6440));
  body.rotation.z = Math.PI / 2;
  body.position.y = 1.0;
  body.castShadow = true;
  g.add(body);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.6, 6), mat(0x8a6440));
  neck.position.set(0.66, 1.35, 0);
  neck.rotation.z = -0.5;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.22), mat(0x7b5836));
  head.position.set(0.92, 1.6, 0);
  g.add(head);

  // Antlers, so it reads as a deer and not a dog
  [-1, 1].forEach((s) => {
    const antler = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.42, 5), mat(0x6b5230));
    antler.position.set(0.86, 1.85, s * 0.09);
    antler.rotation.z = 0.4;
    antler.rotation.x = s * 0.35;
    g.add(antler);
  });

  [-0.4, 0.4].forEach((x) =>
    [-0.22, 0.22].forEach((z) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.9, 5), mat(0x6f5133));
      leg.position.set(x, 0.45, z);
      g.add(leg);
    })
  );
  return g;
}

/** A grazing rabbit — small, for the low, slow passes. */
function rabbit() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 7), mat(0x9a8a76));
  body.position.y = 0.22;
  body.scale.set(1.4, 1, 1);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 7), mat(0xa6957f));
  head.position.set(0.26, 0.34, 0);
  g.add(head);
  [-1, 1].forEach((s) => {
    const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 3, 5), mat(0xa6957f));
    ear.position.set(0.24, 0.55, s * 0.07);
    g.add(ear);
  });
  return g;
}

/** A bird that circles slowly. Animated by the scene. */
function bird() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.3, 3, 6), mat(0x2c2f36));
  body.rotation.z = Math.PI / 2;
  g.add(body);
  [-1, 1].forEach((s) => {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.7), mat(0x3a3f48));
    wing.position.set(0, 0.02, s * 0.4);
    wing.name = s > 0 ? "wingR" : "wingL";
    g.add(wing);
  });
  return g;
}

export function buildForest() {
  const g = new THREE.Group();
  g.name = "forest";
  const obstacles = [];

  /* Ground. Two tones so the eye has something to track against for speed. */
  const ground = new THREE.Mesh(new THREE.CircleGeometry(140, 96), mat(0x2f6b3d));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  g.add(ground);

  scatter(70, 14, 130, (x, z) => {
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(rand(3, 9), 12),
      mat(pick([0x35784a, 0x2a6237, 0x3d8250]), { transparent: true, opacity: 0.75 })
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, 0.01, z);
    g.add(patch);
  });

  /* River. A wide ribbon that meanders across the field — the single best
     altitude reference here, because water reads as flat and far. */
  const river = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const z = -130 + t * 260;
    pts.push(new THREE.Vector3(Math.sin(t * Math.PI * 1.6) * 34 + 26, 0, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const riverGeo = new THREE.PlaneGeometry(1, 1, 60, 1);
  {
    // Sweep a flat ribbon along the curve rather than using TubeGeometry, so it
    // stays flush with the ground instead of being a visible pipe.
    const pos = riverGeo.attributes.position;
    const width = 11;
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) + 0.5);
      const side = pos.getY(i);
      const p = curve.getPointAt(Math.min(0.999, Math.max(0, u)));
      const tan = curve.getTangentAt(Math.min(0.999, Math.max(0, u)));
      const nrm = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      pos.setXYZ(i, p.x + nrm.x * side * width, 0, p.z + nrm.z * side * width);
    }
    riverGeo.computeVertexNormals();
  }
  const water = new THREE.Mesh(
    riverGeo,
    new THREE.MeshStandardMaterial({
      color: 0x2f6f9e,
      roughness: 0.18,
      metalness: 0.5,
      transparent: true,
      opacity: 0.9,
    })
  );
  water.position.y = 0.06;
  river.add(water);
  g.add(river);

  /* Banks: pale gravel either side, so the river edge is legible from height. */
  const bankGeo = riverGeo.clone();
  bankGeo.scale(1, 1, 1);
  const bank = new THREE.Mesh(bankGeo, mat(0x8f8468));
  bank.position.y = 0.03;
  bank.scale.set(1.16, 1, 1.16);
  g.add(bank);

  /* A lake off to the west, where the river widens out. Still water is the
     single most useful thing in a field for judging height: it is perfectly
     flat, so the drone's reflection-free surface gives no false parallax, and
     the shoreline is a hard edge to hold a hover against. */
  const LAKE = { x: -54, z: -26, r: 19 };
  const lakeGroup = new THREE.Group();
  const shore = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 2.6, 48), mat(0x8f8468));
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(LAKE.x, 0.03, LAKE.z);
  lakeGroup.add(shore);
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(LAKE.r, 48),
    new THREE.MeshStandardMaterial({
      color: 0x2b6a97,
      roughness: 0.12,
      metalness: 0.55,
      transparent: true,
      opacity: 0.92,
    })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(LAKE.x, 0.07, LAKE.z);
  lakeGroup.add(lake);
  // Reeds around the margin, so the water edge is legible from 20 m up
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = LAKE.r * rand(0.93, 1.02);
    const reed = new THREE.Mesh(
      new THREE.ConeGeometry(rand(0.25, 0.5), rand(1.1, 2.0), 5),
      mat(pick([0x6f8f42, 0x5c7d38]))
    );
    reed.position.set(LAKE.x + Math.cos(a) * rr, 0.7, LAKE.z + Math.sin(a) * rr);
    lakeGroup.add(reed);
  }
  g.add(lakeGroup);

  const inLake = (x, z) => Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4;

  /* Trees. Big ones, as asked — up to 22 m, which is a serious obstacle at the
     altitudes these missions fly. */
  scatter(160, 15, 132, (x, z, i) => {
    // Keep the riverbed and the lake clear
    if (Math.abs(x - 26) < 16 && Math.abs(z) < 130) return;
    if (inLake(x, z)) return;

    const h = rand(8, 22);
    const isBroadleaf = i % 3 === 0;
    /* Clearance has to allow for the CANOPY, not just the trunk. A 22 m
       broadleaf spreads about 7.7 m sideways, so testing the trunk position
       alone still let branches grow through a gate. */
    const reach = h * (isBroadleaf ? 0.35 : 0.3);
    if (nearGateCourse(x, z, reach)) return;

    const t = isBroadleaf ? broadleaf(h) : conifer(h);
    t.position.set(x, 0, z);
    t.rotation.y = Math.random() * Math.PI;
    g.add(t);

    /* Two colliders, not one. A single canopy-width cylinder would make it
       impossible to fly between the trunks under the canopy — which is exactly
       the shot a confident student goes looking for, and it is legitimately
       flyable. So the trunk is slim and the canopy is wide, and the gap between
       them is real. */
    const trunkH = h * (isBroadleaf ? 0.45 : 0.34);
    obstacles.push(cylinder(x, z, h * (isBroadleaf ? 0.07 : 0.05), 0, trunkH, "a tree trunk"));
    obstacles.push(cylinder(x, z, reach, trunkH * 0.92, h, "a tree"));
  });

  /* Undergrowth for close-in scale. */
  scatter(60, 13, 60, (x, z) => {
    if (nearGateCourse(x, z, -5) || inLake(x, z)) return;
    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(rand(0.6, 1.4), 6, 5),
      mat(pick([0x2c6b3f, 0x357a48]))
    );
    bush.position.set(x, 0.4, z);
    bush.scale.y = 0.7;
    g.add(bush);
  });

  /* Animals. */
  const animals = [];
  scatter(7, 18, 80, (x, z) => {
    if (inLake(x, z)) return;
    const d = deer();
    d.position.set(x, 0, z);
    d.rotation.y = Math.random() * Math.PI * 2;
    g.add(d);
    animals.push({ obj: d, kind: "ground", phase: Math.random() * Math.PI * 2 });
  });
  scatter(10, 14, 60, (x, z) => {
    if (inLake(x, z)) return;
    const r = rabbit();
    r.position.set(x, 0, z);
    r.rotation.y = Math.random() * Math.PI * 2;
    g.add(r);
    animals.push({ obj: r, kind: "ground", phase: Math.random() * Math.PI * 2 });
  });
  for (let i = 0; i < 6; i++) {
    const b = bird();
    const radius = rand(30, 70);
    b.position.set(radius, rand(14, 26), 0);
    g.add(b);
    animals.push({ obj: b, kind: "bird", radius, phase: Math.random() * Math.PI * 2, speed: rand(0.12, 0.22) });
  }

  g.userData.animate = (t) => {
    for (const a of animals) {
      if (a.kind === "bird") {
        const ang = a.phase + t * a.speed;
        a.obj.position.x = Math.cos(ang) * a.radius;
        a.obj.position.z = Math.sin(ang) * a.radius;
        // Face along the circle
        a.obj.rotation.y = -ang + Math.PI / 2;
        const flap = Math.sin(t * 6 + a.phase) * 0.5;
        a.obj.children.forEach((c) => {
          if (c.name === "wingL") c.rotation.x = -flap;
          if (c.name === "wingR") c.rotation.x = flap;
        });
      } else {
        // A slow graze: a small bob, so the field is not perfectly static
        a.obj.position.y = Math.abs(Math.sin(t * 0.6 + a.phase)) * 0.06;
      }
    }
  };

  g.userData.obstacles = obstacles;
  g.userData.sky = { background: 0x8fc9ee, fog: 0xa9d6ef, fogDensity: 0.0045 };
  return g;
}

/* ==================================================================== */
/* CITY                                                                 */
/* ==================================================================== */

const STOREY = 3.2; // metres — the unit everything vertical is built from

/** An office block. Windows are drawn as an emissive grid so it reads at night too. */
function building(w, d, storeys, palette) {
  const g = new THREE.Group();
  const h = storeys * STOREY;

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(palette.wall, { roughness: 0.7 }));
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  /* Window bands: one thin emissive strip per storey on each long face. Far
     cheaper than individual windows and reads better from the air. */
  const bandMat = new THREE.MeshStandardMaterial({
    color: palette.glass,
    emissive: palette.glass,
    emissiveIntensity: 0.35,
    roughness: 0.25,
    metalness: 0.6,
  });
  for (let s = 1; s < storeys; s++) {
    const y = s * STOREY;
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.002, STOREY * 0.45, d * 1.002), bandMat);
    band.position.y = y - STOREY * 0.25;
    g.add(band);
  }

  /* Roof furniture, so the tops are not flat grey lids when you fly over. */
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.4, d * 0.98), mat(0x4a5058));
  roof.position.y = h + 0.2;
  g.add(roof);
  if (storeys > 6) {
    const unit = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 1.6, d * 0.3), mat(0x6b727c));
    unit.position.set(w * 0.15, h + 1.0, -d * 0.15);
    unit.castShadow = true;
    g.add(unit);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), mat(0x9aa3af));
    mast.position.set(-w * 0.25, h + 2.2, d * 0.2);
    g.add(mast);
    // Aviation warning light: red, and it blinks. Genuinely what these are for.
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3b30 })
    );
    lamp.position.set(-w * 0.25, h + 4.3, d * 0.2);
    lamp.name = "warnLamp";
    g.add(lamp);
  }
  return g;
}

/** A lattice cell tower with dishes and a blinking beacon. */
function cellTower(height = 34) {
  const g = new THREE.Group();
  const legR = 1.5;
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.2, height, 5),
      mat(0x9aa3af, { metalness: 0.5, roughness: 0.5 })
    );
    leg.position.set(Math.cos(a) * legR, height / 2, Math.sin(a) * legR);
    leg.rotation.z = Math.cos(a) * 0.045;
    leg.rotation.x = -Math.sin(a) * 0.045;
    leg.castShadow = true;
    g.add(leg);
    legs.push(leg);
  }
  // Cross bracing every 4 m
  for (let y = 4; y < height; y += 4) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(legR * (1 - y / height / 3), 0.05, 5, 3),
      mat(0x8d959f, { metalness: 0.5 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  // Panel antennas at the top
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.2, 0.9), mat(0xe4e8ee));
    panel.position.set(Math.cos(a) * 1.9, height - 2.4, Math.sin(a) * 1.9);
    panel.rotation.y = -a;
    panel.castShadow = true;
    g.add(panel);
  }
  // Microwave dish
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 0.25, 16),
    mat(0xd8dde4, { metalness: 0.3 })
  );
  dish.rotation.z = Math.PI / 2;
  dish.rotation.y = 0.6;
  dish.position.set(1.4, height - 7, 0);
  g.add(dish);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xff3b30 })
  );
  beacon.position.y = height + 0.5;
  beacon.name = "warnLamp";
  g.add(beacon);
  return g;
}

/** A car. 4.4 m long, which is the yardstick for everything at ground level. */
function car(colorHex) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.85, 1.85), mat(colorHex, { roughness: 0.4, metalness: 0.35 }));
  body.position.y = 0.72;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.72, 1.65),
    mat(0x22262e, { roughness: 0.25, metalness: 0.4 })
  );
  cabin.position.set(-0.2, 1.45, 0);
  g.add(cabin);
  [-1.45, 1.45].forEach((x) =>
    [-0.92, 0.92].forEach((z) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10), mat(0x15181d));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.34, z);
      g.add(wheel);
    })
  );
  return g;
}

/** A box truck, for variety and because it is visibly bigger than a car. */
function truck(colorHex) {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.3), mat(colorHex, { roughness: 0.5 }));
  cab.position.set(2.6, 1.5, 0);
  cab.castShadow = true;
  g.add(cab);
  const box = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.8, 2.4), mat(0xe8ecf0, { roughness: 0.7 }));
  box.position.set(-1.2, 1.9, 0);
  box.castShadow = true;
  g.add(box);
  [-2.6, 0.4, 2.6].forEach((x) =>
    [-1.1, 1.1].forEach((z) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.3, 10), mat(0x15181d));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.46, z);
      g.add(wheel);
    })
  );
  return g;
}

/** A person, 1.7 m. The smallest reliable size reference in the city. */
function person(shirt) {
  const g = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.85, 6), mat(0x2b3242));
  legs.position.y = 0.43;
  g.add(legs);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 3, 7), mat(shirt));
  torso.position.y = 1.13;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), mat(0xc99a6f));
  head.position.y = 1.58;
  g.add(head);
  return g;
}

/** Construction site: foundation pit, a rising frame, a tower crane. */
function constructionSite(originX, originZ, obstacles) {
  const g = new THREE.Group();
  const W = (x, z) => [x + originX, z + originZ];

  const pit = new THREE.Mesh(new THREE.BoxGeometry(26, 0.6, 22), mat(0x6b5c46));
  pit.position.y = 0.3;
  pit.receiveShadow = true;
  g.add(pit);

  /* Steel frame going up: columns and floor slabs, obviously unfinished. */
  const steel = mat(0xb4623a, { metalness: 0.35, roughness: 0.6 });
  for (let fx = -1; fx <= 1; fx++) {
    for (let fz = -1; fz <= 1; fz++) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.45, STOREY * 5, 0.45), steel);
      col.position.set(fx * 8, (STOREY * 5) / 2 + 0.6, fz * 7);
      col.castShadow = true;
      g.add(col);
      const [cwx, cwz] = W(fx * 8, fz * 7);
      obstacles.push(box(cwx, cwz, 0.35, 0.35, 0, STOREY * 5 + 0.6, 0, "a steel column"));
    }
  }
  for (let s = 1; s <= 4; s++) {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(17.5, 0.3, 15.5),
      mat(0x9aa0a8, { roughness: 0.85 })
    );
    slab.position.y = 0.6 + s * STOREY;
    // Top slab only half poured — the detail that makes it read as in-progress
    if (s === 4) slab.scale.x = 0.55;
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
    const [swx, swz] = W(0, 0);
    obstacles.push(
      box(swx, swz, (17.5 * slab.scale.x) / 2, 7.75, slab.position.y - 0.2, slab.position.y + 0.2, 0, "a concrete slab")
    );
  }

  /* Tower crane. Its jib sweeps, which is the most alive thing in the city. */
  const crane = new THREE.Group();
  const mastH = 40;
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.5, mastH, 1.5), mat(0xffc233, { roughness: 0.6 }));
  mast.position.y = mastH / 2;
  mast.castShadow = true;
  crane.add(mast);

  const slew = new THREE.Group();
  slew.position.y = mastH;
  const jib = new THREE.Mesh(new THREE.BoxGeometry(34, 0.9, 0.9), mat(0xffc233));
  jib.position.x = 11;
  jib.castShadow = true;
  slew.add(jib);
  const counterJib = new THREE.Mesh(new THREE.BoxGeometry(10, 0.9, 0.9), mat(0xf0a81f));
  counterJib.position.x = -6.5;
  slew.add(counterJib);
  const counterweight = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 2.2), mat(0x59606b));
  counterweight.position.set(-10, -0.4, 0);
  slew.add(counterweight);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 1.6), mat(0x2f3946));
  cab.position.set(1.6, -1.2, 0);
  slew.add(cab);
  // Hoist cable and hook
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 16, 4), mat(0x2a2f38));
  cable.position.set(20, -8, 0);
  slew.add(cable);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), mat(0x4a5158));
  hook.position.set(20, -16.4, 0);
  slew.add(hook);
  slew.name = "craneSlew";
  crane.add(slew);
  crane.position.set(-17, 0, 0);
  g.add(crane);

  const [craneX, craneZ] = W(-17, 0);
  obstacles.push(box(craneX, craneZ, 0.9, 0.9, 0, mastH, 0, "the crane mast"));

  /* The jib SWEEPS, so it cannot be bucketed into the static grid. It is modelled
     as a short chain of colliders whose positions the animation loop rewrites —
     a 34 m arm turning at head height for a 40 m hover is the most dangerous
     thing in this field, and a drone should be able to be hit by it. */
  const jibNodes = [];
  const JIB_FROM = -12; // counterweight tip, in the slew group's local X
  const JIB_TO = 28; // jib tip
  const JIB_R = 1.9;
  /* Spaced closer than twice their radius, so the chain of spheres is CONTINUOUS.
     At 7 m spacing there were 4 m gaps between nodes and a drone could pass
     straight through the middle of a solid steel arm. */
  const jibCount = Math.ceil((JIB_TO - JIB_FROM) / (JIB_R * 1.6)) + 1;
  for (let i = 0; i < jibCount; i++) {
    const along = JIB_FROM + ((JIB_TO - JIB_FROM) * i) / (jibCount - 1);
    const node = {
      kind: "cyl",
      dynamic: true,
      x: craneX,
      z: craneZ,
      r: JIB_R,
      y0: mastH - 1.4,
      y1: mastH + 0.9,
      label: "the crane jib",
    };
    jibNodes.push({ node, along });
    obstacles.push(node);
  }
  // The hoist cable and hook hang 16 m below the jib, 20 m out
  const hookNode = {
    kind: "cyl",
    dynamic: true,
    x: craneX,
    z: craneZ,
    r: 0.9,
    y0: mastH - 17,
    y1: mastH,
    label: "the crane's hook",
  };
  obstacles.push(hookNode);

  g.userData.syncColliders = (angle) => {
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    for (const j of jibNodes) {
      // Local +X of the slew group, rotated by the slew angle
      j.node.x = craneX + c * j.along;
      j.node.z = craneZ - sn * j.along;
    }
    hookNode.x = craneX + c * 20;
    hookNode.z = craneZ - sn * 20;
  };

  /* Site clutter: skips, materials, cones. */
  scatter(6, 12, 20, (x, z) => {
    const skip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 1.8), mat(pick([0xd4642a, 0x2f6f9e, 0x5a6470])));
    skip.position.set(x, 0.95, z);
    skip.castShadow = true;
    g.add(skip);
    const [kx, kz] = W(x, z);
    obstacles.push(box(kx, kz, 1.6, 0.9, 0, 1.6, 0, "a skip"));
  });
  for (let i = 0; i < 10; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 8), mat(0xff6a1f));
    cone.position.set(rand(-14, 14), 0.98, rand(-13, 13));
    g.add(cone);
  }
  // Workers in hi-vis
  for (let i = 0; i < 5; i++) {
    const w = person(0xf2c94c);
    w.position.set(rand(-12, 12), 0.6, rand(-10, 10));
    w.rotation.y = Math.random() * Math.PI * 2;
    g.add(w);
  }

  g.userData.slew = crane.getObjectByName("craneSlew");
  return g;
}

/**
 * A park: lawn, path, trees, benches and a bandstand. Somewhere safe to practise.
 *
 * There is deliberately no water here. Open water belongs in the forest, where it
 * is the field's main altitude reference; in the middle of a city block it read as
 * scenery nobody had a reason to fly over.
 */
function gardenPark(originX = 0, originZ = 0, obstacles = []) {
  const g = new THREE.Group();

  const lawn = new THREE.Mesh(new THREE.CircleGeometry(24, 40), mat(0x3f8a4a));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = 0.02;
  lawn.receiveShadow = true;
  g.add(lawn);

  const path = new THREE.Mesh(new THREE.RingGeometry(12, 14, 40), mat(0xbdae90));
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.04;
  g.add(path);

  /* A bandstand at the heart of the park: a 4.5 m roof on posts. Small, hard,
     and right where a student practising a slow circuit will be looking. */
  const stand = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.5, 12), mat(0xcfc3a6));
  base.position.y = 0.25;
  base.receiveShadow = true;
  stand.add(base);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 3.2, 6), mat(0xe8e2d2));
    post.position.set(Math.cos(a) * 3.0, 2.1, Math.sin(a) * 3.0);
    stand.add(post);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.0, 1.5, 12), mat(0x4f6b57));
  roof.position.y = 4.45;
  roof.castShadow = true;
  stand.add(roof);
  /* Placed by search, not by hand. The park straddles the gate course, and a 5 m
     bandstand dropped on a gate is the same unflyable accident the trees are
     already protected from — so try candidate spots around the lawn and take the
     first that clears the course by its own radius. */
  const BAND_R = 3.9;
  let bandAt = null;
  for (let i = 0; i < 12 && !bandAt; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.3;
    const cand = { x: Math.cos(a) * 9.5, z: Math.sin(a) * 9.5 };
    if (!nearGateCourse(cand.x + originX, cand.z + originZ, BAND_R)) bandAt = cand;
  }
  if (bandAt) {
    stand.position.set(bandAt.x, 0, bandAt.z);
    g.add(stand);
    obstacles.push(
      cylinder(originX + bandAt.x, originZ + bandAt.z, BAND_R, 0, 5.2, "the bandstand")
    );
  }

  /* Flower beds where the pond used to be — colour from the air, nothing to hit. */
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const bed = new THREE.Mesh(
      new THREE.CircleGeometry(rand(1.6, 2.6), 16),
      mat(pick([0xc0577d, 0xd8863f, 0xb35fc0, 0xd6c34a]))
    );
    bed.rotation.x = -Math.PI / 2;
    bed.position.set(Math.cos(a) * 6.5, 0.05, Math.sin(a) * 6.5);
    g.add(bed);
  }

  /* The park straddles the gate course, so trees here are placed in PARK-LOCAL
     coordinates but tested against the gates in WORLD coordinates. */
  scatter(16, 5, 22, (x, z) => {
    const h = rand(6, 11);
    if (nearGateCourse(x + originX, z + originZ, h * 0.35)) return;
    // Keep the bandstand's own footprint clear
    if (bandAt && Math.hypot(x - bandAt.x, z - bandAt.z) < BAND_R + 3) return;
    const t = broadleaf(h);
    t.position.set(x, 0, z);
    g.add(t);
    const trunkH = h * 0.45;
    obstacles.push(cylinder(originX + x, originZ + z, h * 0.07, 0, trunkH, "a tree trunk"));
    obstacles.push(cylinder(originX + x, originZ + z, h * 0.35, trunkH * 0.92, h, "a park tree"));
  });

  // Benches around the path
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.5), mat(0x7a5c3a));
    bench.position.set(Math.cos(a) * 15.5, 0.45, Math.sin(a) * 15.5);
    bench.rotation.y = -a;
    g.add(bench);
  }
  // People enjoying it
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(4, 20);
    const p = person(pick([0xe05a5a, 0x4a8fe7, 0xf2c94c, 0xe8ecf0, 0x9b5de5]));
    p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    p.rotation.y = Math.random() * Math.PI * 2;
    g.add(p);
  }
  return g;
}

export function buildCity() {
  const g = new THREE.Group();
  g.name = "city";
  const obstacles = [];

  /* Ground: asphalt. */
  const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 96), mat(0x3a3f47, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  g.add(ground);

  /* Street grid. Roads every 40 m, with centre lines — the clearest possible
     ground reference for judging drift and ground speed. */
  const roadMat = mat(0x22262c, { roughness: 1 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8d2a8 });
  const ROAD = 11;
  const roads = [];
  for (let i = -3; i <= 3; i++) {
    const p = i * 40;
    [0, 1].forEach((axis) => {
      const road = new THREE.Mesh(
        axis ? new THREE.PlaneGeometry(300, ROAD) : new THREE.PlaneGeometry(ROAD, 300),
        roadMat
      );
      road.rotation.x = -Math.PI / 2;
      road.position.set(axis ? 0 : p, 0.01, axis ? p : 0);
      g.add(road);
      roads.push({ axis, p });

      // Dashed centre line
      for (let d = -140; d < 140; d += 12) {
        const dash = new THREE.Mesh(
          axis ? new THREE.PlaneGeometry(6, 0.3) : new THREE.PlaneGeometry(0.3, 6),
          lineMat
        );
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(axis ? d : p, 0.03, axis ? p : d);
        g.add(dash);
      }
    });
  }

  /* Buildings on the blocks between roads. The launch pad sits in the middle of
     the central block, which is deliberately left as the park. */
  const palettes = [
    { wall: 0x6f7885, glass: 0x9fd0f0 },
    { wall: 0x8a7f74, glass: 0xbfe0f5 },
    { wall: 0x5c6470, glass: 0x8fc4e8 },
    { wall: 0x7d7a86, glass: 0xa8d8f2 },
  ];
  for (let bx = -3; bx <= 3; bx++) {
    for (let bz = -3; bz <= 3; bz++) {
      const cx = bx * 40 + 20;
      const cz = bz * 40 + 20;
      const distFromHome = Math.hypot(cx, cz);
      if (distFromHome < 34) continue; // keep the launch clearing and the park
      if (nearGateCourse(cx, cz, 14)) continue; // never wall off a mission gate
      if (Math.abs(cx + 60) < 20 && Math.abs(cz) < 20) continue; // construction site
      if (Math.hypot(cx, cz) > 150) continue;

      // Taller towers toward the middle, low-rise at the edges — reads as a skyline
      const nearness = 1 - Math.min(1, distFromHome / 150);
      const storeys = Math.round(rand(3, 6) + nearness * rand(6, 22));
      const bw = rand(14, 24);
      const bd = rand(14, 22);
      const b = building(bw, bd, storeys, pick(palettes));
      const px = cx + rand(-3, 3);
      const pz = cz + rand(-3, 3);
      b.position.set(px, 0, pz);
      b.rotation.y = Math.random() < 0.5 ? 0 : Math.PI / 2;
      g.add(b);
      /* The collider is the tower plus its roof furniture, and it uses the same
         rotation the mesh does — a 24x14 block turned 90 degrees is a different
         obstacle, and getting that wrong would let a drone clip a corner that
         looks solid on screen. */
      obstacles.push(
        box(px, pz, bw / 2, bd / 2, 0, storeys * STOREY + 0.4, b.rotation.y, "a building")
      );
    }
  }

  /* The cell tower, on its own so it is findable. */
  const tower = cellTower(36);
  tower.position.set(58, 0, -46);
  g.add(tower);
  // The lattice is open, but a drone that enters it is not coming out flying.
  obstacles.push(cylinder(58, -46, 2.1, 0, 38.5, "the cell tower"));

  /* Construction site and park. */
  const site = constructionSite(-60, 0, obstacles);
  site.position.set(-60, 0, 0);
  g.add(site);

  const park = gardenPark(0, 44, obstacles);
  park.position.set(0, 0, 44);
  g.add(park);

  /* Traffic. Cars drive along the roads; the scene animates them. */
  const vehicles = [];
  const carColours = [0xd94f4f, 0x4a8fe7, 0xe8ecf0, 0x2f3946, 0xf2c94c, 0x3fbf6f];
  for (let i = 0; i < 26; i++) {
    const r = pick(roads);
    const isTruck = Math.random() < 0.22;
    const v = isTruck ? truck(pick([0x4a8fe7, 0xe8ecf0, 0xd94f4f])) : car(pick(carColours));
    const dir = Math.random() < 0.5 ? 1 : -1;
    const lane = dir * (ROAD * 0.25);
    const along = rand(-140, 140);
    if (r.axis) {
      v.position.set(along, 0, r.p + lane);
      v.rotation.y = dir > 0 ? 0 : Math.PI;
    } else {
      v.position.set(r.p - lane, 0, along);
      v.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    g.add(v);
    vehicles.push({ obj: v, road: r, dir, lane, speed: rand(5, 13) * dir, along });
  }

  /* Pedestrians on the pavements beside the roads. */
  const walkers = [];
  for (let i = 0; i < 22; i++) {
    const r = pick(roads);
    const side = Math.random() < 0.5 ? 1 : -1;
    const p = person(pick([0xe05a5a, 0x4a8fe7, 0xf2c94c, 0xe8ecf0, 0x9b5de5, 0x3fbf6f]));
    const along = rand(-140, 140);
    const off = side * (ROAD * 0.5 + 1.6);
    if (r.axis) p.position.set(along, 0, r.p + off);
    else p.position.set(r.p + off, 0, along);
    g.add(p);
    walkers.push({ obj: p, road: r, along, off, speed: rand(0.9, 1.7) * (Math.random() < 0.5 ? 1 : -1) });
  }

  /* Street lights, for scale along the roads. An 8 m pole sits squarely in the
     height band the gates occupy, so these need the same clearance test the
     buildings get. */
  scatter(30, 20, 150, (x, z) => {
    if (nearGateCourse(x, z, 2)) return;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 8, 6), mat(0x767d88));
    pole.position.set(x, 4, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.14), mat(0x767d88));
    arm.position.set(x + 0.8, 7.9, z);
    g.add(pole, arm);
    // Generous by 30 cm: a pole this thin is nearly invisible at speed, and a
    // near-miss the pilot never saw teaches nothing.
    obstacles.push(cylinder(x + 0.4, z, 0.45, 0, 8.1, "a street light"));
  });

  const lamps = [];
  g.traverse((o) => {
    if (o.name === "warnLamp") lamps.push(o);
  });
  const slew = site.userData.slew;
  const syncCrane = site.userData.syncColliders;

  g.userData.animate = (t, dt) => {
    /* Traffic. Vehicles loop the length of their road, which keeps the city
       alive without any pathfinding. */
    for (const v of vehicles) {
      v.along += v.speed * dt;
      if (v.along > 150) v.along = -150;
      if (v.along < -150) v.along = 150;
      if (v.road.axis) v.obj.position.x = v.along;
      else v.obj.position.z = v.along;
    }
    for (const w of walkers) {
      w.along += w.speed * dt;
      if (w.along > 150) w.along = -150;
      if (w.along < -150) w.along = 150;
      if (w.road.axis) w.obj.position.x = w.along;
      else w.obj.position.z = w.along;
      // A gentle bob so they read as walking rather than sliding
      w.obj.position.y = Math.abs(Math.sin(t * 4 + w.along)) * 0.05;
    }
    if (slew) {
      const angle = Math.sin(t * 0.07) * 1.5;
      slew.rotation.y = angle;
      // Keep the jib's colliders under the jib we just drew
      syncCrane?.(angle);
    }
    // Aviation warning lights blink together, roughly once a second, as real ones do
    const on = Math.sin(t * 2.2) > 0;
    for (const l of lamps) l.material.color.setHex(on ? 0xff3b30 : 0x5a1512);
  };

  g.userData.obstacles = obstacles;
  g.userData.sky = { background: 0x9fb8cc, fog: 0xb9c8d4, fogDensity: 0.0052 };
  return g;
}

/* ==================================================================== */

export const FLIGHT_FIELDS = [
  {
    id: "forest",
    label: "Forest",
    blurb:
      "Tall trees, a river, a lake and wildlife. Open ground with room between the trunks — the gentler field to learn on.",
    detail: "Trees to 22 m · river and lake · deer, rabbits and circling birds",
    build: buildForest,
  },
  {
    id: "city",
    label: "City",
    blurb:
      "Tower blocks, a cell mast, moving traffic, a construction crane and a park. Hard obstacles and tight lines — fly it once you can hold a hover.",
    detail: "Towers past 80 m · cell tower · live traffic · slewing crane · park",
    build: buildCity,
  },
];

export const DEFAULT_FIELD = "forest";
