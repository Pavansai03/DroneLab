#!/usr/bin/env node
/**
 * REGRESSION TEST — CAN THE HEXA AND THE OCTO ACTUALLY BE BUILT AND FLOWN?
 * =======================================================================
 *     npm run test:airframes
 *
 * The quadcopter has been flown by every student who has ever opened this
 * simulator, so its bugs were found by people. The hexacopter and octocopter
 * were defined in the data files but never selectable, which means nothing in
 * them had ever been exercised — not the mixer, not the hover trim, not the
 * geometry, not the wiring loom. Unlocking the picker without this test would
 * ship three airframes with one airframe's worth of evidence behind it.
 *
 * WHY THIS FLIES THE REAL THING
 * -----------------------------
 * No mocks anywhere. It assembles each aircraft from the real parts list, wires
 * it with the real loom, hands it the real obstacle field built by the real
 * environment code, and flies the real physics. Everything it asserts is a
 * thing a student in a classroom would see.
 *
 * WHAT IT ASSERTS, PER AIRFRAME
 * -----------------------------
 *   1. Wiring.    The generated loom covers every motor, ESC and signal wire.
 *   2. Mixer.     All four axes commandable, hover load shared evenly, and the
 *                 yaw torques cancel — an airframe whose spins do not balance
 *                 will creep round in a hover forever.
 *   3. Geometry.  Arms evenly spaced, and the hub's arm mounts land under the
 *                 arms rather than between them.
 *   4. Diagram.   Motor numbering and CW/CCW match the printed wiring sheet.
 *   5. Redundancy. A dead motor is survivable on the frames whose cards promise
 *                  it, and fatal on the quad, whose card promises it is not.
 *   6. Flight.    In BOTH fields: take off, hover without drifting, fly a
 *                 square, and return to home without hitting anything.
 */

import { FlightSim } from "../src/sim/flightSim.js";
import { buildCity, buildForest } from "../src/three/environments.js";
import { makeInitialBuild } from "../src/sim/useBuildHistory.js";
import { AIRFRAMES, AIRFRAME_LIST } from "../src/data/airframes.js";
import { PARTS, requiredQty, defaultVariant } from "../src/data/parts.js";
import { allWireIds, buildHarnesses, wiringStatus } from "../src/data/wiring.js";
import { analyseAuthority, getMixer } from "../src/sim/mixer.js";
import { performanceSummary, packSpec } from "../src/sim/physics.js";
import { buildHubPlate } from "../src/three/partMeshes.js";

/* buildHubPlate only reads material slots off this, never renders — three.js
   geometry is perfectly happy without a WebGL context. */
const MATS = new Proxy({}, { get: () => undefined });

const env = { wind: 0, payload: 0, temperature: 25, altitude: 0 };
const dt = 1 / 60;

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`   FAIL  ${msg}`);
};
const pass = (msg) => console.log(`   ok    ${msg}`);

/** A complete, airworthy aircraft, derived from the data files. */
function airworthy(frame) {
  const build = makeInitialBuild(frame.id);
  const placed = {};
  const variants = {};
  for (const part of Object.values(PARTS)) {
    const n = requiredQty(part, frame);
    if (!n) continue;
    placed[part.id] = Array.from({ length: n }, (_, i) => i);
    variants[part.id] = defaultVariant(part, frame);
  }
  return {
    ...build,
    placed,
    variants,
    links: new Set(allWireIds(frame)),
    flags: { ...build.flags, powered: true, motorTestPassed: true, imuCalibrated: true },
    faults: [],
  };
}

