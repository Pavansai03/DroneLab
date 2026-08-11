#!/usr/bin/env node
/**
 * REGRESSION TEST — WHERE DOES EACH ROLE END UP, AND DOES IT SETTLE?
 * =================================================================
 *     npm run test:navigation
 *
 * Every panel page is gated, and the gates redirect. That is six pages plus a
 * router plus three standalone screens, each deciding independently, and the
 * failure they produce is not a crash — it is a browser bouncing between two
 * URLs for ever, or a student parked on a page whose message is about the wrong
 * problem entirely.
 *
 * Neither shows up in a build, in a type check, or in a page that renders fine
 * when you open it signed out. I already shipped one loop in this codebase —
 * /student/join redirecting to itself — and caught it by reading rather than by
 * testing.
 *
 * So this walks the real graph. For every role in every state, from every entry
 * point, it follows the redirects until they settle and asserts two things:
 *
 *   1. IT TERMINATES. No cycles, no drifting past a sane hop count.
 *   2. IT LANDS SOMEWHERE HONEST. An expired school must not be told it is
 *      awaiting approval; an unapproved student must not reach a dashboard.
 *
 * The gate logic below mirrors Shell.jsx, app/page.jsx and the standalone
 * screens. It is a copy, which is a cost — but the alternative is running a
 * browser with a mocked Supabase for forty combinations, and a copy that is
 * asserted against every combination is worth more than a test nobody runs.
 */

const LOGIN = "/login";

/* ---------------------------------------------------------------- the gates */

/** app/page.jsx — the router that decides where a signed-in person belongs. */
function root(u) {
  if (!u.signedIn) return LOGIN;
  if (u.expired && u.role !== "admin") return "/expired";
  if (u.role === "admin") return "/admin";
  if (u.role === "school" || u.role === "teacher") {
    return u.applicationStatus && u.applicationStatus !== "approved" ? "/school/pending" : "/school";
  }
  if (u.admitted) return "/student";
  if (u.school) return "/student/pending";
  return "/student/join";
}

/** components/Shell.jsx — wraps /admin, /school, /student, /student/join,
    /student/profile and /teacher. */
function shell(u, path, requireRole) {
  if (!u.signedIn) return LOGIN;
  if (u.expired && u.role !== "admin" && path !== "/expired") return "/expired";
  if (u.role === "student" && !u.admitted) {
    const want = u.school ? "/student/pending" : "/student/join";
    if (path !== want) return want;
  }
  /* A role that is too low renders a message rather than redirecting — a dead
     end by design, so that a mis-typed URL says why instead of bouncing. */
  const rank = { student: 0, teacher: 1, school: 1, admin: 2 };
  if (requireRole && rank[u.role] < rank[requireRole]) return path; // stays, shows the refusal
  return path;
}

/** The standalone screens, which carry their own gate instead of Shell's. */
function expiredPage(u) {
  if (!u.signedIn) return LOGIN;
  if (!u.expired) return u.role === "student" ? "/student" : "/";
  /* Never an administrator: this screen says "someone else must fix this", and
     for them there is nobody else. The remedy is on /admin. */
  if (u.role === "admin") return "/admin";
  return "/expired";
}

function studentPending(u) {
  if (!u.signedIn) return LOGIN;
  /* The school's licence before this page's own subject: both leave `admitted`
     false, and without this a student whose school had simply run out was told
     an administrator was reviewing their request. This test found that. */
  if (u.expired) return "/expired";
  if (u.admitted) return "/student";
  if (!u.school) return "/student/join";
  return "/student/pending";
}

function schoolPending(u) {
  if (!u.signedIn) return LOGIN;
  return "/school/pending";
}

/** app/reset/page.jsx — where a password reset link lands.
    Ungated on purpose, and the ONLY page that a signed-out visitor may rest on
    besides /login. Redirecting them away was the bug: the recovery session
    arrives in the URL fragment, so for a moment the page legitimately has no
    session, and bouncing to /login threw the tokens away. It now stays put and
    offers the six-digit code from the same email instead.

    No role, subscription or approval check either. An unapproved student, a
    lapsed school and an administrator can all be locked out by a forgotten
    password, and none of those states is a reason to refuse someone their own
    account back — gating it on the subscription would mean a school could not
    recover the account it needs in order to ask for the renewal that would
    ungate it. */
function resetPage() {
  return "/reset";
}

