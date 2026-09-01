#!/usr/bin/env node
/**
 * REGRESSION TEST — DOES EACH AIRFRAME KEEP ITS OWN PROGRESS?
 * ===========================================================
 *     npm run test:workspaces
 *
 * Reported from a classroom: a student finished the hexacopter, switched to the
 * octocopter to start it, and the module rail showed Modules 1, 2 and 3 already
 * ticked on an aircraft with nothing bolted to it. The hexacopter they had
 * actually finished was gone.
 *
 * Both halves of that came from one cause: progress was a single record shared
 * by all three airframes. Ticks leaked forward onto work never done, and the
 * finished build was overwritten to make room for the new one.
 *
 * WHAT THIS ASSERTS
 * -----------------
 *   1. A fresh airframe starts blank — no modules, no flights, no parts.
 *   2. Parking an airframe and coming back restores it exactly.
 *   3. Nothing leaks sideways: finishing on one never marks another.
 *   4. It survives the round trip through JSON, Sets and all, because a record
 *      that only lives until reload has not actually solved anything.
 *   5. Pre-workspaces saves land on the airframe they were built with, and
 *      nowhere else.
 *
 * These are checked against the REAL progress engine — the same evaluateModule
 * and buildProgressApi the checklist runs — so "Module 1 is complete" here means
 * what it means on screen.
 */

import {
  emptyWorkspace,
  recall,
  stash,
  clearWorkspace,
  serialiseWorkspaces,
  deserialiseWorkspaces,
  migrateLegacySave,
} from "../src/sim/workspaces.js";
import { makeInitialBuild } from "../src/sim/useBuildHistory.js";
import { AIRFRAMES } from "../src/data/airframes.js";
import { PARTS, requiredQty, defaultVariant } from "../src/data/parts.js";
import { allWireIds } from "../src/data/wiring.js";
import { MODULES, MODULE_BY_ID } from "../src/data/curriculum.js";
import { buildProgressApi, evaluateModule } from "../src/sim/progress.js";
import { runDiagnostics } from "../src/sim/diagnostics.js";

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`   FAIL  ${msg}`);
};
const pass = (msg) => console.log(`   ok    ${msg}`);
const section = (t) => console.log(`\n${t}\n`);

/** A fully assembled, fully wired aircraft for `frameId`. */
function finishedBuild(frameId) {
  const frame = AIRFRAMES[frameId];
  const build = makeInitialBuild(frameId);
  const placed = {};
  const variants = {};
  for (const part of Object.values(PARTS)) {
    const n = requiredQty(part, frame);
    if (!n) continue;
    placed[part.id] = Array.from({ length: n }, (_, i) => ({ slot: i }));
    variants[part.id] = defaultVariant(part, frame);
  }
  return {
    ...build,
    placed,
    variants,
    links: new Set(allWireIds(frame)),
    flags: {
      ...build.flags,
      frameChosen: true,
      powered: true,
      motorTestPassed: true,
      imuCalibrated: true,
      compassCalibrated: true,
      escCalibrated: true,
      fcConfigured: true,
      wiringValidated: true,
      bound: true,
    },
  };
}

/**
 * Run the real checklist for a module against a workspace, exactly as the
 * sidebar does. No mock of "complete" — the engine decides.
 */
function moduleProgress(moduleId, workspace) {
  const frame = AIRFRAMES[workspace.build.frameId];
  const module = MODULE_BY_ID[moduleId];
  const componentSet = module.components?.length ? module.components : undefined;
  const build = {
    ...workspace.build,
    faultState: {
      deadMotor: [], deadEsc: [], reversedMotor: [], wrongProp: [],
      looseProp: [], jammedMotor: [], brokenPdbOutput: [],
      escTempBoost: {}, envOverride: {},
    },
    componentSet: componentSet ?? Object.keys(PARTS),
    requiresPdb: (componentSet ?? Object.keys(PARTS)).includes("pdb"),
  };
  const diagnostics = runDiagnostics(build, {
    soc: 1, voltage: null, sag: 0, satellites: 12,
    escTemps: new Array(frame.motorCount).fill(25),
    armed: false, thrustPerMotorN: 0, weightN: 0, propWash: 0,
    altitude: 0, groundSpeed: 0,
  });
  return evaluateModule(
    module,
    buildProgressApi({
      build,
      frame,
      telemetry: null,
      diagnostics,
      completedModules: workspace.completedModules,
      earned: workspace.earned,
    })
  );
}

