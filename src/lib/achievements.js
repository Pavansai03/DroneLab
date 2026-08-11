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
 */

const PREFIX = "dronelab.earned.";

function keyFor(userId) {
  return PREFIX + (userId || "local");
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

export function loadEarned(userId) {
  const store = storage();
  if (!store) return new Set();
  try {
    const raw = JSON.parse(store.getItem(keyFor(userId)) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

export function saveEarned(userId, set) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(keyFor(userId), JSON.stringify([...set]));
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
export function clearEarned(userId) {
  const store = storage();
  if (!store) return;
  for (const key of new Set([keyFor(userId), keyFor(null)])) {
    try {
      store.removeItem(key);
    } catch {
      /* quota, or storage disabled mid-session */
    }
  }
}
