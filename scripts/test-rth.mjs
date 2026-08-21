#!/usr/bin/env node
/**
 * REGRESSION TEST — DOES RETURN-TO-HOME ACTUALLY GET HOME?
 * ========================================================
 *     npm run test:rth
 *
 * RTH is the one control a student presses when they are already in trouble:
 * lost orientation, low battery, drone a speck on the horizon. It is the
 * feature that has to work when nothing else is going well, and if it flies
 * them into a tower block it is worse than not existing — they would have
 * flown home manually instead.
 *
 * It flew them into a tower block. The old autopilot climbed to 6-9 metres and
 * then went straight home, and the city field has buildings up to twenty-eight
 * storeys. Six metres is below the first floor.
 *
 * WHY THIS FLIES THE REAL THING
 * -----------------------------
 * No mocks. It builds the actual city field (517 colliders, headless — three.js
 * geometry needs no renderer), hands them to the actual FlightSim, and flies the
 * actual physics from a set of starting positions scattered around the map. A
 * mock obstacle field would have happily passed while the product stayed broken;
 * that is precisely the mistake the progress test was written to stop repeating.
 *
 * WHAT IT ASSERTS, PER START POSITION
 * -----------------------------------
 *   1. It arrives.        Within ARRIVE_RADIUS of the pad, on the ground.
 *   2. It does not crash. The sim's own collision test, not a separate one.
 *   3. It keeps clearance. Minimum obstacle clearance stays positive for the
 *      whole flight — a run that survives by a centimetre is a run that fails
 *      on the next field, and this catches it before the crash does.
 *   4. It is not absurd.  No wandering: the flight is bounded in time, and the
 *      cruise altitude is no higher than the tallest thing in the way plus a
 *      margin, so "safe" is not bought with a pointless climb to the ceiling.
 */

import { FlightSim } from "../src/sim/flightSim.js";
import { ObstacleField } from "../src/sim/obstacles.js";
import { buildCity, buildForest } from "../src/three/environments.js";
import { makeInitialBuild } from "../src/sim/useBuildHistory.js";
import { AIRFRAMES } from "../src/data/airframes.js";
import { PARTS, requiredQty, defaultVariant } from "../src/data/parts.js";
import { allWireIds } from "../src/data/wiring.js";

const frame = AIRFRAMES.quad;
const env = { wind: 0, payload: 0, temperature: 25, altitude: 0 };

/* A complete, airworthy aircraft, derived from the data files rather than
   hand-listed — the same construction the progress test uses. */
const build = makeInitialBuild("quad");
{
  const placed = {};
  const variants = {};
  for (const part of Object.values(PARTS)) {
    const n = requiredQty(part, frame);
    if (!n) continue;
    placed[part.id] = Array.from({ length: n }, (_, i) => i);
    variants[part.id] = defaultVariant(part, frame);
  }
  Object.assign(build, {
    placed,
    variants,
    links: new Set(allWireIds(frame)),
    flags: { ...build.flags, powered: true, motorTestPassed: true, imuCalibrated: true },
    faults: [],
  });
}

/* Exactly where droneScene.js reads them from — see its `fieldObstacles`. */
const city = buildCity();
const obstacles = city.userData?.obstacles ?? [];
if (!obstacles.length) {
  console.error("FAIL — the city field produced no colliders; this test would prove nothing");
  process.exit(1);
}

const tallest = obstacles.reduce((m, o) => Math.max(m, o.y1 ?? 0), 0);

/* ------------------------------------------------------------- the runs */
/**
 * The city is generated afresh on every run — building heights, positions and
 * the crane's angle are all random. That is worth keeping: it means this test
 * has flown hundreds of different skylines rather than one lucky one. It does
 * mean a hard-coded start point can land inside a building on some seeds, which
 * would fail the test for a reason that has nothing to do with the autopilot.
 *
 * So each case names a direction and a distance, and the open-air spot nearest
 * to that is found in the actual field before the flight begins.
 */
const field = new ObstacleField(obstacles);

function openSpotNear(nx, nz, y) {
  let best = null;
  for (let ox = -16; ox <= 16; ox += 4) {
    for (let oz = -16; oz <= 16; oz += 4) {
      const x = nx + ox;
      const z = nz + oz;
      if (Math.hypot(x, z) < 55) continue; // must still be a real journey home
      const clear = field.nearest(x, y, z).distance;
      if (!best || clear > best.clear) best = { x, z, clear };
    }
  }
  return best;
}

const CASES = [
  { n: "north, low, behind towers", x: 0, z: 90, y: 5 },
  { n: "north-east, far          ", x: 90, z: 90, y: 6 },
  { n: "due east                 ", x: 95, z: 0, y: 4 },
  { n: "west, past the crane     ", x: -120, z: 0, y: 5 },
  { n: "north-west               ", x: -110, z: 60, y: 7 },
  { n: "far north, long run home ", x: 40, z: 125, y: 5 },
  { n: "already high, short hop  ", x: 80, z: 60, y: 60 },
];