/* ==================================================================== */
section("the old shared record is what produced the bug");
/* ==================================================================== */
/**
 * Proof that everything below can fail.
 *
 * This is the policy as it was: one build, one set of completed modules, one
 * set of flights, shared by every airframe. Modelled here and driven through
 * the same reported sequence, so the assertions that follow are measuring a
 * real difference rather than agreeing with themselves.
 */
{
  const shared = {
    build: finishedBuild("hexa"),
    completedModules: new Set(["m1", "m2", "m3"]),
    earned: new Set(["takeoff", "hover", "landing"]),
  };
  // "Switch to octocopter": the old code reset the build and kept the rest.
  const oldSwitch = {
    build: makeInitialBuild("octo"),
    completedModules: shared.completedModules,
    earned: shared.earned,
    moduleId: "m1",
  };

  if (oldSwitch.completedModules.size === 0) {
    fail("the old policy did not reproduce the reported bug — this test proves nothing");
  } else {
    pass(
      `the OLD policy ticks ${[...oldSwitch.completedModules].join(", ")} on an empty ` +
        `octocopter (this is the reported bug, and it is what the rest of this file rules out)`
    );
  }

  const m1 = moduleProgress("m1", oldSwitch);
  if (!m1.tasks.some((t) => t.done)) {
    fail("the old policy showed no ticked tasks either — the reproduction is incomplete");
  } else {
    const ticked = m1.tasks.filter((t) => t.done).map((t) => t.label);
    pass(`the OLD policy also pre-ticks ${ticked.length} flight task(s): ${ticked.join(", ")}`);
  }

  // And the other half of the report: the finished hexacopter was thrown away.
  if (oldSwitch.build.frameId === "octo" && Object.keys(shared.build.placed).length > 0) {
    pass("the OLD policy had nowhere to keep the finished hexacopter — switching overwrote it");
  }
}

/* ==================================================================== */
section("a fresh airframe starts from nothing");
/* ==================================================================== */
{
  /* The exact situation reported: hexacopter finished, octocopter opened. */
  let ws = {};
  ws = stash(ws, "hexa", {
    build: finishedBuild("hexa"),
    completedModules: new Set(["m1", "m2", "m3"]),
    earned: new Set(["takeoff", "hover", "landing", "gpsLock"]),
    moduleId: "m3",
  });

  const octo = recall(ws, "octo");

  if (octo.completedModules.size !== 0) {
    fail(`a never-opened octocopter starts with ${[...octo.completedModules].join(", ")} already complete`);
  } else {
    pass("no modules are ticked on an airframe that has never been opened");
  }

  if (octo.earned.size !== 0) {
    fail(`a never-flown octocopter has already earned ${[...octo.earned].join(", ")}`);
  } else {
    pass("no flights are credited to an airframe that has never flown");
  }

  const parts = Object.values(octo.build.placed || {}).reduce((n, a) => n + (a?.length || 0), 0);
  if (parts !== 0 || octo.build.links.size !== 0) {
    fail(`a fresh octocopter arrives with ${parts} parts and ${octo.build.links.size} wires fitted`);
  } else {
    pass("a fresh airframe arrives with nothing fitted and nothing wired");
  }

  if (octo.build.frameId !== "octo") {
    fail(`recalling "octo" produced a build for ${octo.build.frameId}`);
  } else {
    pass("the fresh build is for the airframe that was asked for");
  }

  /* And the real checklist agrees — this is the tick the student saw. */
  const m1 = moduleProgress("m1", octo);
  if (m1.complete || m1.doneCount > 0) {
    fail(`the checklist marks ${m1.doneCount}/${m1.total} of Module 1 done on an empty octocopter`);
  } else {
    pass(`the real checklist reports 0/${m1.total} on Module 1 for an empty octocopter`);
  }
}

