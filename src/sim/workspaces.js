/**
 * ONE WORKBENCH PER AIRFRAME
 * ==========================
 * A student who has finished a hexacopter and turns to an octocopter has not
 * finished anything on the octocopter. Progress used to be a single set of
 * completed modules shared by all three airframes, so switching showed the new
 * aircraft wearing the old one's ticks: Module 1, 2 and 3 marked done on a
 * machine with nothing bolted to it. Worse in the other direction — the
 * hexacopter they had actually built was thrown away to make room.
 *
 * So each airframe gets its own workbench, and switching parks one and picks up
 * another exactly where it was left. What belongs to an airframe:
 *
 *   build            the aircraft itself: parts, wires, flags, faults
 *   completedModules which modules this airframe has finished
 *   earned           which flights this airframe has demonstrated
 *   moduleId         which module the student was working through
 *
 * `earned` is in there for the same reason as the rest. It records flights —
 * "hovered", "landed on the pad" — and it is what keeps a flight task ticked
 * after the student walks back to the bench. Shared between airframes, a brand
 * new octocopter would show Hover already done because the hexacopter once
 * managed it, which is the same bug one level down.
 *
 * Deliberately NOT per airframe: teacher mode, the theme, the chosen flight
 * field, and the undo history. The first three are preferences about the
 * session rather than facts about an aircraft. The undo history is dropped on
 * a switch on purpose — offering to undo a step that belongs to a different
 * airframe is worse than offering nothing.
 */

import { makeInitialBuild } from "./useBuildHistory.js";
import { AIRFRAMES } from "../data/airframes.js";
import { normalizeVariants } from "../data/parts.js";

/** A fresh, untouched workbench for one airframe. */
export function emptyWorkspace(frameId) {
  return {
    build: makeInitialBuild(frameId),
    completedModules: new Set(),
    earned: new Set(),
    moduleId: "m1",
  };
}

/** What the student had going on this airframe, or a fresh bench. */
export function recall(workspaces, frameId) {
  return workspaces?.[frameId] ?? emptyWorkspace(frameId);
}

/**
 * Park the current work under `frameId`.
 * Returns a new object; the caller's is untouched.
 */
export function stash(workspaces, frameId, snapshot) {
  return {
    ...(workspaces || {}),
    [frameId]: {
      build: snapshot.build,
      completedModules: new Set(snapshot.completedModules || []),
      earned: new Set(snapshot.earned || []),
      moduleId: snapshot.moduleId || "m1",
    },
  };
}

/** Forget one airframe's work, leaving the others alone. */
export function clearWorkspace(workspaces, frameId) {
  const next = { ...(workspaces || {}) };
  delete next[frameId];
  return next;
}

/* ------------------------------------------------------- serialisation */
/* Builds hold `links` as a Set and workspaces hold two more, none of which
   JSON can represent — left alone they serialise to {} and every wire the
   student connected disappears on the next load. */

function serialiseBuildState(build) {
  return {
    frameId: build.frameId,
    placed: build.placed,
    links: [...(build.links || [])],
    variants: build.variants,
    faults: build.faults,
    flags: build.flags,
  };
}

function deserialiseBuildState(raw, frameId) {
  const fallback = makeInitialBuild(frameId);
  if (!raw) return fallback;
  const frame = AIRFRAMES[raw.frameId ?? frameId] ?? AIRFRAMES.quad;
  return {
    frameId: raw.frameId ?? frameId,
    placed: raw.placed ?? {},
    links: new Set(Array.isArray(raw.links) ? raw.links : []),
    variants: normalizeVariants(raw.variants ?? {}, frame),
    faults: Array.isArray(raw.faults) ? raw.faults : [],
    // Merged over the defaults so a new flag is never left undefined
    flags: { ...fallback.flags, ...(raw.flags ?? {}) },
  };
}

export function serialiseWorkspaces(workspaces) {
  const out = {};
  for (const [frameId, w] of Object.entries(workspaces || {})) {
    if (!AIRFRAMES[frameId]) continue; // never persist a frame we cannot build
    out[frameId] = {
      build: serialiseBuildState(w.build),
      completedModules: [...(w.completedModules || [])],
      earned: [...(w.earned || [])],
      moduleId: w.moduleId || "m1",
    };
  }
  return out;
}

export function deserialiseWorkspaces(raw) {
  const out = {};
  for (const [frameId, w] of Object.entries(raw || {})) {
    if (!AIRFRAMES[frameId] || !w) continue;
    out[frameId] = {
      build: deserialiseBuildState(w.build, frameId),
      completedModules: new Set(Array.isArray(w.completedModules) ? w.completedModules : []),
      earned: new Set(Array.isArray(w.earned) ? w.earned : []),
      moduleId: w.moduleId || "m1",
    };
  }
  return out;
}

/**
 * Bring a pre-workspaces save forward.
 *
 * Accounts saved before this existed have one build, one set of completed
 * modules and one set of flights, with nothing recording which airframe they
 * belonged to — except the build itself, which names its own frame. That is the
 * answer: everything they did, they did on that aircraft. Filing it there is
 * both true and the only reading that does not hand a student ticks on an
 * airframe they have never touched.
 */
export function migrateLegacySave({ build, completedModules, earned }) {
  if (!build?.frameId || !AIRFRAMES[build.frameId]) return {};
  return {
    [build.frameId]: {
      build,
      completedModules: new Set(completedModules || []),
      earned: new Set(earned || []),
      moduleId: "m1",
    },
  };
}