const STARTS = CASES.map((c) => {
  const spot = openSpotNear(c.x, c.z, c.y);
  return { ...c, x: spot.x, z: spot.z };
});

const ARRIVE_RADIUS = 6; // metres from the pad, horizontally
const TIME_LIMIT = 180; // seconds of simulated flight
const dt = 1 / 60;

function fly(start, field = obstacles) {
  const sim = new FlightSim();
  sim.configure({
    build,
    env,
    capabilities: {
      gps: true,
      satelliteCap: 12,
      positionHold: true,
      imuWorking: true,
      imuCalibrated: true,
      baroWorking: true,
      rcLink: true,
    },
  });
  sim.setObstacles(field);

  /* Satellites are acquired over time; RTH is not allowed without a lock, so
     give it one the way sitting on the pad would. */
  sim.satTimer = 20;
  sim.arm();

  /* Place it out in the field, stationary and level. */
  sim.pos.x = start.x;
  sim.pos.z = start.z;
  sim.pos.y = start.y;
  sim.vel.x = 0;
  sim.vel.y = 0;
  sim.vel.z = 0;
  sim.onGround = false;
  sim.step(dt); // one step so satellites and state settle before the trigger

  /* If the aircraft begins inside something, nothing below is a test of the
     autopilot — say so rather than reporting a crash it could never avoid. */
  const spawnClearance = sim.obstacleDistance;

  const triggered = sim.triggerRth();

  let t = 0;
  let minClearance = Infinity;
  let peakAltitude = sim.pos.y;

  while (t < TIME_LIMIT) {
    sim.step(dt);
    t += dt;
    if (Number.isFinite(sim.obstacleDistance)) {
      minClearance = Math.min(minClearance, sim.obstacleDistance);
    }
    peakAltitude = Math.max(peakAltitude, sim.pos.y);
    if (sim.crashed) break;
    const home = Math.hypot(sim.pos.x, sim.pos.z);
    if (home < ARRIVE_RADIUS && sim.pos.y < 0.5) break;
  }

  return {
    spawnClearance,
    triggered,
    crashed: sim.crashed,
    cause: sim.crashCause,
    home: Math.hypot(sim.pos.x, sim.pos.z),
    alt: sim.pos.y,
    minClearance,
    peakAltitude,
    seconds: t,
  };
}

/* ------------------------------------------------------------- run them */
let failures = 0;

console.log(`\ncity field: ${obstacles.length} colliders, tallest ${tallest.toFixed(1)} m\n`);
console.log("start                       home    alt   clearance   peak    time   verdict");
console.log("─".repeat(80));

for (const start of STARTS) {
  const r = fly(start);

  const problems = [];
  if (!(r.spawnClearance > 2)) {
    problems.push(`start point is not in open air (clearance ${r.spawnClearance.toFixed(1)} m)`);
  }
  if (!r.triggered) problems.push("RTH refused to arm");
  if (r.crashed) problems.push(`CRASHED: ${r.cause}`);
  if (!r.crashed && r.home > ARRIVE_RADIUS) problems.push(`never got home (${r.home.toFixed(1)} m out)`);
  if (!r.crashed && r.alt > 0.6) problems.push(`did not land (${r.alt.toFixed(1)} m up)`);
  if (r.minClearance <= 0) problems.push(`clearance went to ${r.minClearance.toFixed(2)} m`);
  if (r.seconds >= TIME_LIMIT) problems.push("ran out of time");
  /* Safe must not mean "climb to the legal ceiling and hope". The tallest thing
     in the field plus a sane margin is the most it should ever need. */
  if (r.peakAltitude > tallest + 25) {
    problems.push(`climbed to ${r.peakAltitude.toFixed(0)} m for a ${tallest.toFixed(0)} m skyline`);
  }

  const ok = problems.length === 0;
  if (!ok) failures++;

  console.log(
    `${start.n}  ${r.home.toFixed(1).padStart(5)}  ${r.alt.toFixed(1).padStart(5)}  ` +
      `${(Number.isFinite(r.minClearance) ? r.minClearance.toFixed(2) : "  -- ").padStart(9)}  ` +
      `${r.peakAltitude.toFixed(0).padStart(4)}  ${r.seconds.toFixed(0).padStart(5)}s   ` +
      (ok ? "ok" : problems.join("; "))
  );
}

/* ------------------------------------------------------------- forest */
/**
 * The same autopilot over a much lower field.
 *
 * This is what makes "shortest" a real claim rather than a comfortable word: a
 * fixed safe altitude tuned for the city would drag the aircraft to seventy
 * metres to cross a wood with nothing in it above twenty-two, wasting a minute
 * of battery on every return. The corridor check should ask for barely more
 * than the treetops here.
 */