/* ==================================================================== */
section("parking an airframe and coming back to it");
/* ==================================================================== */
{
  const hexaBuild = finishedBuild("hexa");
  let ws = stash({}, "hexa", {
    build: hexaBuild,
    completedModules: new Set(["m1", "m2"]),
    earned: new Set(["takeoff", "hover"]),
    moduleId: "m3",
  });
  // ... then the student goes off and starts an octocopter
  ws = stash(ws, "octo", {
    build: makeInitialBuild("octo"),
    completedModules: new Set(),
    earned: new Set(),
    moduleId: "m1",
  });

  const back = recall(ws, "hexa");
  const partCount = Object.values(back.build.placed).reduce((n, a) => n + a.length, 0);

  if (partCount !== Object.values(hexaBuild.placed).reduce((n, a) => n + a.length, 0)) {
    fail(`the hexacopter came back with ${partCount} parts, not the ones it was left with`);
  } else if (back.build.links.size !== hexaBuild.links.size) {
    fail(`the hexacopter came back with ${back.build.links.size} wires, not ${hexaBuild.links.size}`);
  } else {
    pass(`the finished hexacopter comes back whole: ${partCount} parts, ${back.build.links.size} wires`);
  }

  if (!back.completedModules.has("m1") || !back.completedModules.has("m2")) {
    fail(`the hexacopter lost its completed modules (has ${[...back.completedModules].join(", ") || "none"})`);
  } else {
    pass("its completed modules come back with it");
  }
  if (!back.earned.has("hover")) {
    fail("the hexacopter forgot that it had hovered");
  } else {
    pass("its flights come back with it");
  }
  if (back.moduleId !== "m3") {
    fail(`came back on module ${back.moduleId}, not the m3 it was left on`);
  } else {
    pass("it reopens on the module the student was working through");
  }

  /* The real checklist must agree the hexacopter is still finished. */
  const m1 = moduleProgress("m1", back);
  if (!m1.complete) {
    fail(`the checklist says the restored hexacopter is only ${m1.doneCount}/${m1.total} through Module 1`);
  } else {
    pass(`the real checklist still reports Module 1 complete (${m1.doneCount}/${m1.total})`);
  }
}

/* ==================================================================== */
section("nothing leaks sideways");
/* ==================================================================== */
{
  let ws = {};
  for (const id of ["quad", "hexa", "octo"]) {
    ws = stash(ws, id, { ...emptyWorkspace(id), moduleId: "m1" });
  }
  // Finish everything on the quad only.
  ws = stash(ws, "quad", {
    build: finishedBuild("quad"),
    completedModules: new Set(["m1", "m2", "m3"]),
    earned: new Set(["takeoff", "hover", "landing"]),
    moduleId: "m3",
  });

  for (const id of ["hexa", "octo"]) {
    const w = recall(ws, id);
    if (w.completedModules.size || w.earned.size) {
      fail(`finishing the quad marked ${w.completedModules.size} module(s) and ${w.earned.size} flight(s) on the ${id}`);
    } else {
      pass(`finishing the quad leaves the ${id} untouched`);
    }
  }

  /* Stripping one airframe must not strip the others. */
  const after = clearWorkspace(ws, "quad");
  if (recall(after, "quad").completedModules.size !== 0) {
    fail("clearing the quad left its modules behind");
  } else if (!recall(after, "hexa")) {
    fail("clearing the quad removed the hexacopter as well");
  } else {
    pass("clearing one airframe leaves the others alone");
  }
}

/* ==================================================================== */
section("the module rail — the ticks that were reported");
/* ==================================================================== */
/**
 * What the student actually saw: numbered buttons 1, 2 and 3 wearing check
 * marks on an octocopter they had not started. The rail is two lines of App.jsx
 * and both read `completedModules`, so they are reproduced here exactly:
 *
 *   badge   completedModules.has(m.id)
 *   unlock  allUnlocked || i === 0 || completedModules.has(MODULES[i-1].id)
 *                                  || completedModules.has(m.id)
 */
function rail(workspace, allUnlocked = false) {
  const done = workspace.completedModules;
  return MODULES.map((m, i) => ({
    n: m.number,
    tick: done.has(m.id),
    unlocked: allUnlocked || i === 0 || done.has(MODULES[i - 1].id) || done.has(m.id),
  }));
}

{
  let ws = stash({}, "hexa", {
    build: finishedBuild("hexa"),
    completedModules: new Set(["m1", "m2", "m3"]),
    earned: new Set(["takeoff", "hover", "landing"]),
    moduleId: "m3",
  });

  const octoRail = rail(recall(ws, "octo"));
  const ticked = octoRail.filter((r) => r.tick).map((r) => r.n);
  if (ticked.length) {
    fail(`the rail shows module ${ticked.join(", ")} ticked on an unstarted octocopter`);
  } else {
    pass("the rail shows no ticks on an unstarted octocopter");
  }

  const reachable = octoRail.filter((r) => r.unlocked).map((r) => r.n);
  if (reachable.length !== 1 || reachable[0] !== 1) {
    fail(`a fresh octocopter opens with modules ${reachable.join(", ")} unlocked, not just 1`);
  } else {
    pass("a fresh octocopter opens with only Module 1 reachable");
  }

  const hexaRail = rail(recall(ws, "hexa"));
  if (hexaRail.filter((r) => r.tick).length !== 3) {
    fail("the hexacopter's own rail lost its ticks");
  } else {
    pass("the hexacopter's rail still shows all three ticked");
  }

  /* Teacher mode is a session override, not progress: it must still open every
     module on an airframe with none complete. */
  if (!rail(recall(ws, "octo"), true).every((r) => r.unlocked)) {
    fail("teacher mode no longer unlocks every module on a fresh airframe");
  } else {
    pass("teacher mode still reaches every module on a fresh airframe");
  }
}

