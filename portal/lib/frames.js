/**
 * THE AIRFRAMES, FOR THE PORTAL
 * =============================
 * The same three copters the simulator builds, duplicated here for the same
 * reason the module list is: the portal is its own deployment, and a panel that
 * cannot render because a shared import moved is worse than a list of three
 * strings kept in step by hand.
 *
 * Progress is per airframe. A student builds each copter from Module 1, so the
 * course is three modules PER COPTER — nine ticks in all, not three.
 */

export const FRAMES = [
  { id: "quad", label: "Quadcopter", short: "Quad", motors: 4 },
  { id: "hexa", label: "Hexacopter", short: "Hexa", motors: 6 },
  { id: "octo", label: "Octocopter", short: "Octo", motors: 8 },
];

export const FRAME_IDS = FRAMES.map((f) => f.id);

/** Flights logged before the airframe was recorded. Real, but unclaimed. */
export const UNATTRIBUTED = "unknown";

export function frameLabel(id) {
  if (!id) return "";
  if (id === UNATTRIBUTED) return "Not recorded";
  return FRAMES.find((f) => f.id === id)?.label ?? id;
}

/** Sum the per-frame stats a roster row carries, for the "all copters" view. */
export function totalsAcrossFrames(perFrame) {
  const out = { modules: 0, flights: 0, crashes: 0, seconds: 0 };
  for (const id of FRAME_IDS) {
    const s = perFrame?.[id];
    if (!s) continue;
    out.modules += s.modules ?? 0;
    out.flights += s.flights ?? 0;
    out.crashes += s.crashes ?? 0;
    out.seconds += s.seconds ?? 0;
  }
  return out;
}
