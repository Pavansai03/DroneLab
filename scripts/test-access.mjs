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
}) {
  if (!supabaseConfigured || role === "admin") return null;
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

console.log("");
if (failed || drift) {
  console.error(`FAIL — ${failed} wrong, ${drift} disagreement(s)`);
  process.exit(1);
}
console.log("PASS — the simulator opens only for a signed-in, approved member of an");
console.log("       active, unexpired school; administrators always; nobody when signed out");
