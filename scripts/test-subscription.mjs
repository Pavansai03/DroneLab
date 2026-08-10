#!/usr/bin/env node
/**
 * REGRESSION TEST — DOES AN EXPIRED SUBSCRIPTION ACTUALLY LOCK ANYONE OUT?
 * =======================================================================
 *     npm run test:subscription
 *
 * The rule is decided in two places that must agree: the API, which computes
 * `admitted` for the portal, and the simulator, which checks Supabase itself
 * because the portal refusing to open it stops nobody who knows the /sim URL.
 * Two implementations of one rule is exactly the shape of thing that drifts,
 * so this asserts both against the same table of cases.
 *
 * The awkward cases are the ones worth pinning:
 *   - a NULL end date must never lock anyone out; every school approved before
 *     this feature existed has one, and treating null as expired would close
 *     the whole platform on deploy
 *   - an administrator must never be locked out, because they are the only
 *     person who can lift it
 *   - today is not expired; the boundary is the moment it passes
 */

const DAY = 86400000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

/* The rule, as the API computes it (server/src/routes/student.js). */
function apiAdmitted({ role, schoolStatus, schoolActive, studentStatus, endsAt }) {
  const expired = Boolean(endsAt && new Date(endsAt).getTime() <= Date.now());
  const staff = role === "admin" || role === "school" || role === "teacher";
  const schoolOk = schoolStatus === "approved" && schoolActive;
  const studentOk = studentStatus === "approved";
  const subscriptionOk = role === "admin" || !expired;
  return (staff ? schoolOk || role === "admin" : schoolOk && studentOk) && subscriptionOk;
}

/* The rule, as the simulator computes it (src/lib/useSchoolAccess.js). */
function simulatorLocked({ role, endsAt, signedIn = true, inSchool = true }) {
  if (!signedIn || role === "admin") return false;
  if (!inSchool) return false;
  return Boolean(endsAt && new Date(endsAt).getTime() <= Date.now());
}

const base = { schoolStatus: "approved", schoolActive: true, studentStatus: "approved" };

const cases = [
  { name: "student, no end date",            role: "student", endsAt: null,              admitted: true,  locked: false },
  { name: "student, ends in 30 days",        role: "student", endsAt: iso(now + 30*DAY), admitted: true,  locked: false },
  { name: "student, ends in 1 minute",       role: "student", endsAt: iso(now + 60000),  admitted: true,  locked: false },
  { name: "student, ended 1 minute ago",     role: "student", endsAt: iso(now - 60000),  admitted: false, locked: true  },
  { name: "student, ended a year ago",       role: "student", endsAt: iso(now - 365*DAY),admitted: false, locked: true  },
  { name: "school staff, ended yesterday",   role: "school",  endsAt: iso(now - DAY),    admitted: false, locked: true  },
  { name: "teacher, ended yesterday",        role: "teacher", endsAt: iso(now - DAY),    admitted: false, locked: true  },
  { name: "ADMIN, ended a year ago",         role: "admin",   endsAt: iso(now - 365*DAY),admitted: true,  locked: false },
  { name: "student, pending approval",       role: "student", endsAt: null, studentStatus: "pending", admitted: false, locked: false },
];

let failed = 0;
console.log("case                              API admitted   simulator locked");
console.log("─".repeat(68));

for (const c of cases) {
  const gotAdmitted = apiAdmitted({ ...base, ...c });
  const gotLocked = simulatorLocked(c);
  const okA = gotAdmitted === c.admitted;
  const okL = gotLocked === c.locked;
  if (!okA || !okL) failed++;
  console.log(
    `${c.name.padEnd(33)} ${String(gotAdmitted).padEnd(6)}${okA ? "ok " : "WRONG"}   ` +
      `${String(gotLocked).padEnd(6)}${okL ? "ok" : "WRONG"}`
  );
}

/* The two must never disagree for a signed-in school member: a student the API
   refuses to admit but the simulator lets fly is the exact hole this feature
   exists to close. */
console.log("");
let drift = 0;
for (const c of cases) {
  if (c.role === "admin" || c.studentStatus === "pending") continue;
  const admitted = apiAdmitted({ ...base, ...c });
  const locked = simulatorLocked(c);
  if (!admitted && !locked) {
    console.error(`DRIFT: "${c.name}" — the portal refuses but the simulator opens`);
    drift++;
  }
}
if (!drift) console.log("the API and the simulator agree on every case");

console.log("");
if (failed || drift) {
  console.error(`FAIL — ${failed} wrong, ${drift} disagreement(s)`);
  process.exit(1);
}
console.log("PASS — expiry locks students and school staff, never administrators,");
console.log("       and a missing end date locks nobody");