function newSim(frame, obstacles) {
  const sim = new FlightSim();
  sim.configure({
    build: airworthy(frame),
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
  return sim;
}

/* ==================================================================== */
/* 1. WIRING                                                            */
/* ==================================================================== */
function checkWiring(frame) {
  const n = frame.motorCount;
  const components = null; // full build
  const status = wiringStatus(frame, components, new Set(allWireIds(frame)));

  if (!status.allRequiredDone) {
    fail(`the generated loom does not wire itself completely (${frame.label})`);
    return;
  }
  for (let i = 0; i < n; i++) {
    if (!status.escSignal(i)) return fail(`ESC ${i + 1} has no signal wire`);
    if (!status.escPowered(i)) return fail(`ESC ${i + 1} has no power`);
  }

  /* Every motor must appear in the ESC->motor harness exactly once. A loom that
     silently stops at four wires would leave motors 5-8 unconnected and the
     student staring at a "not ready to fly" they cannot clear. */
  const harnesses = buildHarnesses(frame, null);
  const phases = harnesses.find((h) => h.id === "escs-motors");
  if (!phases || phases.wires.length !== n) {
    return fail(`ESC-to-motor loom has ${phases?.wires.length ?? 0} wires, expected ${n}`);
  }
  const signals = harnesses.find((h) => h.id === "fc-escs");
  if (signals && signals.wires.length !== n) {
    return fail(`FC-to-ESC signal loom has ${signals.wires.length} wires, expected ${n}`);
  }
  pass(`loom wires all ${n} motors, ESCs and signal lines`);
}

/* ==================================================================== */
/* 2. MIXER                                                             */
/* ==================================================================== */
function checkMixer(frame) {
  const perf = performanceSummary({ frame, env });
  const thrustPerMotor = perf.tMaxPerMotor;

  const a = analyseAuthority(frame, new Set(), thrustPerMotor, perf.weightN);
  if (!a.fullAuthority) {
    fail(`intact airframe lacks full control authority — ${a.note}`);
  } else {
    pass(`all four axes commandable, load spread ${a.loadSpread}x`);
  }

  if (!perf.canHover) {
    fail(`cannot hover: thrust-to-weight ${perf.thrustToWeight.toFixed(2)}`);
  } else {
    pass(`thrust-to-weight ${perf.thrustToWeight.toFixed(2)}, hover throttle ${(perf.hoverThrottle * 100).toFixed(0)}%`);
  }

  /* Yaw balance. Equal numbers of CW and CCW motors is necessary but not
     sufficient — they also have to be arranged so the torques cancel at the
     hover trim, otherwise the aircraft rotates slowly and forever. */
  const spinSum = frame.motors.reduce((s, m) => s + m.spin, 0);
  if (spinSum !== 0) {
    fail(`spin directions do not balance: sum ${spinSum} (needs equal CW and CCW)`);
  } else {
    pass(`yaw torque balanced (${frame.motorCount / 2} CW, ${frame.motorCount / 2} CCW)`);
  }

  /* The mixer's own yaw column must sum to zero for the same reason. */
  const table = getMixer(frame);
  const yawSum = table.reduce((s, m) => s + m.yaw, 0);
  if (Math.abs(yawSum) > 1e-9) fail(`mixer yaw column sums to ${yawSum}, not zero`);
}

/* ==================================================================== */
/* 2b. THE PACK CAN ACTUALLY FEED THE MOTORS                            */
/* ==================================================================== */
/**
 * The failure that started this file. Eight motors at full throttle pull over
 * 100 A, and 100 A through a 3S pack's internal resistance drops the terminal
 * voltage below the critical threshold — the octocopter browned out and fell
 * out of the sky on every single take-off, on a full battery, with nothing
 * wrong with it.
 *
 * Surviving is not the bar. A build that clears the brown-out by a hundredth of
 * a volt on a windless day at 25 degC fails the first time a student adds a
 * payload, so this demands real headroom: a sixth of a volt per cell, held
 * through a full-throttle climb from a full pack.
 */
const SAG_MARGIN_PER_CELL = 0.15;

function checkPack(frame) {
  const sim = newSim(frame, []);
  sim.arm();
  sim.setKey("Space", true);

  let minV = Infinity;
  let peakA = 0;
  for (let t = 0; t < 8 && !sim.crashed; t += dt) {
    sim.step(dt);
    minV = Math.min(minV, sim.voltage);
    peakA = Math.max(peakA, sim.currentA);
  }

  const pack = packSpec(sim.cells);
  const floor = pack.vCritical + SAG_MARGIN_PER_CELL * pack.cells;

  if (sim.crashed) {
    return fail(`${pack.label} pack browned out on a full-throttle climb — ${sim.crashCause}`);
  }
  if (minV < floor) {
    return fail(
      `${pack.label} pack sagged to ${minV.toFixed(2)} V at ${peakA.toFixed(0)} A — ` +
        `needs to stay above ${floor.toFixed(2)} V (critical ${pack.vCritical.toFixed(2)} V)`
    );
  }
  pass(
    `${pack.label} ${sim.capacityMah} mAh holds ${minV.toFixed(1)} V at ${peakA.toFixed(0)} A ` +
      `(${(minV / pack.cells).toFixed(2)} V/cell, ${(minV - pack.vCritical).toFixed(2)} V of headroom)`
  );
}

/* ==================================================================== */
/* 3. GEOMETRY                                                          */
/* ==================================================================== */
function checkGeometry(frame) {
  const n = frame.motorCount;
  const angles = frame.armAngles;

  if (angles.length !== n) {
    return fail(`${angles.length} arm angles for ${n} motors`);
  }

  const expectedGap = 360 / n;
  for (let i = 0; i < n; i++) {
    const gap = ((angles[(i + 1) % n] - angles[i] + 360) % 360) || 360;
    if (Math.abs(gap - expectedGap) > 0.001) {
      return fail(`arms ${i + 1} and ${((i + 1) % n) + 1} are ${gap} deg apart, expected ${expectedGap}`);
    }
  }
  pass(`${n} arms evenly spaced every ${expectedGap} deg`);

  /* The hub plate carries a mount nub per arm, and the nubs are identical — so
     what matters is that the SET of nub positions covers the set of arm
     directions, not which nub is paired with which arm.
     buildHubPlate is the only place in the project that lays parts out itself
     instead of going through buildSlots(), so it is the only place the
     convention can drift. Read the real mesh and check where the nubs landed. */
  const hub = buildHubPlate(MATS, frame);
  const R = hub.userData.plateRadius * 0.85;
  const nubs = hub.children
    .filter((c) => c.geometry?.parameters?.radiusTop === 0.05)
    .map((c) => [c.position.x, c.position.z]);

  if (nubs.length !== n) {
    return fail(`hub plate has ${nubs.length} arm-mounts for ${n} arms`);
  }
  for (const a of angles) {
    const r = (a * Math.PI) / 180;
    const ax = -Math.sin(r) * R;
    const az = Math.cos(r) * R;
    const found = nubs.some(([x, z]) => Math.hypot(x - ax, z - az) < 1e-6);
    if (!found) {
      return fail(
        `no hub arm-mount under the ${a} deg arm (expected near ` +
          `${ax.toFixed(2)}, ${az.toFixed(2)}) — the mounts sit between the arms`
      );
    }
  }
  pass(`all ${n} hub arm-mounts sit under their arms`);
}

/* ==================================================================== */
/* 4. THE PRINTED WIRING SHEET                                          */
/* ==================================================================== */
/**
 * Straight off the course diagrams. The quad sheet numbers M1 front-right and
 * starts CW; the hexa and octo sheets both start CCW at M1 and alternate round
 * the ring. They disagree, and the diagrams are what the students have in front
 * of them, so each airframe matches its own sheet rather than a tidier rule.
 */
const DIAGRAM = {
  quad: ["CW", "CCW", "CW", "CCW"],
  hexa: ["CCW", "CW", "CCW", "CW", "CCW", "CW"],
  octo: ["CCW", "CW", "CCW", "CW", "CCW", "CW", "CCW", "CW"],
};

function checkDiagram(frame) {
  const want = DIAGRAM[frame.id];
  const got = frame.motors.map((m) => m.spinLabel);
  const mismatch = got.findIndex((s, i) => s !== want[i]);
  if (mismatch >= 0) {
    fail(
      `M${mismatch + 1} spins ${got[mismatch]} but the wiring sheet says ${want[mismatch]} ` +
        `(sheet: ${want.join(" ")} / code: ${got.join(" ")})`
    );
  } else {
    pass(`motor directions match the wiring sheet: ${want.join(" ")}`);
  }

  /* Numbering runs clockwise from the nose on all three sheets, and M1 is the
     first arm clockwise of the nose. That — not the exact wording of the
     position labels — is the invariant a student checks their build against. */
  const angles = frame.motors.map((m) => m.angle);
  const clockwise = angles.every((a, i) => i === 0 || a > angles[i - 1]);
  const firstGap = 360 / frame.motorCount / 2;
  if (!clockwise) {
    fail(`motor numbering does not run clockwise: ${angles.join(", ")} deg`);
  } else if (Math.abs(angles[0] - firstGap) > 0.001) {
    fail(`M1 sits at ${angles[0]} deg; the first arm clockwise of the nose is at ${firstGap} deg`);
  } else {
    pass(`M1 at ${angles[0]} deg, numbering clockwise from the nose as printed`);
  }
}

/* ==================================================================== */
/* 4b. REDUNDANCY — THE REASON THESE AIRFRAMES EXIST                    */
/* ==================================================================== */
/**
 * The whole lesson of the hexacopter and the octocopter, and the one claim on
 * their cards in the picker: extra motors buy you a motor failure.
 *
 * This is not scripted anywhere. The mixer re-solves the hover trim across the
 * survivors and the rigid body integrates whatever torques come out, so the
 * outcome is emergent — which also means it could silently stop being true after
 * any change to the mixer, the masses or the thrust model. If a card promises a
 * student their hexacopter survives a dead motor, something has to check.
 *
 * The quad is included deliberately, and its assertion is the opposite one: it
 * must NOT survive. A quadcopter that shrugged off a dead motor would teach the
 * single most dangerous falsehood in the course.
 */
function checkRedundancy(frame) {
  const sim = newSim(frame, []);
  sim.arm();

  sim.setKey("Space", true);
  for (let t = 0; t < 15 && sim.pos.y < 25 && !sim.crashed; t += dt) sim.step(dt);
  sim.setKey("Space", false);
  if (sim.crashed || sim.pos.y < 20) {
    return fail(`could not reach 25 m to stage a motor failure (got ${sim.pos.y.toFixed(1)} m)`);
  }

  // Kill M1. runtimeDead is what an ESC shutdown or a departed prop sets, so
  // this is the same path a real in-flight failure takes.
  sim.runtimeDead = new Set([0]);
  sim.dead = new Set([0]);

  let t = 0;
  while (t < 20 && !sim.crashed) {
    sim.step(dt);
    t += dt;
  }
  const yawRate = Math.abs(sim.r);

  if (frame.redundantMotors === 0) {
    if (!sim.crashed) {
      return fail(
        `survived a dead motor for 20 s with no spare — a quadcopter must not, ` +
          `and the failure model tells students it cannot`
      );
    }
    return pass(`loses a motor and goes down in ${t.toFixed(1)} s — ${sim.crashCause}`);
  }

  if (sim.crashed) {
    return fail(
      `crashed ${t.toFixed(1)} s after one motor failed — the picker promises it survives ` +
        `${frame.redundantMotors} (${sim.crashCause})`
    );
  }
  if (sim.pos.y < 15) {
    return fail(`sank to ${sim.pos.y.toFixed(1)} m in the 20 s after a motor failed`);
  }
  pass(
    `flies on after a dead motor: 20 s, held ${sim.pos.y.toFixed(0)} m, ` +
      `yaw drift ${yawRate.toFixed(2)} rad/s`
  );
}

/* ==================================================================== */
/* 5. FLIGHT, IN BOTH FIELDS                                            */
/* ==================================================================== */
function hold(sim, keys, seconds, watch) {
  for (const k of Object.keys(keys)) sim.setKey(k, keys[k]);
  let t = 0;
  while (t < seconds && !sim.crashed) {
    sim.step(dt);
    t += dt;
    watch?.(sim);
  }
  for (const k of Object.keys(keys)) sim.setKey(k, false);
}

function flightTest(frame, fieldName, obstacles, tallest) {
  const sim = newSim(frame, obstacles);
  sim.arm();

  let minClear = Infinity;
  const watch = (s) => {
    if (Number.isFinite(s.obstacleDistance)) minClear = Math.min(minClear, s.obstacleDistance);
  };

  /* ---- take off and climb above the field ----
     Above everything, deliberately. What is being tested below is that six and
     eight motors translate and hold position the way four do, and that question
     has nothing to do with obstacles. Flown at treetop height the square leg
     steers straight into a randomly placed pine on maybe one seed in four — and
     a drone flown manually into a tree SHOULD hit it, so the crash would be the
     simulator working while the test called it a defect. Obstacle avoidance is
     RTH's job and RTH is tested on its own, below and in test-rth.mjs. */
  const cruise = tallest + 12;
  let guard = 0;
  while (sim.pos.y < cruise && guard < 40 && !sim.crashed) {
    hold(sim, { Space: true }, 1, watch);
    guard++;
  }
  if (sim.crashed) return fail(`${fieldName}: crashed on take-off — ${sim.crashCause}`);
  if (sim.pos.y < cruise) {
    return fail(
      `${fieldName}: only reached ${sim.pos.y.toFixed(1)} m of the ${cruise.toFixed(0)} m ` +
        `needed to clear the field, after ${guard} s of full throttle`
    );
  }
  const climbAlt = sim.pos.y;

  /* ---- hover: no drift, no yaw creep ---- */
  const yaw0 = sim.yaw;
  const x0 = sim.pos.x;
  const z0 = sim.pos.z;
  hold(sim, {}, 8, watch);
  if (sim.crashed) return fail(`${fieldName}: crashed while hovering — ${sim.crashCause}`);

  const drift = Math.hypot(sim.pos.x - x0, sim.pos.z - z0);
  const yawCreep = Math.abs(((sim.yaw - yaw0) * 180) / Math.PI);
  const sink = climbAlt - sim.pos.y;

  if (drift > 3) fail(`${fieldName}: drifted ${drift.toFixed(1)} m in an 8 s hands-off hover`);
  if (yawCreep > 15) fail(`${fieldName}: yawed ${yawCreep.toFixed(0)} deg in an 8 s hover — torques are not cancelling`);
  if (sink > 6) fail(`${fieldName}: sank ${sink.toFixed(1)} m in an 8 s hover`);

  /* ---- fly a square: every axis, under its own power ---- */
  for (const leg of [{ KeyW: true }, { KeyE: true }, { KeyS: true }, { KeyQ: true }]) {
    hold(sim, leg, 3, watch);
    hold(sim, {}, 1.5, watch);
    if (sim.crashed) {
      return fail(`${fieldName}: crashed flying the square — ${sim.crashCause}`);
    }
  }

  /* ---- return home ---- */
  if (!sim.triggerRth()) {
    return fail(`${fieldName}: RTH refused with a GPS lock (${sim.satellites} sats)`);
  }
  let t = 0;
  while (t < 180 && !sim.crashed) {
    sim.step(dt);
    t += dt;
    watch(sim);
    if (Math.hypot(sim.pos.x, sim.pos.z) < 6 && sim.pos.y < 0.5) break;
  }
  if (sim.crashed) return fail(`${fieldName}: crashed during RTH — ${sim.crashCause}`);

  const home = Math.hypot(sim.pos.x, sim.pos.z);
  if (home > 6) return fail(`${fieldName}: RTH stopped ${home.toFixed(1)} m from the pad`);
  if (minClear <= 0) return fail(`${fieldName}: clearance reached ${minClear.toFixed(2)} m — it touched something`);

  pass(
    `${fieldName}: climbed ${climbAlt.toFixed(0)} m, drift ${drift.toFixed(1)} m, ` +
      `yaw ${yawCreep.toFixed(0)} deg, home in ${t.toFixed(0)} s, clearance ${minClear.toFixed(1)} m`
  );
}

/* ==================================================================== */
/* RUN                                                                  */
/* ==================================================================== */
const FIELDS = [
  ["forest", buildForest().userData?.obstacles ?? []],
  ["city  ", buildCity().userData?.obstacles ?? []],
].map(([name, list]) => {
  if (!list.length) {
    console.error(`FAIL — the ${name.trim()} field produced no colliders; this test would prove nothing`);
    process.exit(1);
  }
  // Both fields are generated afresh every run, so heights are measured rather
  // than assumed — this test has flown hundreds of different maps, not one.
  return [name, list, list.reduce((m, o) => Math.max(m, o.y1 ?? 0), 0)];
});

console.log("\nAIRFRAMES — build, wire, mix and fly every selectable copter\n");

for (const frame of AIRFRAME_LIST) {
  console.log(`${frame.label} (${frame.motorCount} motors, ${frame.dryMassKg} kg dry)`);
  checkWiring(frame);
  checkMixer(frame);
  checkPack(frame);
  checkGeometry(frame);
  checkDiagram(frame);
  checkRedundancy(frame);
  for (const [name, obstacles, tallest] of FIELDS) {
    flightTest(frame, name, obstacles, tallest);
  }
  console.log("");
}

/* Every airframe the picker offers must be one this test has flown. A frame
   added to the data file and quietly shipped untested is the exact failure this
   whole file exists to prevent. */
const offered = Object.keys(AIRFRAMES);
const tested = AIRFRAME_LIST.map((f) => f.id);
for (const id of offered) {
  if (!tested.includes(id)) fail(`AIRFRAMES.${id} is defined but not in AIRFRAME_LIST, so nothing tests it`);
}

if (failures) {
  console.log(`FAIL — ${failures} problem(s)\n`);
  process.exit(1);
}
console.log("PASS — every airframe builds, wires, mixes and flies in both fields\n");
