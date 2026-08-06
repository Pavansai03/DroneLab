import * as THREE from "three";
import { GATES } from "../sim/flightSim.js";
import { cylinder, box } from "../sim/obstacles.js";
import { buildSky } from "./sky.js";

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

/**
 * Materials, shared.
 *
 * `mat()` used to mint a new MeshStandardMaterial per call, which left the forest
 * with 780 meshes and 780 distinct materials. Triangles were never the problem
 * here — 34k is nothing — but every unique material is its own shader binding, so
 * the renderer could not batch anything. Caching by value collapses that to a
 * couple of dozen, which is what pays for all the extra scenery below.
 */
const matCache = new Map();
const mat = (color, opts = {}) => {
  const key = color + "|" + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.02, ...opts });
    // Survives the field it was built for — see disposeObject in materials.js
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
};

/**
 * A tileable ground texture, painted rather than loaded.
 *
 * Bare vertex colour on a 280 m circle gives the eye nothing to track, so height
 * and ground speed become almost unreadable — which is the opposite of what a
 * training field is for. Speckle at this scale is what a real field gives you.
 */
function groundTexture(base, speckles, repeat = 60) {
  // See sky.js: no DOM, no painted texture — the flat base colour still applies.
  if (typeof document === "undefined") return null;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);

  // Broad tonal blotches first, then fine grain on top
  for (let i = 0; i < 26; i++) {
    g.fillStyle = pick(speckles);
    g.globalAlpha = 0.18 + Math.random() * 0.22;
    const r = 6 + Math.random() * 22;
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = pick(speckles);
    g.globalAlpha = 0.1 + Math.random() * 0.5;
    g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Copies of one geometry drawn in a single call. The only way to afford crowds. */
function instanced(geo, material, placements) {
  if (!placements.length) return null;
  const m = new THREE.InstancedMesh(geo, material, placements.length);
  const o = new THREE.Object3D();
  placements.forEach((p, i) => {
    o.position.set(p.x, p.y, p.z);
    o.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
    o.scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
  });
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

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

  /* Sky first, so the light can be aimed at a sun that is actually up there. */
  const sky = buildSky({
    horizon: 0xdcecf4,
    mid: 0x9ed0ee,
    zenith: 0x3f86c6,
    sun: 0xfff6e2,
    sunAzimuth: 0.75,
    sunElevation: 0.68,
    cloudCount: 14,
    cloudHeight: 210,
  });
  g.add(sky);

  /* Ground. Painted grass rather than a flat fill — see groundTexture. */
  const grass = groundTexture("#2f6b3d", ["#3d8250", "#265c34", "#4a915c", "#1f4f2c"], 72);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(300, 96),
    new THREE.MeshStandardMaterial({ map: grass, color: 0x2f6b3d, roughness: 0.96, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  g.add(ground);

  /* Broad clearings and darker thickets, so the canopy floor is not uniform. */
  scatter(70, 14, 130, (x, z) => {
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(rand(3, 9), 12),
      mat(pick([0x35784a, 0x2a6237, 0x3d8250]), { transparent: true, opacity: 0.7 })
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
  const swayers = [];

  /* ------------------------------------------------------------- TREES
   *
   * Trees grow in STANDS, not in a uniform sprinkle.
   *
   * The first version scattered 160 trees evenly across the whole field, which
   * is the one thing a real wood never looks like: every direction was equally
   * obstructed, there was nowhere to fly and nowhere for the eye to rest, and
   * because the species alternated every third tree, no two neighbours matched.
   * The result read as clutter rather than as forest.
   *
   * What a real wood has, and this now has:
   *   - GROVES. A dozen stands, each one species, each with its own maturity.
   *     Conifers grow in tight dark blocks; broadleaves stand further apart.
   *   - MEADOW between them. The gaps are the point — they are what makes the
   *     stands read as stands, and they are where the flying happens.
   *   - A DENSITY GRADIENT. Open around the launch pad, thickening outward to
   *     the treeline, the way a clearing actually gives way to woodland.
   *   - SPACING. No two trunks inside each other. Interpenetrating canopies are
   *     the tell that scenery was scattered by a random number generator.
   *   - AGE STRUCTURE. Mature at the heart of a stand, younger at its edge,
   *     because that is where the light is.
   *
   * It comes out around 100 trees instead of 160 — fewer objects, and it looks
   * far more like a wood.
   */
  {
    const planted = [];

    /* One tree, if there is room for it. Returns whether it went in. */
    const plant = (x, z, h, isBroadleaf) => {
      if (Math.abs(x - 26) < 16 && Math.abs(z) < 130) return false; // riverbed
      if (inLake(x, z)) return false;

      /* Clearance has to allow for the CANOPY, not just the trunk. A 22 m
         broadleaf spreads about 7.7 m sideways, so testing the trunk position
         alone still let branches grow through a gate. */
      const reach = h * (isBroadleaf ? 0.35 : 0.3);
      if (nearGateCourse(x, z, reach)) return false;

      /* Crowns may interlock a little — they do in nature — but trunks must not
         share ground. Half the sum of the two reaches is close enough to how
         real canopies pack, and it is what stops the stand becoming a thicket
         of coincident geometry. */
      for (const t of planted) {
        if (Math.hypot(t.x - x, t.z - z) < (t.reach + reach) * 0.62) return false;
      }
      planted.push({ x, z, reach });

      const t = isBroadleaf ? broadleaf(h) : conifer(h);
      t.position.set(x, 0, z);
      t.rotation.y = Math.random() * Math.PI;
      g.add(t);

      /* Wind. A few degrees of lean, at a rate set by the tree's height — a 22 m
         broadleaf answers a gust slowly and a sapling whips. Static trees are the
         thing that most gives away a rendered forest, and this costs two sines per
         tree per frame. */
      swayers.push({ obj: t, phase: Math.random() * Math.PI * 2, rate: 1.5 - h / 30, amp: 0.006 + h / 3400 });

      /* Two colliders, not one. A single canopy-width cylinder would make it
         impossible to fly between the trunks under the canopy — which is exactly
         the shot a confident student goes looking for, and it is legitimately
         flyable. So the trunk is slim and the canopy is wide, and the gap between
         them is real. */
      const trunkH = h * (isBroadleaf ? 0.45 : 0.34);
      obstacles.push(cylinder(x, z, h * (isBroadleaf ? 0.07 : 0.05), 0, trunkH, "a tree trunk"));
      obstacles.push(cylinder(x, z, reach, trunkH * 0.92, h, "a tree"));
      return true;
    };

    /* The stands. Placed by hand-ish polar coordinates rather than at random, so
       the clearings between them are reliably flyable instead of occasionally
       sealing shut. */
    const GROVES = [
      { a: 0.35, r: 46, spread: 18, n: 7, broadleaf: false },
      { a: 1.15, r: 62, spread: 23, n: 9, broadleaf: true },
      { a: 1.95, r: 44, spread: 16, n: 5, broadleaf: false },
      { a: 2.70, r: 74, spread: 25, n: 9, broadleaf: false },
      { a: 3.40, r: 52, spread: 19, n: 6, broadleaf: true },
      { a: 4.10, r: 88, spread: 27, n: 10, broadleaf: false },
      { a: 4.85, r: 58, spread: 20, n: 7, broadleaf: true },
      { a: 5.55, r: 78, spread: 24, n: 9, broadleaf: false },
      { a: 0.85, r: 104, spread: 25, n: 8, broadleaf: false },
      { a: 2.30, r: 112, spread: 27, n: 9, broadleaf: true },
      { a: 3.90, r: 108, spread: 26, n: 8, broadleaf: false },
      { a: 5.10, r: 118, spread: 25, n: 8, broadleaf: true },
    ];

    for (const grove of GROVES) {
      const cx = Math.cos(grove.a) * grove.r;
      const cz = Math.sin(grove.a) * grove.r;
      /* Maturity is a property of the stand, not of each tree. Trees that came
         up together are the same age, and that is very visible from the air. */
      const prime = rand(13, 22);

      for (let i = 0; i < grove.n; i++) {
        /* sqrt() would spread these evenly over the disc; the bare random packs
           them toward the middle, which is what a stand actually does. */
        const rr = Math.pow(Math.random(), 0.7) * grove.spread;
        const aa = Math.random() * Math.PI * 2;
        const edge = rr / grove.spread;
        // Tallest at the heart, younger toward the light at the margin.
        const h = Math.max(6, prime * (1 - edge * 0.42) * rand(0.88, 1.1));
        plant(cx + Math.cos(aa) * rr, cz + Math.sin(aa) * rr, h, grove.broadleaf);
      }
    }

    /* Standards: the isolated old trees left standing in open pasture. A handful
       of these does more for the sense of scale than another whole stand, because
       there is nothing beside them to measure them against but the ground. */
    scatter(9, 34, 96, (x, z) => plant(x, z, rand(16, 23), true));

    /* Saplings and scrub taking hold in the open ground, so the meadow is not a
       bare lawn between the stands. */
    scatter(14, 26, 120, (x, z) => plant(x, z, rand(4.5, 8), Math.random() < 0.5));
  }

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

  /* Forest floor: fallen trunks, boulders and ferns. All instanced — 200 loose
     meshes here would cost more than every tree in the field put together. */
  {
    const logs = [];
    const rocks = [];
    const ferns = [];
    /* Fallen trunks are solid and sit at exactly the height a student flies a low
       pass, so they get the same course-clearance test the standing trees get.
       Everything that is BOTH drawn and collidable has to, or the scenery quietly
       walks back into the gate line one object type at a time. */
    scatter(26, 16, 120, (x, z) => {
      if (inLake(x, z) || nearGateCourse(x, z, 3)) return;
      logs.push({ x, y: 0.35, z, ry: Math.random() * Math.PI, rz: Math.PI / 2, sx: rand(0.7, 1.5) });
    });
    scatter(40, 14, 125, (x, z) => {
      if (inLake(x, z)) return;
      const s = rand(0.4, 1.5);
      rocks.push({ x, y: s * 0.3, z, ry: Math.random() * Math.PI, sx: s, sy: s * rand(0.5, 0.8), sz: s });
    });
    scatter(120, 13, 110, (x, z) => {
      if (inLake(x, z)) return;
      ferns.push({ x, y: 0.3, z, ry: Math.random() * Math.PI, sx: rand(0.7, 1.4), sy: rand(0.7, 1.3), sz: rand(0.7, 1.4) });
    });

    const logMesh = instanced(
      new THREE.CylinderGeometry(0.32, 0.4, 5.5, 7),
      mat(0x5a4632),
      logs
    );
    const rockMesh = instanced(new THREE.DodecahedronGeometry(1, 0), mat(0x7d7a72), rocks);
    const fernMesh = instanced(
      new THREE.ConeGeometry(0.75, 1.1, 5),
      mat(0x2b6b3a),
      ferns
    );
    [logMesh, rockMesh, fernMesh].forEach((m) => m && g.add(m));
    // Fallen trunks are waist-high and solid; a drone at 1 m will find them
    for (const l of logs) obstacles.push(cylinder(l.x, l.z, 1.4, 0, 0.8, "a fallen trunk"));
  }

  /* A distant treeline beyond the play area, so the world does not simply stop at
     the edge of the ground disc. Two instanced cones, no detail, never reached. */
  {
    const far = [];
    for (let i = 0; i < 260; i++) {
      const a = (i / 260) * Math.PI * 2 + rand(-0.01, 0.01);
      const r = rand(150, 275);
      const h = rand(11, 26);
      far.push({ x: Math.cos(a) * r, y: h / 2, z: Math.sin(a) * r, sx: rand(2.4, 4.2), sy: h, sz: rand(2.4, 4.2) });
    }
    const m = instanced(new THREE.ConeGeometry(1, 1, 6), mat(0x24592f), far);
    if (m) {
      m.castShadow = false;
      g.add(m);
    }
  }

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

  const skyAnimate = sky.userData.animate;
  g.userData.animate = (t, dt) => {
    skyAnimate(t, dt);
    for (const sw of swayers) {
      // Two frequencies, so it breathes rather than metronomes
      const w = Math.sin(t * sw.rate + sw.phase) + Math.sin(t * sw.rate * 0.37 + sw.phase) * 0.5;
      sw.obj.rotation.z = w * sw.amp;
      sw.obj.rotation.x = Math.cos(t * sw.rate * 0.8 + sw.phase) * sw.amp * 0.6;
    }
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
  g.userData.sunDirection = sky.userData.sunDirection;
  g.userData.skyDome = sky.userData.dome;
  /* Fog matched to the sky's horizon band, so scenery fades into the sky it is
     standing in front of rather than into a different colour. */
  g.userData.sky = { background: 0xdcecf4, fog: 0xcfe4f0, fogDensity: 0.0034 };
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

  /* GROUND FLOOR.
     Real streets do not look like the twentieth floor: the bottom storey is
     taller, darker and mostly glass, because it is shops. Extruding one wall
     texture from pavement to parapet is the single thing that most gives away a
     computer-generated city, and this is a cheap fix for it — one box. */
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(w * 1.008, STOREY * 0.92, d * 1.008),
    mat(0x3c424b, { roughness: 0.55, metalness: 0.25 })
  );
  plinth.position.y = STOREY * 0.46;
  plinth.receiveShadow = true;
  g.add(plinth);

  /* A canopy over the shopfront. Reads as an awning from the street and as a
     hard shadow line from above, which is where the drone actually is. */
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(w * 1.09, 0.18, d * 1.09),
    mat(0x565d66, { roughness: 0.9 })
  );
  canopy.position.y = STOREY * 0.92;
  canopy.castShadow = true;
  g.add(canopy);

  /* CORNER PILASTERS. Four slim uprights standing slightly proud of the wall.
     A flat face has no way to catch the sun; these give every building a lit
     edge and a shadowed edge, so the massing is readable from directly above. */
  {
    const pil = mat(palette.wall, { roughness: 0.85 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 1.1), pil);
        c.position.set((sx * w) / 2, h / 2, (sz * d) / 2);
        c.castShadow = true;
        g.add(c);
      }
    }
  }

  /* SETBACK. Tall buildings step in as they rise — partly daylight rules,
     partly structure. A 25-storey slab of constant width looks like a bar
     chart; two stages look like a tower. */
  let top = h;
  if (storeys > 12) {
    const upH = STOREY * Math.round(storeys * 0.3);
    const upper = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.72, upH, d * 0.72),
      mat(palette.wall, { roughness: 0.7 })
    );
    upper.position.y = h + upH / 2;
    upper.castShadow = true;
    upper.receiveShadow = true;
    g.add(upper);

    const upBand = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.725, upH * 0.62, d * 0.725),
      bandMat
    );
    upBand.position.y = h + upH / 2;
    g.add(upBand);
    top = h + upH;
  }

  /* PARAPET, not a lid. Every flat roof has a low wall around its edge, and
     from a drone that raised rim is the most recognisable thing about a roof —
     it is what makes the roof read as a surface you could land on rather than
     as the top of a solid block. */
  {
    const rimW = top > h ? w * 0.72 : w;
    const rimD = top > h ? d * 0.72 : d;
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(rimW * 0.98, 0.3, rimD * 0.98),
      mat(0x4a5058)
    );
    deck.position.y = top + 0.15;
    deck.receiveShadow = true;
    g.add(deck);

    const rim = mat(0x60666f, { roughness: 0.9 });
    for (const [bw, bd, ox, oz] of [
      [rimW + 0.5, 0.45, 0, (rimD + 0.5) / 2],
      [rimW + 0.5, 0.45, 0, -(rimD + 0.5) / 2],
      [0.45, rimD + 0.5, (rimW + 0.5) / 2, 0],
      [0.45, rimD + 0.5, -(rimW + 0.5) / 2, 0],
    ]) {
      const wsec = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.85, bd), rim);
      wsec.position.set(ox, top + 0.72, oz);
      wsec.castShadow = true;
      g.add(wsec);
    }

    // Stair head: every roof has one, and it is always the tallest thing up there.
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(4, rimW * 0.3), 2.4, Math.min(3.4, rimD * 0.3)),
      mat(0x555c66)
    );
    head.position.set(rimW * 0.22, top + 1.2, -rimD * 0.22);
    head.castShadow = true;
    g.add(head);
  }
  const roof = { position: { y: top } };
  if (storeys > 6) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), mat(0x9aa3af));
    mast.position.set(-w * 0.18, roof.position.y + 2.2, d * 0.14);
    g.add(mast);
    // Aviation warning light: red, and it blinks. Genuinely what these are for.
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3b30 })
    );
    lamp.position.set(-w * 0.18, roof.position.y + 4.3, d * 0.14);
    lamp.name = "warnLamp";
    g.add(lamp);
  }
  /* The true top, so the caller's collider and its rooftop clutter agree with
     what was actually drawn — a setback tower is taller than storeys * STOREY. */
  g.userData.top = roof.position.y;
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

  /* A city sky: hazier and greyer than the forest's, because it is. */
  const sky = buildSky({
    horizon: 0xdfe6ea,
    mid: 0xa8c2d6,
    zenith: 0x5c86ab,
    sun: 0xfff2d8,
    sunAzimuth: -0.6,
    sunElevation: 0.58,
    cloudCount: 18,
    cloudHeight: 175,
    cloudColour: 0xf2f4f6,
    cloudOpacity: 0.68,
  });
  g.add(sky);

  /* Ground: paving between the roads, not bare asphalt. */
  const paving = groundTexture("#4a4f57", ["#565c65", "#3f444b", "#5f656e"], 90);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(320, 96),
    new THREE.MeshStandardMaterial({ map: paving, color: 0x4a4f57, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  g.add(ground);

  /* Street grid. Roads every 40 m, with centre lines — the clearest possible
     ground reference for judging drift and ground speed. */
  const roadMat = mat(0x22262c, { roughness: 1 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8d2a8 });
  const kerbMat = mat(0x8d9199, { roughness: 0.95 });
  const paintMat = new THREE.MeshBasicMaterial({ color: 0xe8e6dc });
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

      /* Raised kerbs and pavement either side. A street with no kerb reads as a
         grey stripe painted on a field; the 15 cm step is most of what makes it
         read as a road from 20 m up. One long box per side, so it is cheap. */
      [-1, 1].forEach((side) => {
        const off = side * (ROAD / 2 + 1.9);
        const walk = new THREE.Mesh(
          axis ? new THREE.BoxGeometry(300, 0.15, 3.8) : new THREE.BoxGeometry(3.8, 0.15, 300),
          kerbMat
        );
        walk.position.set(axis ? 0 : p + off, 0.075, axis ? p + off : 0);
        walk.receiveShadow = true;
        g.add(walk);
      });
    });
  }

  /* Zebra crossings on every approach to every junction. Purely visual, and the
     single cheapest detail that makes the grid look inhabited rather than laid
     out. */
  {
    const stripes = [];
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const jx = i * 40;
        const jz = j * 40;
        if (Math.hypot(jx, jz) > 130) continue;
        for (const axis of [0, 1]) {
          for (const side of [-1, 1]) {
            const base = ROAD / 2 + 1.2;
            for (let k = 0; k < 7; k++) {
              const across = -ROAD / 2 + 0.9 + k * 1.5;
              stripes.push(
                axis
                  ? { x: jx + across, y: 0.035, z: jz + side * base }
                  : { x: jx + side * base, y: 0.035, z: jz + across, ry: Math.PI / 2 }
              );
            }
          }
        }
      }
    }
    const geo = new THREE.PlaneGeometry(0.75, 2.6);
    geo.rotateX(-Math.PI / 2);
    const m = instanced(geo, paintMat, stripes);
    if (m) {
      m.castShadow = false;
      g.add(m);
    }
  }

  /* Buildings on the blocks between roads. The launch pad sits in the middle of
     the central block, which is deliberately left as the park. */
  const palettes = [
    { wall: 0x6f7885, glass: 0x9fd0f0 },
    { wall: 0x8a7f74, glass: 0xbfe0f5 },
    { wall: 0x5c6470, glass: 0x8fc4e8 },
    { wall: 0x7d7a86, glass: 0xa8d8f2 },
  ];
  const roofs = [];
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
      /* Height comes from the building itself, not from the storey count: a
         tower with a setback carries an extra stage the arithmetic here does
         not know about, and a collider that stops short of what is drawn is
         worse than no collider at all. */
      const top = b.userData.top ?? storeys * STOREY;
      obstacles.push(box(px, pz, bw / 2, bd / 2, 0, top + 0.9, b.rotation.y, "a building"));
      roofs.push({ x: px, z: pz, w: bw, d: bd, top: storeys * STOREY + 0.4, rot: b.rotation.y });
    }
  }

  /* Rooftop plant. Every flat roof in a real city carries tanks, air handling and
     a stair head, and a drone spends most of its time looking down at exactly
     this. Instanced, so 200 of them cost three draw calls. */
  {
    const tanks = [];
    const units = [];
    const dishes = [];
    for (const r of roofs) {
      const halfW = (r.rot ? r.d : r.w) / 2 - 1.6;
      const halfD = (r.rot ? r.w : r.d) / 2 - 1.6;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const px = r.x + rand(-halfW, halfW);
        const pz = r.z + rand(-halfD, halfD);
        const roll = Math.random();
        if (roll < 0.34) {
          const h = rand(1.6, 2.8);
          tanks.push({ x: px, y: r.top + h / 2, z: pz, sx: rand(0.8, 1.4), sy: h, sz: rand(0.8, 1.4) });
        } else if (roll < 0.8) {
          const h = rand(0.8, 1.8);
          units.push({
            x: px, y: r.top + h / 2, z: pz, ry: Math.random() * Math.PI,
            sx: rand(1.4, 2.8), sy: h, sz: rand(1.2, 2.2),
          });
        } else {
          dishes.push({ x: px, y: r.top + 0.7, z: pz, rx: -0.9, ry: Math.random() * Math.PI, sx: 1.1, sy: 1.1, sz: 1.1 });
        }
      }
    }
    const tankMesh = instanced(new THREE.CylinderGeometry(1, 1, 1, 10), mat(0x9aa2ad, { metalness: 0.4, roughness: 0.55 }), tanks);
    const unitMesh = instanced(new THREE.BoxGeometry(1, 1, 1), mat(0x767d88, { metalness: 0.3, roughness: 0.7 }), units);
    const dishMesh = instanced(new THREE.SphereGeometry(0.9, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xdfe3e8), dishes);
    [tankMesh, unitMesh, dishMesh].forEach((m) => m && g.add(m));
  }

  /* Cars parked along the kerbs. A city with only moving traffic looks evacuated. */
  {
    const bodies = [];
    const cabins = [];
    const carCols = [0x8d3f3f, 0x3f5a8d, 0xb8bcc2, 0x2f3946, 0x6d7a52, 0x8a8f96];
    for (const r of roads) {
      for (let along = -132; along < 132; along += rand(9, 26)) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const off = side * (ROAD / 2 - 1.1);
        if (Math.abs(((along + 20) % 40) - 20) < 9) continue; // keep junctions clear
        const px = r.axis ? along : r.p + off;
        const pz = r.axis ? r.p + off : along;
        if (nearGateCourse(px, pz, 1)) continue;
        const ry = r.axis ? 0 : Math.PI / 2;
        bodies.push({ x: px, y: 0.55, z: pz, ry, _c: pick(carCols) });
        cabins.push({ x: px, y: 1.18, z: pz, ry });
      }
    }
    const bodyMesh = instanced(new THREE.BoxGeometry(4.4, 1.1, 1.8), mat(0x6b727c, { roughness: 0.5, metalness: 0.25 }), bodies);
    if (bodyMesh) {
      // Per-instance colour, so a row of parked cars is not a row of clones
      const col = new THREE.Color();
      bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bodies.length * 3), 3);
      bodies.forEach((b, i) => {
        col.setHex(b._c);
        bodyMesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
      });
      bodyMesh.instanceColor.needsUpdate = true;
      g.add(bodyMesh);
    }
    const cabinMesh = instanced(new THREE.BoxGeometry(2.3, 0.85, 1.65), mat(0x9fc4e0, { roughness: 0.2, metalness: 0.5 }), cabins);
    if (cabinMesh) g.add(cabinMesh);
    for (const b of bodies) obstacles.push(box(b.x, b.z, 2.3, 1.0, 0, 1.6, b.ry, "a parked car"));
  }

  /* Traffic lights on the junction corners. */
  {
    const poles = [];
    const heads = [];
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const jx = i * 40;
        const jz = j * 40;
        if (Math.hypot(jx, jz) > 120 || Math.hypot(jx, jz) < 25) continue;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const px = jx + sx * (ROAD / 2 + 1.4);
            const pz = jz + sz * (ROAD / 2 + 1.4);
            if (nearGateCourse(px, pz, 1)) continue;
            poles.push({ x: px, y: 1.8, z: pz });
            heads.push({ x: px, y: 3.5, z: pz, ry: Math.atan2(-sx, -sz) });
            obstacles.push(cylinder(px, pz, 0.5, 0, 4, "a traffic light"));
          }
        }
      }
    }
    const poleMesh = instanced(new THREE.CylinderGeometry(0.1, 0.13, 3.6, 6), mat(0x3d434b), poles);
    const headMesh = instanced(new THREE.BoxGeometry(0.42, 1.05, 0.36), mat(0x23282e), heads);
    [poleMesh, headMesh].forEach((m) => m && g.add(m));
  }

  /* STREET TREES.
     A line of trees down each pavement, evenly spaced, in pits cut out of the
     paving. From the ground they are scenery; from 30 m up they are the thing
     that separates a city from an industrial estate, because the regular
     rhythm along every street is unmistakably municipal planting.

     Instanced in two parts — trunk and crown — so eighty of them cost four draw
     calls. They are also real obstacles: at 6 m they sit exactly where a
     student flying a low pass down a street will be. */
  {
    const trunks = [];
    const crowns = [];
    const pits = [];
    for (const r of roads) {
      /* One side of each street, alternating, at a generous spacing. Both sides
         at close pitch is what a real avenue has and it looked like one — but it
         put 220 solid obstacles into the streets and left nothing flyable at
         low level, which is the same clutter the forest was just cured of. An
         avenue reads as an avenue from the rhythm, not from the count. */
      for (const side of [r.p % 80 === 0 ? 1 : -1]) {
        const off = side * (ROAD / 2 + 3.1);
        for (let along = -128; along <= 128; along += 24) {
          // Junctions stay clear — sightlines, and it is where the crossings are.
          if (Math.abs(((along + 20) % 40) - 20) < 11) continue;
          const px = r.axis ? along : r.p + off;
          const pz = r.axis ? r.p + off : along;
          if (Math.hypot(px, pz) > 132 || Math.hypot(px, pz) < 22) continue;
          if (nearGateCourse(px, pz, 3.2)) continue;

          const th = rand(5.4, 7.2);
          const spread = th * 0.34;
          pits.push({ x: px, y: 0.16, z: pz, sx: 1, sy: 1, sz: 1 });
          trunks.push({ x: px, y: th * 0.28, z: pz, sx: 1, sy: th * 0.56, sz: 1 });
          crowns.push({
            x: px, y: th * 0.72, z: pz,
            ry: Math.random() * Math.PI,
            sx: spread, sy: spread * rand(0.8, 1.05), sz: spread,
          });
          obstacles.push(cylinder(px, pz, 0.4, 0, th * 0.55, "a tree trunk"));
          obstacles.push(cylinder(px, pz, spread, th * 0.5, th, "a street tree"));
        }
      }
    }
    const pitGeo = new THREE.CircleGeometry(0.95, 10);
    pitGeo.rotateX(-Math.PI / 2);
    const pitMesh = instanced(pitGeo, mat(0x3b3227, { roughness: 1 }), pits);
    if (pitMesh) pitMesh.castShadow = false;
    const trunkMesh = instanced(
      new THREE.CylinderGeometry(0.17, 0.24, 1, 6),
      mat(0x5b4634, { roughness: 0.95 }),
      trunks
    );
    const crownMesh = instanced(
      new THREE.SphereGeometry(1, 8, 6),
      mat(0x3f7a3d, { roughness: 0.95 }),
      crowns
    );
    [pitMesh, trunkMesh, crownMesh].forEach((m) => m && g.add(m));
  }

  /* STOP LINES AND LANE DIVIDERS.
     The dashed centre line already told a pilot which way a street runs. These
     say where it stops. A junction with no stop bar reads as two strips of tar
     crossing; with one, it reads as a controlled intersection — and it costs a
     single instanced quad per approach. */
  {
    const bars = [];
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const jx = i * 40;
        const jz = j * 40;
        if (Math.hypot(jx, jz) > 130 || Math.hypot(jx, jz) < 22) continue;
        for (const side of [-1, 1]) {
          // Across the lane approaching the junction, on the near side of the crossing
          bars.push({ x: jx + side * (ROAD / 2 + 3.4), y: 0.036, z: jz, ry: Math.PI / 2, sx: 1, sz: 1 });
          bars.push({ x: jx, y: 0.036, z: jz + side * (ROAD / 2 + 3.4), sx: 1, sz: 1 });
        }
      }
    }
    const geo = new THREE.PlaneGeometry(ROAD / 2 - 0.4, 0.45);
    geo.rotateX(-Math.PI / 2);
    const m = instanced(geo, paintMat, bars);
    if (m) {
      m.castShadow = false;
      g.add(m);
    }
  }

  /* A skyline beyond the play area: low-detail blocks the drone will never reach,
     so the city does not end in mid-air at the edge of the ground disc. */
  {
    const far = [];
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * Math.PI * 2 + rand(-0.02, 0.02);
      const r = rand(180, 300);
      const h = rand(18, 95);
      far.push({
        x: Math.cos(a) * r, y: h / 2, z: Math.sin(a) * r,
        ry: Math.random() * Math.PI,
        sx: rand(14, 30), sy: h, sz: rand(14, 30),
      });
    }
    const m = instanced(new THREE.BoxGeometry(1, 1, 1), mat(0x69737f, { roughness: 0.85 }), far);
    if (m) {
      m.castShadow = false;
      g.add(m);
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

  const skyAnimate = sky.userData.animate;
  g.userData.animate = (t, dt) => {
    skyAnimate(t, dt);
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
  g.userData.sunDirection = sky.userData.sunDirection;
  g.userData.skyDome = sky.userData.dome;
  g.userData.sky = { background: 0xdfe6ea, fog: 0xd2dde4, fogDensity: 0.0041 };
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

/* The city is the field a student starts in. It is the harder of the two to fly,
   but it is by far the better one to LOOK at first: a street grid gives constant
   ground reference, the buildings are of known height, and there is always
   something in frame to judge drift against. An empty-looking wood is a poor
   first impression of a flight simulator. */
export const DEFAULT_FIELD = "city";
