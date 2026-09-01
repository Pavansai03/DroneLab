/**
 * THE AIRFRAMES
 * =============
 * Duplicated from the simulator's src/data/airframes.js on purpose, for the same
 * reason MODULES is duplicated in routes/student.js: the portal and the API are
 * separate deployments and must not fail to render a progress page because a
 * shared import moved. Only the identity and the label are needed here — the
 * geometry, the mixer and the pack belong to the simulator.
 *
 * Progress is recorded per airframe. A student builds each of these from
 * Module 1, so the course is three modules PER COPTER, not three in total.
 */

export const FRAMES = [
  { id: "quad", label: "Quadcopter", motors: 4 },
  { id: "hexa", label: "Hexacopter", motors: 6 },
  { id: "octo", label: "Octocopter", motors: 8 },
];

export const FRAME_IDS = FRAMES.map((f) => f.id);

export const DEFAULT_FRAME = "quad";

/**
 * Rows written before the airframe was part of the key carry 'unknown'.
 * They are real flights and count towards a student's total; they are simply
 * not claimed by any one copter. See supabase/per-airframe-progress.sql.
 */
export const UNATTRIBUTED = "unknown";

export function isFrame(id) {
  return FRAME_IDS.includes(id);
}

export function frameLabel(id) {
  return FRAMES.find((f) => f.id === id)?.label ?? (id === UNATTRIBUTED ? "Not recorded" : id);
}
