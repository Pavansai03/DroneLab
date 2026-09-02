/**
 * WHICH TICKS BELONG ON THE BENCH
 * ===============================
 * Two independent requests decide what the module rail shows when a student
 * signs in:
 *
 *   the saved benches   `builds.state` — the aircraft they left out, its
 *                       finished modules, and the ones parked beside it
 *   the school's record `module_progress` — everything the account has
 *                       finished, on any machine
 *
 * Nothing orders them. Either can land first, and the bench is a default
 * quadcopter until one of them does. That is the entire bug a classroom
 * reported twice: a bare list of module ids landing first was merged into
 * whichever copter happened to be on the bench, which was not the hexacopter
 * the student had actually left out — so they came back from the portal to find
 * Modules 2 and 3 ticked on an aircraft with nothing bolted to it. Guarding the
 * merge could not fix it, because the guard was racing the same two requests.
 *
 * The rules live here, as functions of their arguments and nothing else, so
 * that the ordering property can be proved rather than argued about — see
 * scripts/test-frame-progress.mjs, which replays both orders.
 */

/**
 * The recorded ticks that belong to ONE aircraft.
 *
 * `unkeyed` is every row that names no airframe: an instance where
 * per-airframe-progress.sql has not been run, or a row written before it was.
 * They are only ever handed to `legacyFrame` — the aircraft a pre-benches
 * account was saved on, which is the one aircraft they can honestly describe.
 * With no legacy frame they are dropped rather than guessed at, because the
 * cost of guessing is a student being shown a module they never built.
 */
export function ticksFor(cloudTicks, frameId, legacyFrame = null) {
  if (!cloudTicks || !frameId) return new Set();
  const mine = new Set(cloudTicks.byFrame?.[frameId] ?? []);
  if (legacyFrame && legacyFrame === frameId) {
    for (const id of cloudTicks.unkeyed ?? []) mine.add(id);
  }
  return mine;
}

/**
 * Add what the account has recorded to what the bench already shows.
 *
 * Merged rather than replaced: a student may have finished something in this
 * tab while the request was in flight. Returns `prev` unchanged when there is
 * nothing new, so React can skip the render.
 */
export function mergeTicks(prev, incoming) {
  if (!incoming || incoming.size === 0) return prev;
  const merged = new Set(prev);
  let novel = false;
  for (const id of incoming) {
    if (!merged.has(id)) {
      merged.add(id);
      novel = true;
    }
  }
  return novel ? merged : prev;
}

/**
 * What the saved benches say the aircraft on the bench has finished.
 *
 * AUTHORITATIVE, INCLUDING WHEN IT IS EMPTY. "Nothing finished on this
 * hexacopter" is a fact about the hexacopter, exactly as much as three finished
 * modules would be. Reading an empty list as "no opinion" is what let a merge
 * made moments earlier against the default quadcopter survive the load.
 */
export function benchAfterLoad(payload) {
  return new Set(payload?.completedModules ?? []);
}

/* ------------------------------------------------ what reaches the record */

/**
 * A FINISHED MODULE HAS ALL ITS TASKS DONE.
 *
 * The panel draws its badge from `completed` and its bar from the two counts,
 * so a row reading "complete, 1 of 11 tasks" renders a green COMPLETE pill
 * above a bar that is all but empty, and a teacher has no way to decide which
 * half to believe. No state of the world produces that row. Rather than trust
 * whatever composed it, the row is made to agree with itself on the way out.
 */
export function coherent(row) {
  if (!row) return row;
  if (row.completed && row.tasks_total) return { ...row, tasks_done: row.tasks_total };
  return row;
}

/**
 * MAY ANYTHING BE RECORDED YET?
 *
 * The simulator opens on a default quadcopter with an empty bench, because it
 * has to render something before it knows who is looking at it. Module 1
 * measured against that empty bench scores one task out of eleven — a truthful
 * reading of a bench with nothing on it, which is exactly what makes it
 * dangerous. Written, it overwrites a module the student finished last week.
 *
 * So the answer is no until the saved bench has been read AND the marks
 * already in the database are known. Compared against the user id rather than
 * held as a flag, so signing in as somebody else cannot inherit either.
 */
export function mayRecord({ userId, hydrated, seededUser }) {
  return Boolean(userId) && Boolean(hydrated) && seededUser === userId;
}

/**
 * WHAT THE RECORD OWES THE BENCH.
 *
 * `mayRecord` stops the placeholder overwriting anything again; it does nothing
 * for the rows it already overwrote, and those do not heal on their own —
 * only the module a student currently has open is ever written, so a damaged
 * Module 1 stays damaged until they reopen a module they finished weeks ago.
 *
 * The bench is the authority on what is finished: kept per airframe by the
 * simulator, and it is what the student watched tick. Anything it claims that
 * the record does not already show as finished is owed a write.
 */
export function benchRepairs({ completedModules, marks, totals }) {
  const owed = [];
  for (const id of completedModules ?? []) {
    const total = totals?.get(id);
    if (!total) continue; // a module this build does not have
    const mark = marks?.get(id);
    if (mark && mark.complete && mark.done >= total) continue;
    owed.push({ moduleId: id, total });
  }
  return owed;
}
