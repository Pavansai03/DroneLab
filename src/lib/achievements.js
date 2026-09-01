/**
 * FLIGHT ACHIEVEMENTS, REMEMBERED
 * ===============================
 * A flight achievement records something the student *did* — took off, held a
 * hover, landed on the pad. The live telemetry object only knows what is
 * happening right now, and it is thrown away the moment they walk back to the
 * assembly bay, so a checklist that reads achievements straight off telemetry
 * un-ticks itself the instant the student stops flying.
 *
 * This keeps the record. It is deliberately a local high-water mark rather than
 * a server round trip: it is read on every checklist evaluation, and a student
 * mid-flight should never wait on the network to be told they hovered.
 *
 * Keyed per user so two students sharing a classroom machine do not inherit
 * each other's flights. Signed-out work lands under "local" and is merged in
 * when they do sign in — practising before logging in should still count.
 *
 * Keyed per AIRFRAME as well. A flight is something a particular aircraft did;
 * a brand new octocopter that has never left the ground must not show Hover
 * already ticked because a hexacopter managed it last week. See
 * sim/workspaces.js, which holds the same separation for everything else.
 */

const PREFIX = "dronelab.earned.";

function keyFor(userId, frameId) {
  const who = userId || "local";
  return frameId ? `${PREFIX}${who}.${frameId}` : PREFIX + who;
}

function storage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Private browsing, or a locked-down school image. Not an error worth
    // surfacing — achievements simply stop outliving the tab.
    return null;
  }
}

function read(store, key) {
  try {
    const raw = JSON.parse(store.getItem(key) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

export function loadEarned(userId, frameId) {
  const store = storage();
  if (!store) return new Set();

  const set = read(store, keyFor(userId, frameId));
  if (set.size || !frameId) return set;

  /* Nothing under the per-airframe key. Before flights were separated by
     aircraft they were all in one bucket, and everything in that bucket was
     flown on whatever airframe the student had — which is the one being asked
     for on the first load after the upgrade. Adopt it once, then retire the
     old key so it can never be adopted by a second airframe as well. */
  const legacy = read(store, keyFor(userId, null));
  if (!legacy.size) return set;
  saveEarned(userId, frameId, legacy);
  try {
    store.removeItem(keyFor(userId, null));
  } catch {
    /* storage disabled mid-session */
  }
  return legacy;
}

export function saveEarned(userId, frameId, set) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(keyFor(userId, frameId), JSON.stringify([...set]));
  } catch {
    /* quota, or storage disabled mid-session */
  }
}

/**
 * Forget every flight, on this machine.
 *
 * BOTH KEYS, always — the signed-in one and "local".
 *
 * Clearing only the user's key left the signed-out set behind, and the very
 * next mount seeds `earned` from exactly that key (loadEarned(null) in App).
 * So a student who had ever flown before signing in reset their build, walked
 * to the portal, came back, and found Hover ticked on a drone with no motors
 * on it. The merge that makes signed-out practice count is the same merge that
 * resurrected it.
 *
 * A reset is not "forget the account's flights" — it is "this build never
 * happened". Nothing on this machine should survive it.
 */
export function clearEarned(userId, frameId) {
  const store = storage();
  if (!store) return;
  const keys = new Set([
    keyFor(userId, frameId),
    keyFor(null, frameId),
    // The pre-airframe keys too, or the migration above would hand the old
    // bucket straight back to the airframe that was just stripped.
    keyFor(userId, null),
    keyFor(null, null),
  ]);
  for (const key of keys) {
    try {
      store.removeItem(key);
    } catch {
      /* quota, or storage disabled mid-session */
    }
  }
}
