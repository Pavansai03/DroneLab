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

/**
 * PROXIMITY ALARM THRESHOLDS
 *
 * A pure distance trigger is unusable in these fields. A forest has a tree every
 * few metres and a city street has walls on both sides, so an alarm that fires on
 * "something is within 14 m" fires permanently — and an alarm that is always on
 * carries no information at all.
 *
 * Nor is it enough to ask whether the gap is shrinking. Flying PAST a building
 * five metres to one side shrinks the gap all the way to the corner, and a
 * closure-rate alarm shouts the whole way along a wall you were never going to
 * touch.
 *
 * So the question the alarm actually asks is the one a pilot asks: *if I hold
 * this course, do I hit something, and how soon?* That is answered by marching
 * the aircraft's own velocity vector forward through the collider field. Flying
 * beside a wall predicts no impact and stays silent; pointing at the same wall
 * predicts one and calls it.
 */
export const SNUG_DISTANCE = 2.2; // metres — too close whatever you are doing
export const WARN_SECONDS = 2.5; // seconds to predicted impact that starts the alarm
export const PREDICT_MIN_SPEED = 1.2; // m/s below which nothing is predicted at all

/* The broad-phase grid. Anything much larger than a city block wastes memory;
   much smaller and a 24 m building registers in too many cells. */
const CELL = 24;

/* How far beyond its own footprint each obstacle registers. A query only looks in
   the single cell it stands in, so this is the radius at which an obstacle can be
   found at all — it has to comfortably exceed one sphere-tracing step. */
const GRID_PAD = 16;

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

    const reach = (o.kind === "cyl" ? o.r : Math.hypot(o.hw, o.hd)) + GRID_PAD;
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

/**
 * March forward along a heading and report the first impact, if there is one.
 *
 * This is sphere tracing: at each step the signed distance to the nearest surface
 * is itself a safe distance to advance, because nothing can be closer than that.
 * It therefore CANNOT tunnel through a thin obstacle the way fixed-interval
 * sampling can — and a street light is thin enough that fixed sampling would miss
 * it at any realistic cruise speed.
 *
 * Returns `{ seconds, distance, obstacle }` or null for a clear path.
 */
export function predictImpact(field, pos, vel, radius, horizonSeconds) {
  if (!field) return null;
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed < PREDICT_MIN_SPEED) return null;

  const dx = vel.x / speed;
  const dy = vel.y / speed;
  const dz = vel.z / speed;
  const maxDistance = speed * horizonSeconds;

  let travelled = 0;
  for (let i = 0; i < 24; i++) {
    const px = pos.x + dx * travelled;
    const py = pos.y + dy * travelled;
    const pz = pos.z + dz * travelled;
    // Below ground level the ground warning owns it, not this
    if (py < 0.1) return null;

    const near = field.nearest(px, py, pz);
    const clear = near.distance - radius;
    if (clear <= 0.05) {
      return { seconds: travelled / speed, distance: travelled, obstacle: near.obstacle };
    }
    /* Step by the distance to the nearest surface — never further, or the trace
       could jump over something. Capped, because empty sky reports an unbounded
       clearance and an unbounded step would end the trace before it reached the
       building on the far side of the gap. */
    travelled += Math.min(Math.max(clear, 0.3), 6);
    if (travelled > maxDistance) return null;
  }
  return null;
}

/**
 * The highest obstacle top within `halfWidth` of the horizontal line A→B.
 *
 * This is what makes Return-To-Home both safe and short. The alternative
 * approaches are each wrong in their own way: a fixed cruise altitude is either
 * too low for the city or absurdly high for the forest, and full 3D path
 * planning is a great deal of machinery to steer around buildings that are, in
 * this field, simply easier to fly over.
 *
 * So the question asked is the narrow one: flying straight home from here, what
 * is the tallest thing I pass over? Climb above that and the straight line — the
 * shortest path there is — becomes a safe one.
 *
 * Boxes are tested by their bounding circle rather than their true footprint.
 * That over-estimates the reach of a long thin building turned across the
 * corridor, which means the answer can only ever be too cautious, never too
 * low. For a check whose failure mode is flying into a tower block, that is the
 * correct direction to be wrong in.
 */
export function maxTopAlongPath(field, x0, z0, x1, z1, halfWidth) {
  if (!field) return 0;

  const sx = x1 - x0;
  const sz = z1 - z0;
  const len2 = sx * sx + sz * sz;
  let top = 0;

  const consider = (o) => {
    /* The closest point on the segment to this obstacle's centre. Clamped to
       the segment, so an obstacle behind the aircraft or beyond home measures
       from the endpoint rather than from the infinite line through them. */
    const t = len2 > 1e-6 ? clamp(((o.x - x0) * sx + (o.z - z0) * sz) / len2, 0, 1) : 0;
    const px = x0 + sx * t;
    const pz = z0 + sz * t;
    const reach = o.kind === "cyl" ? o.r : Math.hypot(o.hw, o.hd);
    if (Math.hypot(o.x - px, o.z - pz) - reach <= halfWidth && o.y1 > top) top = o.y1;
  };

  for (let i = 0; i < field.static.length; i++) consider(field.static[i]);
  for (let i = 0; i < field.dynamic.length; i++) consider(field.dynamic[i]);
  return top;
}

/**
 * How alarmed to be: 0 clear, 1 imminent.
 *
 * Two independent reasons to sound, whichever is worse: something is close enough
 * that a gust would close it, or the current course runs into something soon.
 */
export function collisionUrgency(clearance, secondsToImpact) {
  const snug =
    Number.isFinite(clearance) && clearance < SNUG_DISTANCE
      ? 1 - Math.max(0, clearance) / SNUG_DISTANCE
      : 0;
  const predicted =
    secondsToImpact != null && secondsToImpact < WARN_SECONDS
      ? 1 - secondsToImpact / WARN_SECONDS
      : 0;
  return clamp(Math.max(snug, predicted), 0, 1);
}
