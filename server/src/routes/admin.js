import { Router } from "express";
import { route, requireRole } from "../auth.js";
import { adminClient } from "../supabase.js";
import { FRAMES } from "../frames.js";
import { MODULES } from "./student.js";

/** Three modules on each of three copters. */
const MODULES_PER_FRAME = MODULES.length;
/* NO EMAIL IS SENT TO SCHOOLS.
   Approving and rejecting used to email the school, which meant the whole
   product depended on SMTP being configured and correct — and when it was not,
   the panel had to explain that in a notice nobody wanted to read. The join
   code is shown to the administrator at the moment of approval instead, and
   passed on by whoever is already talking to the school. The mailer module is
   left in place; nothing calls it. */

/**
 * SUPER ADMIN ROUTES
 * ==================
 * The only place in the system that uses the service role key, and
 * therefore the only place where the database has stopped enforcing
 * anything. Every route here is behind `requireRole("admin")`, and that
 * check is the entire security boundary — there is no second line.
 *
 * These operations genuinely cannot be done any other way:
 *   * granting a role, because user_roles has no client-writable policy
 *     (which is what stops a student promoting themselves)
 *   * creating a school, for the same reason
 *   * counting across every school, which RLS exists to prevent
 */

const router = Router();
router.use(requireRole("admin"));

/* --------------------------------------------------- school applications */

/** Everything awaiting a decision, oldest first — a queue, so work through it. */
router.get(
  "/applications",
  route(async (req, res) => {
    const db = adminClient();
    let q = db.from("school_applications").select("*").order("applied_at", { ascending: true });
    if (req.query.status) q = q.eq("status", req.query.status);
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({
      applications: data ?? [],
      pending: (data ?? []).filter((a) => a.status === "pending").length,
    });
  })
);

/**
 * Approve a school and mint its join code.
 *
 * The code is generated HERE, at the moment of approval, rather than at
 * application time. A code that exists before anyone has vetted the school is a
 * code that can leak from a backup or a log line while the school is still
 * unapproved; generating it on approval means an unapproved school has nothing
 * to leak.
 *
 * Nothing is emailed. The code comes back in the response and the panel shows
 * it, for whoever is already in touch with the school to pass on.
 */
router.post(
  "/applications/:id/approve",
  route(async (req, res) => {
    const db = adminClient();
    const { data: school } = await db
      .from("schools")
      .select("id, name, status, contact_email, join_code, owner_id")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!school) return res.status(404).json({ error: "No such application." });
    if (school.status === "approved") {
      return res.status(409).json({ error: `${school.name} is already approved.` });
    }

    const joinCode = await uniqueJoinCode(db, school.name);
    const patch = {
      status: "approved",
      join_code: joinCode,
      active: true,
      decided_at: new Date().toISOString(),
      decided_by: req.auth.user.id,
      decision_note: null,
    };
    if (req.body?.subscription_starts_at !== undefined) {
      patch.subscription_starts_at = req.body.subscription_starts_at
        ? parseTimestamp(req.body.subscription_starts_at, "Subscription start")
        : null;
    }
    if (req.body?.subscription_ends_at !== undefined) {
      patch.subscription_ends_at = req.body.subscription_ends_at
        ? parseTimestamp(req.body.subscription_ends_at, "Subscription end")
        : null;
    }
    const { data: updated, error } = await db
      .from("schools")
      .update(patch)
      .eq("id", school.id)
      .select("id, name, join_code, status, contact_email")
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });

    /* Make the owner a member of their own school.
       my_school_id() reads profiles.school_id, and every row-level policy keys
       off it — so an owner whose profile does not point at their own school
       resolves to NULL and sees an empty roster for a school full of students.
       Approving is the moment the school becomes real, so it is the moment to
       attach its owner to it. */
    if (school.owner_id) {
      await db.from("profiles").update({ school_id: school.id }).eq("id", school.owner_id);
    }

    res.json({ school: updated });
  })
);

router.post(
  "/applications/:id/reject",
  route(async (req, res) => {
    const note = String(req.body?.note ?? "").trim().slice(0, 500) || null;
    const db = adminClient();

    const { data: school } = await db
      .from("schools")
      .select("id, name, contact_email, status")
      .eq("id", req.params.id)
      .maybeSingle();
    if (!school) return res.status(404).json({ error: "No such application." });

    const { error } = await db
      .from("schools")
      .update({
        status: "rejected",
        active: false,
        join_code: null, // if it ever had one, it stops working now
        decided_at: new Date().toISOString(),
        decided_by: req.auth.user.id,
        decision_note: note,
        subscription_starts_at: null,
        subscription_ends_at: null,
      })
      .eq("id", school.id);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ id: school.id, status: "rejected" });
  })
);

/**
 * A join code nobody else holds.
 *
 * Retries on collision rather than trusting randomness: the code is short and
 * human-typeable by design, so the space is small enough that a clash is a real
 * possibility rather than a theoretical one, and two schools sharing a code
 * would silently put one school's students on the other's roster.
 */
