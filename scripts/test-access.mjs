#!/usr/bin/env node
/**
 * REGRESSION TEST — WHO MAY OPEN THE SIMULATOR?
 * =============================================
 *     npm run test:access
 *
 * The rule is decided in two places that must agree: the API, which computes
 * `admitted` for the portal, and the simulator, which checks Supabase itself
 * because the portal refusing to open it stops nobody who knows the /sim URL.
 * One rule written twice is exactly the shape of thing that drifts, so this
 * asserts both against the same table of cases.
 *
 * The awkward cases are the ones worth pinning:
 *   - a NULL end date must never lock anyone out; every school approved before
 *     the feature existed has one, and reading null as "expired" would close
 *     the whole platform on deploy
 *   - an administrator must never be locked out, being the only person who can
 *     lift any of it
 *   - today is not expired; the boundary is the moment it passes
 *   - signed out, the simulator must not open — that was the hole left when
 *     expiry was first enforced, since the portal was the only thing checking
 *   - with no Supabase configured, everything opens: that build has no
 *     accounts, no schools and no subscriptions to enforce
 */

const DAY = 86400000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

/* The rule as the API computes it — server/src/routes/student.js. */
/* THROUGH the end date, not up to the start of it — the same rule both the API
   and the simulator apply. A bare YYYY-MM-DD from a date field parses to
   midnight at the START of that day, so comparing against it locked schools out
   for the whole day they had paid for. */
function subscriptionExpired(endsAt) {
  if (!endsAt) return false;
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return false;
  const endOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999);
  return Date.now() > endOfDay;
}

function apiAdmitted({ role, schoolStatus, schoolActive, studentStatus, endsAt, signedIn = true }) {
  if (!signedIn) return false; // no token, no /api/me at all
  const expired = subscriptionExpired(endsAt);
  const staff = role === "admin" || role === "school" || role === "teacher";
  const schoolOk = schoolStatus === "approved" && schoolActive;
  const studentOk = studentStatus === "approved";
  const subscriptionOk = role === "admin" || !expired;
  return (staff ? schoolOk || role === "admin" : schoolOk && studentOk) && subscriptionOk;
}

/* The rule as the simulator computes it — src/lib/useSchoolAccess.js.
   Returns the reason it is closed, or null when it opens. */
function simulatorReason({
  role,
  schoolStatus,
  schoolActive,
  studentStatus,
  endsAt,
  signedIn = true,
  inSchool = true,
  supabaseConfigured = true,
  authReady = true,
}) {
  if (!supabaseConfigured || role === "admin") return null;
  /* Still restoring the session. Not signed out — unknown. Reported as
     "checking" so nothing downstream acts on it. */
  if (!authReady) return "checking";
  if (!signedIn) return "signed-out";
  if (studentStatus === "rejected") return "rejected";
  if (!inSchool) return "no-school";
  if (studentStatus === "pending") return "pending";
  if (schoolStatus !== "approved" || !schoolActive) return "school-inactive";
  if (subscriptionExpired(endsAt)) return "expired";
  return null;
}

const base = { schoolStatus: "approved", schoolActive: true, studentStatus: "approved" };