console.log("");
{
  const forest = buildForest().userData?.obstacles ?? [];
  const forestTallest = forest.reduce((m, o) => Math.max(m, o.y1 ?? 0), 0);
  const ff = new ObstacleField(forest);

  let bestSpot = null;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
    const x = Math.cos(a) * 85;
    const z = Math.sin(a) * 85;
    const clear = ff.nearest(x, 5, z).distance;
    if (!bestSpot || clear > bestSpot.clear) bestSpot = { x, z, clear };
  }

  const r = fly({ x: bestSpot.x, z: bestSpot.z, y: 5 }, forest);
  const ceiling = forestTallest + 20;
  const ok = !r.crashed && r.home < ARRIVE_RADIUS && r.minClearance > 0 && r.peakAltitude < ceiling;

  console.log(
    `forest: ${forest.length} colliders, tallest ${forestTallest.toFixed(1)} m — ` +
      `RTH peaked at ${r.peakAltitude.toFixed(0)} m, home in ${r.seconds.toFixed(0)}s, ` +
      `clearance ${r.minClearance.toFixed(2)} m`
  );
  if (!ok) {
    console.error(
      `FAIL — forest RTH: ${r.crashed ? `crashed (${r.cause})` : ""}` +
        `${r.home >= ARRIVE_RADIUS ? ` never got home (${r.home.toFixed(1)} m out)` : ""}` +
        `${r.peakAltitude >= ceiling ? ` climbed to ${r.peakAltitude.toFixed(0)} m over a ${forestTallest.toFixed(0)} m wood` : ""}`
    );
    failures++;
  }
}

/* ------------------------------------------------- the GPS precondition */
/* "Return to home" without GPS is a contradiction: nothing on board knows
   where home is. The button has to refuse rather than fly a guess. */
console.log("");
{
  const sim = new FlightSim();
  sim.configure({
    build,
    env,
    capabilities: {
      gps: false,
      satelliteCap: 0,
      positionHold: false,
      imuWorking: true,
      imuCalibrated: true,
      baroWorking: true,
      rcLink: true,
    },
  });
  sim.setObstacles(obstacles);
  sim.arm();
  sim.pos.y = 10;
  sim.onGround = false;
  sim.step(dt);

  const allowed = sim.triggerRth();
  if (allowed || sim.rthActive) {
    console.error("FAIL — RTH engaged with no GPS; it cannot know where home is");
    failures++;
  } else {
    console.log("no GPS: RTH refuses, as it must");
  }
}

/* ------------------------------------------------------- the failsafe */
/**
 * Losing the radio link with no satellites.
 *
 * The autopilot takes over either way — the pilot has no sticks any more — but
 * with no fix there is no "home" to return to. Flying a guess would be worse
 * than useless in a city, so it descends where it stands, which is what a real
 * controller does. This is a behaviour change and worth pinning: the old code
 * engaged RTH regardless and set off towards a launch point it could not know.
 */
{
  const sim = new FlightSim();
  sim.configure({
    build,
    env,
    capabilities: {
      gps: false,
      satelliteCap: 0,
      positionHold: false,
      imuWorking: true,
      imuCalibrated: true,
      baroWorking: true,
      rcLink: false, // the link is down
    },
  });
  sim.setObstacles(obstacles);
  sim.arm();
  /* Open air, and above the rooftops — descending onto a roof is a legitimate
     outcome here, but starting inside one tests nothing. */
  const spot = openSpotNear(60, 60, 30);
  const startX = spot.x;
  const startZ = spot.z;
  sim.pos.x = startX;
  sim.pos.z = startZ;
  sim.pos.y = 30;
  sim.onGround = false;

  let t = 0;
  while (t < 90 && !sim.crashed && sim.pos.y > 0.5) {
    sim.step(dt);
    t += dt;
  }
  const drift = Math.hypot(sim.pos.x - startX, sim.pos.z - startZ);

  if (sim.rthHasFix) {
    console.error("FAIL — failsafe claimed a position fix it does not have");
    failures++;
  } else if (sim.crashed) {
    console.error(`FAIL — failsafe with no GPS crashed: ${sim.crashCause}`);
    failures++;
  } else if (drift > 15) {
    console.error(`FAIL — failsafe with no GPS wandered ${drift.toFixed(0)} m; it should land in place`);
    failures++;
  } else {
    console.log(
      `no GPS + no radio: descends in place (${drift.toFixed(1)} m of drift, ` +
        `down in ${t.toFixed(0)}s)`
    );
  }
}

/* And the opposite, so the check above cannot pass by simply always refusing. */
{
  const sim = new FlightSim();
  sim.configure({
    build,
    env,
    capabilities: {
      gps: true,
      satelliteCap: 12,
      positionHold: true,
      imuWorking: true,
      imuCalibrated: true,
      baroWorking: true,
      rcLink: true,
    },
  });
  sim.setObstacles(obstacles);
  sim.satTimer = 20;
  sim.arm();
  sim.pos.y = 10;
  sim.onGround = false;
  sim.step(dt);

  if (!sim.triggerRth() || !sim.rthActive) {
    console.error("FAIL — RTH refused with a good GPS lock; the check above proves nothing");
    failures++;
  } else {
    console.log("with a lock: RTH engages");
  }
}

console.log("");
if (failures) {
  console.error(`FAIL — ${failures} problem(s)`);
  process.exit(1);
}
console.log("PASS — RTH climbs over what is in the way, comes home, and lands");
