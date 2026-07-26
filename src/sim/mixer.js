/**
 * MOTOR MIXING ALGORITHM
 * ======================
 * This is the box labelled "Motor Mixing Algorithm" in the Complete Flight Logic
 * diagram. It is the single piece of maths that turns four pilot demands into N
 * individual motor commands, and it is what makes a hexacopter survivable and a
 * quadcopter not.
 *
 * For each motor i sitting at angle a_i (clockwise from the nose) with spin
 * direction s_i (+1 CW, -1 CCW):
 *
 *     forward_i = cos(a_i)          right_i = sin(a_i)
 *
 *     rollFactor_i  = -right_i      more thrust on the LEFT  -> banks right
 *     pitchFactor_i = -forward_i    more thrust at the REAR  -> nose drops, flies forward
 *     yawFactor_i   = -s_i          a CW motor drags the airframe CCW
 *
 *     output_i = throttle + roll*rollFactor_i + pitch*pitchFactor_i + yaw*yawFactor_i
 *
 * Sign convention, stated once so it is never guessed at:
 *   +pitch demand -> nose down -> accelerates FORWARD (+Z)
 *   +roll  demand -> banks so the lift vector tilts to -X -> slides LEFT
 *   +yaw   demand -> nose right
 * The roll sign is the one that trips people up, so the pilot's "roll right" key is
 * mapped to a NEGATIVE roll demand in flightSim.js.
 *
 * The roll/pitch factors are normalised so the largest is 1.0, which keeps
 * control authority comparable between a quad, a hexa and an octo.
 */

const D2R = Math.PI / 180;

/** Build the static mixer table for an airframe. Cached per frame. */
const mixerCache = new Map();

export function getMixer(frame) {
  if (mixerCache.has(frame.id)) return mixerCache.get(frame.id);

  const raw = frame.motors.map((m) => {
    const a = m.angle * D2R;
    return {
      index: m.index,
      id: m.id,
      throttle: 1,
      roll: -Math.sin(a),
      pitch: -Math.cos(a),
      yaw: -m.spin,
      spin: m.spin,
      angle: m.angle,
    };
  });

  const maxRoll = Math.max(...raw.map((r) => Math.abs(r.roll)), 1e-6);
  const maxPitch = Math.max(...raw.map((r) => Math.abs(r.pitch)), 1e-6);

  const table = raw.map((r) => ({
    ...r,
    roll: r.roll / maxRoll,
    pitch: r.pitch / maxPitch,
  }));

  mixerCache.set(frame.id, table);
  return table;
}

/**
 * Mix the four demands into per-motor normalised outputs (0..1).
 *
 * `dead` is a Set of motor indices producing no thrust. On a frame with spare
 * motors the mixer re-normalises across the survivors — this is the "Automatic
 * Thrust Redistribution" the octocopter gets for free and the quadcopter cannot do.
 */
export function mix(frame, demands, dead = new Set()) {
  const table = getMixer(frame);
  const { throttle = 0, roll = 0, pitch = 0, yaw = 0 } = demands;

  const outputs = table.map((m) => {
    if (dead.has(m.index)) return 0;
    return throttle + roll * m.roll + pitch * m.pitch + yaw * m.yaw;
  });

  // Live motors only
  const live = table.filter((m) => !dead.has(m.index)).map((m) => m.index);
  if (live.length === 0) return outputs.map(() => 0);

  // Anti-windup: if any output saturates, slide the whole set back into range
  // rather than clipping one motor (clipping is what makes a drone flip).
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of live) {
    lo = Math.min(lo, outputs[i]);
    hi = Math.max(hi, outputs[i]);
  }
  let shift = 0;
  if (hi > 1) shift -= hi - 1;
  if (lo + shift < 0) shift += -(lo + shift);
  for (const i of live) outputs[i] = clamp01(outputs[i] + shift);

  // Redistribution: after a failure the survivors must carry the lost lift.
  if (dead.size > 0 && dead.size < frame.motorCount) {
    const scale = frame.motorCount / live.length;
    const boost = Math.min(scale, 1.6); // physical headroom limit
    for (const i of live) outputs[i] = clamp01(outputs[i] * boost);
  }

  return outputs;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * CONTROL AUTHORITY ANALYSIS
 * --------------------------
 * With some motors dead, can the mixer still command all four axes independently?
 * We build the 4 x liveCount control-effectiveness matrix and take its rank.
 *
 *   rank 4 -> full authority (thrust, roll, pitch, yaw all controllable)
 *   rank 3 -> one axis is gone. On a quad that axis is always YAW, which is
 *             exactly why a quad with a dead motor enters an uncontrollable spin.
 *
 * We also return a `margin`: how much spare thrust the survivors have after
 * carrying the aircraft's weight. Below ~1.0 the drone cannot hold altitude.
 */