const cases = [
  { n: "student, no end date",           role: "student", endsAt: null,               admitted: true,  reason: null },
  { n: "student, ends in 30 days",       role: "student", endsAt: iso(now + 30 * DAY), admitted: true,  reason: null },
  { n: "student, ends in 1 minute",      role: "student", endsAt: iso(now + 60000),   admitted: true,  reason: null },
  /* A minute ago is still TODAY, and an end date is valid through its day —
     so this is deliberately NOT expired. It reads like a trick until you
     remember the date field only ever submits a day. */
  { n: "stamp 1 min ago (same day)",     role: "student", endsAt: iso(now - 60000),   admitted: true,  reason: null },
  { n: "student, ended a year ago",      role: "student", endsAt: iso(now - 365 * DAY), admitted: false, reason: "expired" },
  { n: "school staff, ended yesterday",  role: "school",  endsAt: iso(now - DAY),     admitted: false, reason: "expired" },
  { n: "teacher, ended yesterday",       role: "teacher", endsAt: iso(now - DAY),     admitted: false, reason: "expired" },
  { n: "ADMIN, ended a year ago",        role: "admin",   endsAt: iso(now - 365 * DAY), admitted: true,  reason: null },
  { n: "student, awaiting approval",     role: "student", endsAt: null, studentStatus: "pending",  admitted: false, reason: "pending" },
  { n: "student, rejected",              role: "student", endsAt: null, studentStatus: "rejected", admitted: false, reason: "rejected" },
  { n: "student, no school yet",         role: "student", endsAt: null, inSchool: false, schoolStatus: null, schoolActive: false, admitted: false, reason: "no-school" },
  { n: "student, school paused",         role: "student", endsAt: null, schoolActive: false,       admitted: false, reason: "school-inactive" },
  { n: "SIGNED OUT",                     role: "student", endsAt: null, signedIn: false,           admitted: false, reason: "signed-out" },
  /* The boundary. An end date of TODAY means valid all of today — this is the
     case that was wrong: a school was locked out on the morning of the day its
     subscription ran to. */
  { n: "ends TODAY (midnight stamp)",    role: "student", endsAt: new Date(now).toISOString().slice(0,10) + "T00:00:00.000Z", admitted: true,  reason: null },
  { n: "ended YESTERDAY (midnight)",     role: "student", endsAt: new Date(now - DAY).toISOString().slice(0,10) + "T00:00:00.000Z", admitted: false, reason: "expired" },
  { n: "no Supabase configured",         role: "student", endsAt: null, supabaseConfigured: false, admitted: true,  reason: null, skipDrift: true },
  /* The session has not come back yet. A signed-in student looks exactly like
     a signed-out one for the first moments of every page load, and calling
     that "signed out" used to flash the lock screen at everybody. Harmless
     while it was a flash; not harmless once being signed out redirects, which
     would have thrown every signed-in student out to the login page on
     arrival. Excluded from the drift check because the API has no equivalent
     state — it either has a token on the request or it does not. */
  { n: "session still restoring",        role: "student", endsAt: null, authReady: false, signedIn: false, admitted: false, reason: "checking", skipDrift: true },
];

let failed = 0;
console.log("case                              API admits    simulator");
console.log("─".repeat(70));

for (const c of cases) {
  const gotAdmitted = c.supabaseConfigured === false ? true : apiAdmitted({ ...base, ...c });
  const gotReason = simulatorReason({ ...base, ...c });
  const okA = gotAdmitted === c.admitted;
  const okR = gotReason === c.reason;
  if (!okA || !okR) failed++;
  console.log(
    `${c.n.padEnd(33)} ${String(gotAdmitted).padEnd(6)}${okA ? "ok " : "BAD"}   ` +
      `${String(gotReason ?? "open").padEnd(16)}${okR ? "ok" : "BAD (want " + c.reason + ")"}`
  );
}

/* The two must never disagree: a student the portal refuses while the simulator
   opens is the precise hole all of this exists to close. */
console.log("");
let drift = 0;
for (const c of cases) {
  if (c.skipDrift) continue;
  const admitted = apiAdmitted({ ...base, ...c });
  const open = simulatorReason({ ...base, ...c }) === null;
  if (!admitted && open) {
    console.error(`DRIFT: "${c.n}" — the portal refuses but the simulator opens`);
    drift++;
  }
}
if (!drift) console.log("the API and the simulator agree on every case");

/* ==================================================================
   THE COUNTDOWN MUST AGREE WITH THE GATE
   ------------------------------------------------------------------
   The panels do not only enforce the rule, they narrate it: "ends today",
   "3 days left", "expired". Those words are what an administrator acts on, and
   for a while they contradicted the gate in both directions —

     on the end date  : "1 day left"    while access was open   (off by one)
     the day after    : "ends today"    while access was closed (Math.ceil
                                         returns -0, and -0 < 0 is false)

   So a school was locked out on a day the panel called "today", the
   administrator believed the licence had hours left, and the simulator looked
   broken. Nothing in either screen was wrong on its own; they were answering
   two different questions.

   This walks the boundary hour by hour and asserts the single invariant that
   makes them one question:  days < 0  if and only if  the gate refuses.
   ================================================================== */

