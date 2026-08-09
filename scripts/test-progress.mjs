#!/usr/bin/env node
/**
 * REGRESSION TEST — DOES PROGRESS SURVIVE LEAVING THE FLIGHT FIELD?
 * ================================================================
 * Run with `npm run test:progress`.
 *
 * THE BUG THIS GUARDS
 * -------------------
 * Module 1's last task is a hover, and it was checked by reading the live
 * telemetry object. Telemetry is null in the assembly bay, so the moment a
 * student walked back from the flight field the tick came off, the count fell
 * from 11 to 10, and the sync wrote the lower number to their school's
 * dashboard. Reported three separate times, and twice I "fixed" it without ever
 * running the thing end to end.
 *
 * So this exists. It flies an actual hover through the actual physics and then
 * asks the actual curriculum whether the module is finished — before and after
 * telemetry goes away. No mocks anywhere: a mock of the flight simulator would
 * have happily passed while the product stayed broken.
 *
 * It also asserts the OLD behaviour, deliberately. A test that only checks the
 * fixed path cannot tell you whether it is still testing anything.
 */
import { FlightSim } from "../src/sim/flightSim.js";
import { buildProgressApi, evaluateModule } from "../src/sim/progress.js";
import { MODULE_BY_ID } from "../src/data/curriculum.js";
import { makeInitialBuild } from "../src/sim/useBuildHistory.js";
import { runDiagnostics } from "../src/sim/diagnostics.js";
import { AIRFRAMES } from "../src/data/airframes.js";
import { PARTS, requiredQty, defaultVariant } from "../src/data/parts.js";
import { allWireIds } from "../src/data/wiring.js";

const MODULE = MODULE_BY_ID.m1;
const frame = AIRFRAMES.quad;
const env = { wind: 0, payload: 0, temperature: 25, altitude: 0 };

/* A finished module-1 aircraft. Derived from the data files rather than
   hand-listed, so adding a part to the curriculum cannot silently leave this
   test asserting less than it looks like it does. */
const build = makeInitialBuild("quad");
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

const diagnostics = runDiagnostics(build, frame, env);
const evaluate = (telemetry, earned) =>
  evaluateModule(
    MODULE,
    buildProgressApi({ build, frame, telemetry, diagnostics, completedModules: new Set(), earned })
  );

/* ------------------------------------------------------------ fly it */
const sim = new FlightSim();
sim.configure({
  build,
  env,
  capabilities: {
    gps: true, satelliteCap: 12, positionHold: true,
    imuWorking: true, imuCalibrated: true, baroWorking: true, rcLink: true,
  },
});
sim.arm();

/* Throttle is a climb-RATE demand, not a power setting: Space climbs and
   releasing it holds altitude. Climb to 2m and let it sit. */
const dt = 1 / 60;
let t = 0;
while (t < 30 && !sim.achievements.has("hover")) {
  sim.setKey("Space", sim.pos.y < 2.0);
  sim.step(dt);
  t += dt;
}

const fail = (msg) => {
  console.error(`FAIL — ${msg}`);
  process.exit(1);
};

if (!sim.achievements.has("hover")) {
  fail(`no hover after ${t.toFixed(1)}s at ${sim.pos.y.toFixed(2)}m${sim.crashed ? " (crashed)" : ""}`);
}
console.log(`flew a hover in ${t.toFixed(1)}s at ${sim.pos.y.toFixed(2)}m`);

/* --------------------------------------------------------- assertions */
const telemetry = sim.telemetry();
const earned = new Set(telemetry.achievements); // what App.jsx accumulates

const inFlight = evaluate(telemetry, earned);
const inBay = evaluate(null, earned); // back at the bench, telemetry gone
const withoutFix = evaluate(null, new Set()); // the old behaviour

for (const [name, r] of [["in flight", inFlight], ["back in the bay", inBay]]) {
  console.log(`  ${name.padEnd(18)} ${r.doneCount}/${r.total} ${r.complete ? "complete" : "INCOMPLETE"}`);
  if (!r.complete) {
    const missing = r.tasks.filter((x) => !x.done).map((x) => x.label);
    fail(`module 1 is not complete ${name}; missing: ${missing.join(", ")}`);
  }
}

if (inBay.doneCount !== inFlight.doneCount) {
  fail(`count changed on leaving the field: ${inFlight.doneCount} -> ${inBay.doneCount}`);
}

/* The old path must still be broken, or this test has stopped proving
   anything — an accumulated set that is never consulted would pass every
   assertion above while the product regressed. */
if (withoutFix.doneCount !== inBay.doneCount - 1) {
  fail(
    "the pre-fix path no longer loses a task, so this test is not exercising " +
      `the guard any more (got ${withoutFix.doneCount}/${withoutFix.total})`
  );
}

console.log("\nPASS — module 1 stays complete when telemetry goes away");