async function uniqueJoinCode(db, name) {
  for (let i = 0; i < 12; i++) {
    const code = makeJoinCode(name);
    const { data } = await db.from("schools").select("id").eq("join_code", code).maybeSingle();
    if (!data) return code;
  }
  throw new Error("Could not allocate an unused join code.");
}

/* --------------------------------------------------------------- schools */

router.get(
  "/schools",
  route(async (_req, res) => {
    const db = adminClient();
    const [{ data: schools }, { data: roster }] = await Promise.all([
      db.from("schools").select("*").order("name"),
      db.from("class_roster").select("school_id, role, modules_completed, per_frame, last_active"),
    ]);

    /* Three modules on each of three copters. This was 3 when there was one
       aircraft, which made every school's progress percentage three times what
       it should be the moment the hexacopter and octocopter shipped. */
    const MODULES_TOTAL = MODULES_PER_FRAME * FRAMES.length;
    const week = Date.now() - 7 * 864e5;
    const agg = new Map();
    for (const r of roster ?? []) {
      if (!r.school_id) continue;
      const a =
        agg.get(r.school_id) ??
        {
          students: 0, staff: 0, modules: 0, active: 0,
          /* Per copter as well as in total. "Which aircraft did this school
             stall on" is unanswerable from a single average, and it is the
             question that decides whether a school needs help. */
          byFrame: Object.fromEntries(FRAMES.map((f) => [f.id, 0])),
        };
      if (r.role === "teacher" || r.role === "school") a.staff++;
      else {
        a.students++;
        a.modules += r.modules_completed ?? 0;
        for (const f of FRAMES) a.byFrame[f.id] += r.per_frame?.[f.id]?.modules ?? 0;
        if (r.last_active && Date.parse(r.last_active) > week) a.active++;
      }
      agg.set(r.school_id, a);
    }

    const emptyAgg = () => ({
      students: 0, staff: 0, modules: 0, active: 0,
      byFrame: Object.fromEntries(FRAMES.map((f) => [f.id, 0])),
    });

    res.json({
      schools: (schools ?? []).map((x) => {
        const a = agg.get(x.id) ?? emptyAgg();
        /* Progress as a percentage of what the school COULD have completed.
           A raw module count says nothing without knowing how many students it
           is spread across — five modules is excellent across two students and
           dismal across forty. */
        const possible = a.students * MODULES_TOTAL;
        return {
          ...x,
          stats: { ...a, percent: possible ? Math.round((a.modules / possible) * 100) : 0 },
        };
      }),
    });
  })
);

router.post(
  "/schools",
  route(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "A school needs a name." });

    const region = String(req.body?.region ?? "").trim() || null;
    const joinCode = String(req.body?.join_code ?? "").trim().toUpperCase() || makeJoinCode(name);

    const db = adminClient();
    const { data, error } = await db
      .from("schools")
      .insert({ name, region, join_code: joinCode })
      .select()
      .maybeSingle();

    // 23505 is Postgres' unique_violation — the only failure worth explaining
    if (error?.code === "23505") {
      return res.status(409).json({ error: `The join code ${joinCode} is already taken.` });
    }
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  })
);

router.patch(
  "/schools/:id",
  route(async (req, res) => {
    const patch = {};
    if (typeof req.body?.name === "string") patch.name = req.body.name.trim();
    if (typeof req.body?.region === "string") patch.region = req.body.region.trim();
    if (typeof req.body?.active === "boolean") patch.active = req.body.active;
    if (req.body?.subscription_starts_at !== undefined) {
      patch.subscription_starts_at = req.body.subscription_starts_at
        ? parseTimestamp(req.body.subscription_starts_at, "Subscription start")
        : null;
    }
    if (req.body?.subscription_ends_at !== undefined) {
      patch.subscription_ends_at = req.body.subscription_ends_at
        ? parseTimestamp(req.body.subscription_ends_at, "Subscription end")
        : null;
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to update." });

    const { data, error } = await adminClient()
      .from("schools")
      .update(patch)
      .eq("id", req.params.id)
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  })
);

/* ------------------------------------------------------- student approvals */

/**
 * Students waiting on a decision, or already decided.
 *
 * A student and a school are approved by the same person for the same reason,
 * so they are deliberately shaped the same way here: a list, a status filter,
 * and one route that records a decision either way.
 */
router.get(
  "/students",
  route(async (req, res) => {
    const db = adminClient();
    let q = db
      .from("class_roster")
      .select("*")
      .eq("role", "student")
      .not("school_id", "is", null)
      .order("joined_at", { ascending: false, nullsFirst: false });

    if (req.query.status) q = q.eq("student_status", req.query.status);
    if (req.query.school) q = q.eq("school_id", req.query.school);

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ students: data ?? [] });
  })
);

/**
 * Record a decision about one student.
 *
 * Reversible in both directions and at any time. An approval given in error has
 * to be retractable, or the only remedy is deleting a child's account and the
 * work in it — and a school that leaves has to be closable without that.
 */
