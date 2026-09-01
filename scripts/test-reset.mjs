#!/usr/bin/env node
/**
 * REGRESSION TEST — DOES A RESET ACTUALLY FORGET?
 * ===============================================
 *     npm run test:reset
 *
 * "Strip the build" is confirmed in a dialogue, says it clears module progress,
 * and then a student walked to the portal, came back, and found Hover ticked on
 * a drone with no motors fitted. Twice. This pins both routes by which a
 * cleared achievement came back from the dead.
 *
 * ROUTE 1 — THE OTHER LOCALSTORAGE KEY (tested against the real module)
 * ----------------------------------------------------------------------
 * Achievements are stored per account, with signed-out work under "local" so
 * that practising before logging in still counts. App seeds `earned` from that
 * local key on every mount. Reset called clearEarned(userId), which removed one
 * key — and the very next mount read the other one straight back.
 *
 * This half imports src/lib/achievements.js and drives it for real.
 *
 * ROUTE 2 — THE WRITE THAT NEVER LEFT (a model of the sync policy)
 * -----------------------------------------------------------------
 * The cloud copy of the achievements rides along with the build row, written on
 * a 1500 ms debounce. Reset queues the empty set — and "Portal" is a link to a
 * different application, so clicking it is a real navigation. React does not
 * run effect cleanups on unload, so the timer died with the page, the row kept
 * the old set, and it was merged back in on return.
 *
 * Two changes: a reset is written immediately rather than debounced, and a
 * hidden page flushes whatever is pending. Both are sequencing, which no amount
 * of reading the diff proves, so the policy is modelled here and driven through
 * the same event sequence a student produces.
 */

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* --------------------------------------------------- a localStorage stub */
/* achievements.js reaches for the global. Give it one that behaves like the
   real thing, including throwing nothing and storing only strings. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { loadEarned, saveEarned, clearEarned } = await import(
  pathToFileURL(resolve(HERE, "../src/lib/achievements.js")).href
);

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (e) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${e.message.split("\n")[0]}`);
    failures++;
  }
};

/* =========================================================== route 1 */
console.log("\nlocal storage — the real module\n");

/**
 * One run of the app, as App.jsx sequences it.
 *  - mount seeds from the "local" key, whoever is signed in
 *  - signing in merges the account's own key over the top
 *
 * Flights are recorded per AIRFRAME as well as per user: a flight is something
 * a particular aircraft did, and a fresh octocopter must not inherit the
 * hexacopter's hover. `frameId` defaults to the quad the course opens on, so
 * every check below reads as it did before unless it is specifically about
 * keeping two airframes apart.
 */
function mountApp(userId, frameId = "quad") {
  let earned = loadEarned(null, frameId);
  const stored = loadEarned(userId, frameId);
  for (const k of stored) earned.add(k);
  return {
    earned,
    fly(key) {
      earned.add(key);
      saveEarned(userId, frameId, earned);
    },
    reset() {
      earned = new Set();
      clearEarned(userId, frameId);
    },
    get ticks() {
      return earned;
    },
  };
}

check("a flight flown signed OUT is remembered after signing in", () => {
  store.clear();
  const guest = mountApp(null);
  guest.fly("hover");
  const signedIn = mountApp("student-1");
  assert.ok(signedIn.ticks.has("hover"), "signed-out practice should still count");
});

check("reset, then reopen — the tick is gone (flown signed out first)", () => {
  store.clear();
  /* Exactly the reported sequence: practise before logging in, sign in, reset,
     walk to the portal, come back. */
  mountApp(null).fly("hover");
  const app = mountApp("student-1");
  assert.ok(app.ticks.has("hover"));
  app.reset();
  const reopened = mountApp("student-1");
  assert.deepEqual([...reopened.ticks], [], "reset must not leave a tick behind");
});

check("reset, then reopen — the tick is gone (flown signed in)", () => {
  store.clear();
  const app = mountApp("student-1");
  app.fly("hover");
  app.reset();
  assert.deepEqual([...mountApp("student-1").ticks], []);
});

check("one student's reset does not clear another account's flights", () => {
  store.clear();
  const a = mountApp("student-1");
  a.fly("hover");
  const b = mountApp("student-2");
  b.fly("landed");
  b.reset();
  /* B's reset clears the shared "local" key too — that is deliberate, it is
     this machine's scratch space. A's OWN key must survive it. */
  assert.ok(mountApp("student-1").ticks.has("hover"), "student-1 kept their flight");
  assert.deepEqual([...mountApp("student-2").ticks], []);
});

check("a hexacopter's flight is not credited to a fresh octocopter", () => {
  store.clear();
  const hexa = mountApp("student-1", "hexa");
  hexa.fly("hover");
  hexa.fly("landing");
  const octo = mountApp("student-1", "octo");
  assert.deepEqual(
    [...octo.ticks],
    [],
    "an octocopter that has never left the ground must show no flights"
  );
  assert.ok(mountApp("student-1", "hexa").ticks.has("hover"), "the hexacopter keeps its own");
});