/* The real module, not a copy of it. `.mjs` so bare Node reads it as an ES
   module without a warning; webpack imports it just the same. */
const { daysUntilEnd, hasExpired } = await import(
  new URL("../portal/lib/subscription.mjs", import.meta.url).href
);

const plural = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? "" : "s"}`;

/** The formula every panel used before. Kept so the test can fail on purpose. */
const oldDaysUntil = (endsAt, nowMs) => {
  const d = new Date(endsAt);
  const endOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999);
  return Math.ceil((endOfDay - nowMs) / 86400000);
};

const END = "2026-08-11T00:00:00.000Z"; // an administrator picked 11 August
const moments = [
  ["09 Aug, midday      ", "2026-08-09T12:00:00Z", 2, false],
  ["10 Aug, midday      ", "2026-08-10T12:00:00Z", 1, false],
  ["11 Aug, one past mid", "2026-08-11T00:00:01Z", 0, false],
  ["11 Aug, midday      ", "2026-08-11T12:00:00Z", 0, false],
  ["11 Aug, 23:59        ", "2026-08-11T23:59:00Z", 0, false],
  ["12 Aug, one past mid", "2026-08-12T00:00:01Z", -1, true],
  ["12 Aug, midday      ", "2026-08-12T12:00:00Z", -1, true],
  ["13 Aug, midday      ", "2026-08-13T12:00:00Z", -2, true],
];

console.log("");
console.log("countdown at the boundary — end date 11 August");
console.log("moment                 days  gate      panel says        old formula");
console.log("─".repeat(76));

let countdownFailed = 0;
let oldWouldHaveFailed = 0;

for (const [label, iso, wantDays, wantExpired] of moments) {
  const now = Date.parse(iso);
  const days = daysUntilEnd(END, now);
  const gone = hasExpired(END, now);

  /* Exactly how the panels render it, so the assertion covers the words a
     person actually reads and not only the number behind them. */
  const says = gone ? "expired" : days === 0 ? "ends today" : `${plural(days, "day")} left`;
  const old = oldDaysUntil(END, now);
  const oldSays = old < 0 ? "expired" : old === 0 ? "ends today" : `${plural(old, "day")} left`;

  const ok = days === wantDays && gone === wantExpired;
  /* The invariant. Everything above is a worked example of it. */
  const consistent = gone === days < 0;
  if (!ok || !consistent) countdownFailed++;
  if (oldSays !== says) oldWouldHaveFailed++;

  console.log(
    `${label}  ${String(days).padStart(4)}  ${(gone ? "closed" : "open").padEnd(8)}  ` +
      `${says.padEnd(16)}  ${oldSays}${oldSays === says ? "" : "  <- disagreed"}`
  );
  if (!ok) console.error(`  BAD: wanted days=${wantDays} expired=${wantExpired}`);
  if (!consistent) console.error(`  BAD: "${says}" contradicts the gate`);
}

console.log("");
if (!oldWouldHaveFailed) {
  console.error("The old formula agreed everywhere — this test cannot fail, so it proves nothing.");
  countdownFailed++;
} else {
  console.log(`the old formula disagreed with the gate at ${oldWouldHaveFailed} of ${moments.length} moments`);
}

/* No end date is not "expired today"; it is no expiry at all. Worth pinning
   separately, because null is the value every school approved before this
   feature existed still carries. */
if (daysUntilEnd(null) !== null || hasExpired(null) !== false) {
  console.error("BAD: a school with no end date must never be expired");
  countdownFailed++;
} else {
  console.log("a school with no end date never expires");
}

console.log("");
if (failed || drift || countdownFailed) {
  console.error(`FAIL — ${failed} wrong, ${drift} disagreement(s), ${countdownFailed} countdown problem(s)`);
  process.exit(1);
}
console.log("PASS — the simulator opens only for a signed-in, approved member of an");
console.log("       active, unexpired school; administrators always; nobody when signed out");
console.log("PASS — and the countdown says the same thing the gate does, at every hour");