router.post(
  "/students/:id/decision",
  route(async (req, res) => {
    const decision = String(req.body?.decision ?? "");
    if (!["approved", "rejected", "pending"].includes(decision)) {
      return res.status(400).json({ error: "Decision must be approved, rejected or pending." });
    }
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;

    const { data, error } = await adminClient()
      .from("profiles")
      .update({
        status: decision,
        decided_at: new Date().toISOString(),
        decided_by: req.auth.user.id,
        decision_note: note,
      })
      .eq("id", req.params.id)
      .select("id, full_name, status, decided_at, decision_note")
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "No such student." });
    res.json({ student: data });
  })
);

/* ----------------------------------------------------------------- people */

router.get(
  "/users",
  route(async (req, res) => {
    const db = adminClient();
    let q = db.from("class_roster").select("*").order("created_at", { ascending: false });
    if (req.query.school) q = q.eq("school_id", req.query.school);
    if (req.query.role) {
      /* 'school' and 'teacher' mean the same thing everywhere downstream, so a
         filter for either must return both — otherwise an older account
         disappears from a list it belongs in. */
      if (req.query.role === "school") q = q.in("role", ["school", "teacher"]);
      else q = q.eq("role", req.query.role);
    }
    const { data, error } = await q.limit(1000);
    if (error) return res.status(400).json({ error: error.message });

    /* Join codes live on the school and the roster view does not carry them.
       Resolving here rather than in the browser means the list arrives complete,
       so a search box can match a code as readily as a name. */
    const { data: schools } = await db.from("schools").select("id, join_code, status");
    const byId = new Map((schools ?? []).map((x) => [x.id, x]));

    res.json({
      users: (data ?? []).map((u) => ({
        ...u,
        join_code: byId.get(u.school_id)?.join_code ?? null,
        school_status: byId.get(u.school_id)?.status ?? null,
      })),
    });
  })
);

/** Grant a role. The one operation the client is structurally unable to do. */
router.post(
  "/users/:id/role",
  route(async (req, res) => {
    const role = String(req.body?.role ?? "");
    if (!["student", "school", "teacher", "admin"].includes(role)) {
      return res.status(400).json({ error: "Role must be student, school or admin." });
    }

    /* An admin must not be able to demote themselves. It is a one-click way
       to lock every owner out of the system with no way back in short of
       editing the database by hand. */
    if (req.params.id === req.auth.user.id && role !== "admin") {
      return res.status(409).json({
        error: "You cannot remove your own admin role — ask another admin to do it.",
      });
    }

    const db = adminClient();
    const { error } = await db
      .from("user_roles")
      .upsert({ user_id: req.params.id, role }, { onConflict: "user_id" });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user_id: req.params.id, role });
  })
);

/** Move someone between schools, which a teacher cannot do for themselves. */
router.post(
  "/users/:id/school",
  route(async (req, res) => {
    const schoolId = req.body?.school_id ?? null;
    const { error } = await adminClient()
      .from("profiles")
      .update({ school_id: schoolId })
      .eq("id", req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user_id: req.params.id, school_id: schoolId });
  })
);

/* ------------------------------------------------------------ the overview */

router.get(
  "/stats",
  route(async (_req, res) => {
    const db = adminClient();
    const [{ data: roster }, { data: schools }] = await Promise.all([
      db.from("class_roster").select("role, modules_completed, last_active, school_id"),
      db.from("schools").select("id, active, status"),
    ]);

    const rows = roster ?? [];
    const students = rows.filter((r) => r.role === "student");
    const week = Date.now() - 7 * 864e5;

    /* Four numbers, and every one of them is a link to the list behind it.
       Anything that cannot be drilled into does not belong on this screen: a
       count with no way to ask "which ones?" is trivia. */
    res.json({
      totals: {
        schools: (schools ?? []).filter((x) => x.status === "approved").length,
        students: students.length,
        admins: rows.filter((r) => r.role === "admin").length,
        activeThisWeek: students.filter((r) => r.last_active && Date.parse(r.last_active) > week).length,
      },
      pendingApplications: (schools ?? []).filter((x) => x.status === "pending").length,
    });
  })
);

/**
 * A short, typeable code, seeded from the school's name so it is recognisable.
 *
 * The digits deliberately exclude 0 and 1: this code is read off a whiteboard
 * and typed by thirty people, and 0/O and 1/I are the pair that generates
 * support requests. The letters come from the name, which also means a student
 * mistyping someone else's code is unlikely to land on a real one.
 */
/**
 * A date from the client, as an ISO string.
 *
 * `status` is set so the error handler answers 400 rather than 500. A date
 * someone mistyped in a form is their mistake to correct, and the generic
 * "Something went wrong. Reference: ab12cd" tells them nothing they can act on
 * — it reads as the server being broken.
 */
function parseTimestamp(value, field = "date") {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    const err = new Error(`${field} is not a date I can read. Use YYYY-MM-DD.`);
    err.status = 400;
    throw err;
  }
  return date.toISOString();
}

function makeJoinCode(name) {
  const letters = name.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 4).padEnd(4, "X");
  const safe = "23456789";
  let digits = "";
  for (let i = 0; i < 4; i++) digits += safe[Math.floor(Math.random() * safe.length)];
  return `${letters}-${digits}`;
}

export default router;
