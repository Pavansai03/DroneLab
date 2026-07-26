/**
 * PROGRESS API
 * ============
 * Curriculum tasks are written as `check(api)` predicates. This module builds
 * that `api` from the live build + telemetry + diagnostics, so a task ticks
 * itself the moment the student genuinely completes it — never because they
 * clicked something.
 */

import { PARTS, requiredQty } from "../data/parts.js";
import { buildWiringSpec } from "../data/wiring.js";
import { MODULE_BY_ID } from "../data/curriculum.js";

export function buildProgressApi({ build, frame, telemetry, diagnostics, completedModules }) {
  const links = build.links instanceof Set ? build.links : new Set(build.links || []);
  const flags = build.flags || {};
  const placed = build.placed || {};
  const spec = buildWiringSpec(frame, { components: build.componentSet });

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
    groupWired: (group) =>
      spec.filter((l) => l.group === group).every((l) => links.has(l.id)),
    motorSignalsWired: () => {
      for (let i = 0; i < frame.motorCount; i++) {
        if (!links.has(`fc->esc${i}`)) return false;
      }
      return true;
    },
    escPowerWired: () => {
      for (let i = 0; i < frame.motorCount; i++) {
        if (!links.has(`pdb->esc${i}`)) return false;
      }
      return true;
    },
    allRequiredWired: () =>
      spec.filter((l) => l.required).every((l) => links.has(l.id)),

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
    flightAchieved: (key) => Boolean(telemetry?.achievements?.has(key)),
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