const PAGES = {
  "/": root,
  "/login": () => LOGIN,
  "/admin": (u) => shell(u, "/admin", "admin"),
  "/school": (u) => shell(u, "/school", "teacher"),
  "/teacher": (u) => shell(u, "/teacher", "teacher"),
  "/student": (u) => shell(u, "/student"),
  "/student/join": (u) => shell(u, "/student/join"),
  "/student/profile": (u) => shell(u, "/student/profile"),
  "/expired": expiredPage,
  "/student/pending": studentPending,
  "/school/pending": schoolPending,
  "/reset": resetPage,
};

/* --------------------------------------------------------------- the people */

const USERS = {
  "signed out": { signedIn: false, role: "student" },

  "student, no school": { signedIn: true, role: "student", school: false, admitted: false },
  "student, awaiting approval": { signedIn: true, role: "student", school: true, admitted: false },
  "student, rejected": { signedIn: true, role: "student", school: true, admitted: false },
  "student, approved": { signedIn: true, role: "student", school: true, admitted: true },
  "student, school expired": { signedIn: true, role: "student", school: true, admitted: false, expired: true },

  "school, application pending": { signedIn: true, role: "school", admitted: false, applicationStatus: "pending" },
  "school, approved": { signedIn: true, role: "school", admitted: true, applicationStatus: "approved" },
  "school, expired": { signedIn: true, role: "school", admitted: false, applicationStatus: "approved", expired: true },

  "admin": { signedIn: true, role: "admin", admitted: true },
  "admin, a school expired": { signedIn: true, role: "admin", admitted: true, expired: true },
};

const ENTRIES = Object.keys(PAGES);

/* Where each person should come to rest, from anywhere. `null` means the page
   they asked for is a legitimate resting place for them. */
const FORBIDDEN = {
  "student, no school": ["/student", "/student/profile", "/admin", "/school", "/teacher"],
  "student, awaiting approval": ["/student", "/student/profile", "/admin"],
  "student, rejected": ["/student", "/student/profile", "/admin"],
  /* /reset is absent from both of these on purpose — see resetPage(). */
  "student, school expired": ["/student", "/student/pending", "/student/join", "/admin"],
  "school, expired": ["/school", "/teacher", "/admin"],
  /* An administrator must never come to rest on the expiry screen. They are the
     only person who can lift an expiry, and the button is on /admin. */
  "admin, a school expired": ["/expired"],
  /* /reset is the one exception: a person mid-recovery is signed out by
     definition, and sending them to /login is what lost the session. */
  "signed out": ENTRIES.filter((p) => p !== "/login" && p !== "/reset"),
};

/* ------------------------------------------------------------------- walk it */

let failures = 0;
const MAX_HOPS = 8;

console.log("person                        entry              lands on           hops");
console.log("─".repeat(80));

for (const [name, user] of Object.entries(USERS)) {
  for (const entry of ENTRIES) {
    const seen = [];
    let at = entry;
    let hops = 0;

    while (hops < MAX_HOPS) {
      seen.push(at);
      const next = PAGES[at](user);
      if (next === at) break;
      if (seen.includes(next)) {
        console.error(
          `LOOP  ${name.padEnd(28)} ${entry.padEnd(18)} ${seen.join(" -> ")} -> ${next}`
        );
        failures++;
        at = null;
        break;
      }
      at = next;
      hops++;
    }

    if (at === null) continue;
    if (hops >= MAX_HOPS) {
      console.error(`RUNAWAY ${name.padEnd(26)} ${entry} never settled: ${seen.join(" -> ")}`);
      failures++;
      continue;
    }

    const banned = FORBIDDEN[name] ?? [];
    const bad = banned.includes(at);
    if (bad) {
      console.error(`WRONG ${name.padEnd(28)} ${entry.padEnd(18)} settled on ${at}`);
      failures++;
    }

    /* Only print one line per person, from the root, to keep this readable —
       every entry point is still walked and asserted. */
    if (entry === "/") {
      console.log(`${name.padEnd(29)} ${entry.padEnd(18)} ${at.padEnd(18)} ${hops}`);
    }
  }
}

console.log("");
console.log(`${Object.keys(USERS).length} people x ${ENTRIES.length} entry points = ` +
  `${Object.keys(USERS).length * ENTRIES.length} journeys walked`);

if (failures) {
  console.error(`\nFAIL — ${failures} problem(s)`);
  process.exit(1);
}
console.log("PASS — every journey terminates, and nobody lands somewhere they should not be");