export function analyseAuthority(frame, dead = new Set(), thrustPerMotorN = 0, weightN = 0) {
  const table = getMixer(frame);
  const live = table.filter((m) => !dead.has(m.index));

  if (live.length === 0) {
    return { rank: 0, fullAuthority: false, lostAxes: ["thrust", "roll", "pitch", "yaw"], margin: 0 };
  }

  // Rows are ordered by the priority a real flight controller uses: hold the
  // aircraft up first, keep it level second, and give up heading last. Whichever
  // row cannot add a new independent direction is the axis actually sacrificed.
  //
  // For a quadcopter missing one motor this resolves to YAW, which is exactly why
  // the course notes describe a rapid, uncontrollable spin: the three survivors can
  // still satisfy thrust, roll and pitch, but doing so leaves a yaw torque that
  // nothing is left to cancel.
  const axisNames = ["thrust", "roll", "pitch", "yaw"];
  const rows = [
    live.map((m) => m.throttle),
    live.map((m) => m.roll),
    live.map((m) => m.pitch),
    live.map((m) => m.yaw),
  ];

  const { rank, dependent } = rankInPriorityOrder(rows);
  const lostAxes = axisNames.filter((_, i) => dependent.has(i));

  const available = live.length * thrustPerMotorN;
  const margin = weightN > 0 ? available / weightN : available > 0 ? 99 : 0;

  /* ---- Hover trim feasibility --------------------------------------------
   * Rank alone is not the whole story. A hexacopter that loses two ADJACENT
   * motors still has rank 4 on paper, but solving for the hover trim shows the
   * load collapsing onto just two of the four survivors — which saturates them and
   * produces the "Severe instability / Crash likely" outcome in the course notes.
   * So we actually solve for the trim and look at how lopsided it is.          */
  const trim = solveTrim(rows, weightN || 1);
  const tMax = thrustPerMotorN > 0 ? thrustPerMotorN : Infinity;
  const maxLoad = trim.length ? Math.max(...trim) : 0;
  const minLoad = trim.length ? Math.min(...trim) : 0;
  const meanLoad = trim.length ? trim.reduce((s, v) => s + v, 0) / trim.length : 0;

  const trimFeasible = minLoad > -1e-6 && maxLoad <= tMax * 1.001;
  // 1.0 means every motor shares the load equally; higher means it is lopsided.
  const loadSpread = meanLoad > 1e-9 ? maxLoad / meanLoad : 0;

  return {
    rank,
    fullAuthority: rank >= 4 && trimFeasible && loadSpread < 1.6,
    rankFull: rank >= 4,
    lostAxes,
    liveCount: live.length,
    margin,
    canHover: margin >= 1.0 && trimFeasible,
    trim: trim.map((v) => Number(v.toFixed(2))),
    trimFeasible,
    loadSpread: Number(loadSpread.toFixed(2)),
    saturated: maxLoad > tMax,
    // Plain-language summary for the diagnostics panel
    note:
      rank < 4
        ? `${lostAxes.join(" and ").toUpperCase()} cannot be commanded — the survivors cannot cancel it.`
        : !trimFeasible
          ? "Hover trim needs more thrust than the surviving motors can make."
          : loadSpread >= 1.6
            ? `Load is lopsided (${loadSpread.toFixed(2)}x on the worst motor) — it will saturate and lose attitude control.`
            : "All four axes controllable with an even thrust share.",
  };
}

/**
 * Minimum-norm least-squares solve of A t = [weight, 0, 0, 0] — the per-motor
 * thrust needed to hover wings-level with no yaw. Uses the regularised normal
 * equations t = A^T (A A^T + lambda I)^-1 b, which stays well behaved even when
 * the mixer has lost rank.
 */
function solveTrim(rows, weightN) {
  const nAxes = rows.length;
  const nMotors = rows[0]?.length || 0;
  if (!nMotors) return [];

  const lambda = 1e-6;
  // G = A A^T  (4 x 4)
  const G = [];
  for (let i = 0; i < nAxes; i++) {
    G[i] = [];
    for (let j = 0; j < nAxes; j++) {
      let s = 0;
      for (let k = 0; k < nMotors; k++) s += rows[i][k] * rows[j][k];
      G[i][j] = s + (i === j ? lambda : 0);
    }
  }

  const b = [weightN, 0, 0, 0].slice(0, nAxes);
  const y = solve4(G, b);
  if (!y) return new Array(nMotors).fill(weightN / nMotors);

  // t = A^T y
  const t = new Array(nMotors).fill(0);
  for (let k = 0; k < nMotors; k++) {
    let s = 0;
    for (let i = 0; i < nAxes; i++) s += rows[i][k] * y[i];
    t[k] = s;
  }
  return t;
}

/** Small dense solver with partial pivoting. Returns null if singular. */
function solve4(A, b) {
  const n = b.length;
  const m = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / m[i][i]);
}

/**
 * Add rows one at a time IN THE GIVEN ORDER (Gram-Schmidt). A row that is already
 * a linear combination of the rows above it is "dependent" — that axis cannot be
 * commanded independently once the higher-priority axes are satisfied.
 *
 * Order matters here and is deliberate: it encodes the flight controller's
 * priority, so the axis reported as lost is the one the FC would really give up.
 */
function rankInPriorityOrder(rows) {
  const EPS = 1e-7;
  const basis = [];
  const dependent = new Set();

  rows.forEach((row, idx) => {
    let v = row.slice();
    // Remove the components already spanned by accepted rows
    for (const b of basis) {
      const dot = v.reduce((s, x, i) => s + x * b[i], 0);
      for (let i = 0; i < v.length; i++) v[i] -= dot * b[i];
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (norm < EPS) {
      dependent.add(idx);
      return;
    }
    basis.push(v.map((x) => x / norm));
  });

  return { rank: basis.length, dependent };
}

/** Which motor should be highlighted for a given stick input — used by the UI. */
export function dominantMotors(frame, demands) {
  const table = getMixer(frame);
  const contributions = table.map((m) => ({
    index: m.index,
    value:
      (demands.roll || 0) * m.roll +
      (demands.pitch || 0) * m.pitch +
      (demands.yaw || 0) * m.yaw,
  }));
  contributions.sort((a, b) => b.value - a.value);
  return contributions;
}