/* ==================================================================== */
section("it survives a reload");
/* ==================================================================== */
{
  let ws = stash({}, "hexa", {
    build: finishedBuild("hexa"),
    completedModules: new Set(["m1", "m2"]),
    earned: new Set(["takeoff", "hover"]),
    moduleId: "m2",
  });
  ws = stash(ws, "quad", {
    build: finishedBuild("quad"),
    completedModules: new Set(["m1"]),
    earned: new Set(["takeoff"]),
    moduleId: "m1",
  });

  /* Through actual JSON, which is what the database column holds. Sets do not
     survive this on their own — they serialise to {} and take every wire the
     student connected with them. */
  const round = deserialiseWorkspaces(JSON.parse(JSON.stringify(serialiseWorkspaces(ws))));

  const hexa = recall(round, "hexa");
  const original = recall(ws, "hexa");

  if (!(hexa.build.links instanceof Set)) {
    fail("links came back as something other than a Set");
  } else if (hexa.build.links.size !== original.build.links.size) {
    fail(`${hexa.build.links.size} wires survived the reload, out of ${original.build.links.size}`);
  } else {
    pass(`all ${hexa.build.links.size} wires survive the round trip through JSON`);
  }

  if (!(hexa.completedModules instanceof Set) || !hexa.completedModules.has("m2")) {
    fail("completed modules did not survive the reload");
  } else {
    pass("completed modules survive the reload");
  }
  if (!(hexa.earned instanceof Set) || !hexa.earned.has("hover")) {
    fail("flights did not survive the reload");
  } else {
    pass("flights survive the reload");
  }
  if (recall(round, "quad").completedModules.has("m2")) {
    fail("the quad picked up the hexacopter's Module 2 across the reload");
  } else {
    pass("the two airframes stay separate across the reload");
  }
  if (recall(round, "octo").completedModules.size !== 0) {
    fail("an airframe that was never saved came back with progress on it");
  } else {
    pass("an airframe that was never opened is still blank after the reload");
  }

  /* A frame id that is no longer buildable must not come back as a workbench. */
  const junk = deserialiseWorkspaces({ tricopter: { build: null, completedModules: ["m1"] } });
  if (Object.keys(junk).length !== 0) {
    fail(`a save naming an unknown airframe produced ${Object.keys(junk).join(", ")}`);
  } else {
    pass("a save naming an airframe that no longer exists is ignored");
  }
}

/* ==================================================================== */
section("accounts saved before workbenches existed");
/* ==================================================================== */
{
  /* One build, one set of ticks, no record of which airframe they belonged to —
     except the build, which names its own. */
  const legacy = migrateLegacySave({
    build: finishedBuild("hexa"),
    completedModules: ["m1", "m2", "m3"],
    earned: ["takeoff", "hover", "landing"],
  });

  const hexa = recall(legacy, "hexa");
  if (hexa.completedModules.size !== 3) {
    fail(`the old save's three modules did not land on the hexacopter (got ${hexa.completedModules.size})`);
  } else {
    pass("an old save's progress lands on the airframe it was built with");
  }

  for (const id of ["quad", "octo"]) {
    if (recall(legacy, id).completedModules.size !== 0) {
      fail(`the old save also marked modules complete on the ${id}`);
    } else {
      pass(`the old save leaves the ${id} blank`);
    }
  }

  if (Object.keys(migrateLegacySave({ build: null })).length !== 0) {
    fail("a save with no build produced a workbench anyway");
  } else {
    pass("a save with no build produces nothing");
  }
}

console.log("");
if (failures) {
  console.log(`FAIL — ${failures} problem(s)\n`);
  process.exit(1);
}
console.log("PASS — every airframe keeps its own build, modules and flights\n");