check("stripping one airframe leaves the other's flights alone", () => {
  store.clear();
  mountApp("student-1", "hexa").fly("hover");
  const octo = mountApp("student-1", "octo");
  octo.fly("takeoff");
  octo.reset();
  assert.deepEqual([...mountApp("student-1", "octo").ticks], []);
  assert.ok(
    mountApp("student-1", "hexa").ticks.has("hover"),
    "stripping the octocopter must not un-fly the hexacopter"
  );
});

check("flights recorded before airframes were separated are adopted once", () => {
  store.clear();
  /* The pre-upgrade key: no airframe in it, because there was only one. */
  store.set("dronelab.earned.student-1", JSON.stringify(["hover", "landing"]));
  const first = mountApp("student-1", "hexa");
  assert.ok(first.ticks.has("hover"), "the old record should survive the upgrade");
  /* ...onto the airframe that was open, and no other. Adopting it a second
     time would hand the same flights to every aircraft in turn. */
  assert.deepEqual(
    [...mountApp("student-1", "octo").ticks],
    [],
    "the old record must not be adopted again by a second airframe"
  );
});

/* =========================================================== route 2 */
console.log("\ncloud write ordering — the sync policy\n");

/**
 * The build-sync write policy from src/lib/useCloudSync.js, as a state machine.
 * `cloud` is the row; `timer` is the pending debounce.
 */
function makeSync({ debounceReset, flushOnHide }) {
  const s = {
    cloud: null,
    timer: null,
    /* Writes are serialised in the real hook. Modelled as a list applied in
       order, because the bug this guards against is the empty set losing a race
       with the flush of the payload it replaces. */
    log: [],

    write(payload) {
      s.log.push(payload);
      s.cloud = payload;
    },

    change(payload, { isReset = false } = {}) {
      /* An in-app teardown flushes whatever was queued, then queues the new. */
      s.tick();
      if (isReset && !debounceReset) s.write(payload);
      else s.timer = payload;
    },

    tick() {
      if (s.timer) {
        s.write(s.timer);
        s.timer = null;
      }
    },

    /* Navigating away. React runs no cleanup; only an explicit page-hide
       listener gets a chance to send anything. */
    leavePage() {
      if (flushOnHide) s.tick();
      else s.timer = null;
    },

    get earned() {
      return s.cloud?.earned ?? [];
    },
  };
  return s;
}

/** Fly, reset, click Portal within the debounce window, come back. */
function walkOut(sync) {
  sync.change({ earned: ["hover"] });
  sync.tick(); // the flight was a while ago; that write landed
  sync.change({ earned: [] }, { isReset: true });
  sync.leavePage();
  /* Returning merges the cloud set into the local one — never replaces, so
     signed-out work is not lost. Which is why a stale cloud set is fatal. */
  return new Set(sync.earned);
}

check("the OLD policy is what put Hover back (proves this test can fail)", () => {
  const before = walkOut(makeSync({ debounceReset: true, flushOnHide: false }));
  assert.ok(before.has("hover"), "the old policy should resurrect it");
});

check("a reset is written immediately, so leaving cannot lose it", () => {
  const after = walkOut(makeSync({ debounceReset: false, flushOnHide: true }));
  assert.deepEqual([...after], [], "the cloud must hold the empty set");
});

check("an immediate reset write survives even with no page-hide flush", () => {
  const after = walkOut(makeSync({ debounceReset: false, flushOnHide: false }));
  assert.deepEqual([...after], []);
});

check("ordinary building is still debounced, not written per keystroke", () => {
  const s = makeSync({ debounceReset: false, flushOnHide: true });
  s.change({ earned: [], placed: 1 });
  s.change({ earned: [], placed: 2 });
  s.change({ earned: [], placed: 3 });
  s.tick();
  /* Three changes in one window: the first two flush as the effect re-runs,
     which is the existing behaviour — what must not happen is nothing landing. */
  assert.equal(s.cloud.placed, 3, "the last state is what the cloud holds");
});

check("the reset write lands AFTER the flush of what it replaces", () => {
  const s = makeSync({ debounceReset: false, flushOnHide: true });
  s.change({ earned: ["hover"] });          // queued, still in the debounce
  s.change({ earned: [] }, { isReset: true }); // reset arrives on top of it
  assert.deepEqual(
    s.log.map((p) => p.earned.length),
    [1, 0],
    "the empty set must be the last thing written"
  );
  assert.deepEqual(s.earned, []);
});

/* ------------------------------------------------------------------ done */
console.log("");
if (failures) {
  console.error(`FAIL — ${failures} problem(s)`);
  process.exit(1);
}
console.log("PASS — a reset forgets, on this machine and in the cloud, and stays forgotten");
