/**
 * PROGRESS API
 * ============
 * Curriculum tasks are written as `check(api)` predicates. This module builds
 * that `api` from the live build + telemetry + diagnostics, so a task ticks
 * itself the moment the student genuinely completes it — never because they
 * clicked something.
 */

import { PARTS, requiredQty } from "../data/parts.js";
import { wiringStatus } from "../data/wiring.js";
import { MODULE_BY_ID } from "../data/curriculum.js";

export function buildProgressApi({ build, frame, telemetry, diagnostics, completedModules, earned }) {
  const links = build.links instanceof Set ? build.links : new Set(build.links || []);
  const flags = build.flags || {};
  const placed = build.placed || {};
  // Reuse the diagnostics engine's wiring view when we have it, so a task can
  // never disagree with the health panel about whether something is connected.
  const wiring =
    diagnostics?.wiring || wiringStatus(frame, build.componentSet, links);

  const countOf = (id) => placed[id]?.length || 0;

  return {
    /* ---- assembly ---- */
    hasPart: (id) => countOf(id) > 0,
    countOf,
    allPlaced: (id) => PARTS[id] && countOf(id) >= requiredQty(PARTS[id], frame),
    allComponentsPlaced: () =>
      (build.componentSet || [])
        .filter((id) => PARTS[id])
        .every((id) => countOf(id) >= requiredQty(PARTS[id], frame)),

    /* ---- wiring ---- */
    wired: (linkId) => links.has(linkId),
    /** Is a whole loom finished? e.g. harnessDone("gps-fc") */
    harnessDone: (id) => wiring.isDone(id),
    groupWired: (group) =>
      wiring.harnesses.filter((h) => h.group === group).every((h) => h.complete),
    motorSignalsWired: () => {
      for (let i = 0; i < frame.motorCount; i++) if (!wiring.escSignal(i)) return false;
      return true;
    },
    escPowerWired: () => {
      for (let i = 0; i < frame.motorCount; i++) if (!wiring.escPowered(i)) return false;
      return true;
    },
    batteryConnected: () => wiring.batteryToPower,
    fcPowered: () => wiring.fcPowered,
    allRequiredWired: () => wiring.allRequiredDone,

    /* ---- configuration ---- */
    flag: (name) => Boolean(flags[name]),
    calibrated: (sensor) =>
      Boolean(flags[sensor === "imu" ? "imuCalibrated" : "compassCalibrated"]),
    sensorHealthy: (sensor) => {
      const r = diagnostics?.results?.[sensor];
      return r ? r.tone === "ok" || r.tone === "warn" : false;
    },
    readyToFly: () => Boolean(diagnostics?.readyToFly),

    /* ---- flight ---- */
    // Read the satellite count from diagnostics, which is the single source of
    // truth for it. Reading `telemetry` directly would return 0 in the assembly
    // bay (there is no telemetry until you fly), so the "Wait for GPS Lock" task
    // could never tick and the checklist would contradict the health panel.
    satellites: () =>
      diagnostics?.contexts?.gps?.satellites ?? telemetry?.satellites ?? 0,
    /**
     * Was this ever demonstrated?
     *
     * `telemetry` is null in the assembly bay, so reading achievements from it
     * alone meant every flight task silently un-ticked the moment the student
     * walked back to the bench — and the recorded progress followed them down,
     * so a finished module reverted to one task short. `earned` accumulates and
     * never shrinks: flying is a thing you did, not a thing you are currently
     * doing.
     */
    flightAchieved: (key) =>
      Boolean(earned?.has(key)) || Boolean(telemetry?.achievements?.has(key)),
    altitude: () => telemetry?.altitude ?? 0,

    /* ---- curriculum ---- */
    moduleComplete: (moduleId) => (completedModules || new Set()).has(moduleId),
  };
}

/** Evaluate every task in a module and return per-task pass/fail plus a summary. */
export function evaluateModule(module, api) {
  const tasks = module.tasks.map((t) => {
    let done = false;
    try {
      done = Boolean(t.check(api));
    } catch {
      done = false;
    }
    return { ...t, done };
  });

  const doneCount = tasks.filter((t) => t.done).length;
  // The first task that is not yet done is the one the student is working on.
  const currentIndex = tasks.findIndex((t) => !t.done);

  return {
    tasks,
    doneCount,
    total: tasks.length,
    percent: Math.round((doneCount / tasks.length) * 100),
    complete: doneCount === tasks.length,
    current: currentIndex === -1 ? null : tasks[currentIndex],
    currentIndex,
  };
}

/** Which modules are unlocked, given what the student has finished. */
export function unlockedModules(completedModules) {
  const done = completedModules || new Set();
  return MODULE_BY_ID
    ? Object.values(MODULE_BY_ID).map((m, i, arr) => ({
        id: m.id,
        unlocked: i === 0 || done.has(arr[i - 1].id) || done.has(m.id),
      }))
    : [];
}
