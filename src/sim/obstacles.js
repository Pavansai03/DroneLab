/**
 * OBSTACLES
 * =========
 * The bridge between the scenery and the physics.
 *
 * The flight fields are pure three.js — the simulator has never known they exist,
 * which is why a drone could previously fly straight through a tower block. Rather
 * than give the simulator a renderer, each field now publishes a list of simple
 * analytic colliders (upright cylinders and boxes) alongside its meshes, and the
 * simulator asks this module one question per frame: how far is the nearest thing
 * I could hit?
 *
 * Two shapes are enough for everything out there:
 *   cyl  — trees, masts, poles, the cell tower
 *   box  — buildings, slabs, the crane's jib and mast
 *
 * Distances are to the collider SURFACE, and negative inside it. That single
 * signed number drives both the crash test and the proximity alarm, so the alarm
 * can never disagree with the collision that follows it.
 */

/** How far out the proximity alarm starts caring, in metres from the surface. */
export const WARN_DISTANCE = 14;

/* The broad-phase grid. Anything much larger than a city block wastes memory;
   much smaller and a 24 m building registers in too many cells. */
const CELL = 24;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function cylinder(x, z, r, y0, y1, label) {
  return { kind: "cyl", x, z, r, y0, y1, label };
}

export function box(x, z, hw, hd, y0, y1, rot, label) {
  return { kind: "box", x, z, hw, hd, y0, y1, rot: rot || 0, label };
}

/**
 * Signed distance from a point to a collider: 0 on the surface, negative inside.
 *
 * Outside, this is the true Euclidean distance to the shape. Inside, it is the
 * negative depth along the shallowest axis — which is all the crash test needs,
 * and it means a drone that clips the very edge of a roof reports a small
 * penetration rather than an alarming one.
 */
export function signedDistance(o, x, y, z) {
  let dr; // horizontal distance outside the footprint, <= 0 when within it
  let inHoriz;

  if (o.kind === "cyl") {
    dr = Math.hypot(x - o.x, z - o.z) - o.r;
    inHoriz = dr <= 0;
  } else {
    // Rotate the query point into the box's own frame
    let px = x - o.x;
    let pz = z - o.z;
    if (o.rot) {
      const c = Math.cos(-o.rot);
      const s = Math.sin(-o.rot);
      const rx = px * c - pz * s;
      pz = px * s + pz * c;
      px = rx;
    }
    const ex = Math.abs(px) - o.hw;
    const ez = Math.abs(pz) - o.hd;
    inHoriz = ex <= 0 && ez <= 0;
    dr = inHoriz
      ? Math.max(ex, ez) // negative: shallowest horizontal penetration
      : Math.hypot(Math.max(ex, 0), Math.max(ez, 0));
  }

  const belowTop = o.y1 - y;
  const aboveBase = y - o.y0;
  const inVert = belowTop >= 0 && aboveBase >= 0;

  if (inHoriz && inVert) {
    // Fully inside: how far to the nearest face, as a negative number
    return -Math.min(-dr, belowTop, aboveBase);
  }

  const dy = inVert ? 0 : belowTop < 0 ? -belowTop : -aboveBase;
  return Math.hypot(Math.max(dr, 0), dy);
}

/**
 * A field's colliders, bucketed into a uniform grid so the per-frame query costs
 * a handful of distance tests instead of several hundred.
 *
 * Static obstacles are bucketed once at build time, with each one padded by the
 * warning radius — so a query only ever has to look in the single cell it stands
 * in. Moving obstacles (there is exactly one: the crane jib, which slews) are
 * kept in a short list that is always tested, because re-bucketing something that
 * moves every frame costs more than the test it saves.
 */
export class ObstacleField {
  constructor(list = []) {
    this.static = [];
    this.dynamic = [];
    this.grid = new Map();
    for (const o of list) this.add(o);
  }

  add(o) {
    if (!o) return;
    if (o.dynamic) {
      this.dynamic.push(o);
      return;
    }
    const i = this.static.length;
    this.static.push(o);

    const reach = (o.kind === "cyl" ? o.r : Math.hypot(o.hw, o.hd)) + WARN_DISTANCE;
    const x0 = Math.floor((o.x - reach) / CELL);
    const x1 = Math.floor((o.x + reach) / CELL);
    const z0 = Math.floor((o.z - reach) / CELL);
    const z1 = Math.floor((o.z + reach) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = cx + "," + cz;
        let bucket = this.grid.get(key);
        if (!bucket) this.grid.set(key, (bucket = []));
        bucket.push(i);
      }
    }
  }

  /** The nearest collider surface to a point: `{ distance, obstacle }`. */
  nearest(x, y, z) {
    let best = Infinity;
    let hit = null;

    const bucket = this.grid.get(Math.floor(x / CELL) + "," + Math.floor(z / CELL));
    if (bucket) {
      for (let i = 0; i < bucket.length; i++) {
        const o = this.static[bucket[i]];
        const d = signedDistance(o, x, y, z);
        if (d < best) {
          best = d;
          hit = o;
        }
      }
    }
    for (let i = 0; i < this.dynamic.length; i++) {
      const o = this.dynamic[i];
      const d = signedDistance(o, x, y, z);
      if (d < best) {
        best = d;
        hit = o;
      }
    }
    return { distance: best, obstacle: hit };
  }

  get count() {
    return this.static.length + this.dynamic.length;
  }
}

/** 0 when clear, rising to 1 at contact. What the alarm's urgency is built from. */
export function proximityLevel(distance) {
  if (!Number.isFinite(distance)) return 0;
  return clamp(1 - distance / WARN_DISTANCE, 0, 1);
}
