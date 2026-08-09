import { Router } from "express";
import { route } from "../auth.js";
import { adminClient } from "../supabase.js";

/**
 * STUDENT ROUTES
 * ==============
 * Everything here runs through `req.auth.db`, the caller's own client, so
 * Row Level Security is doing the scoping. A student asking for progress
 * gets their own; there is no `where user_id = me` to forget, because the
 * database will not return anyone else's rows regardless of what we ask for.
 *
 * The modules list is duplicated from the simulator's curriculum on purpose:
 * the portal is a separate deployment and should not fail to render a
 * progress page because a shared import moved.
 */

export const MODULES = [
  { id: "m1", number: 1, title: "The Airframe and Power" },
  { id: "m2", number: 2, title: "Control and First Flight" },
  { id: "m3", number: 3, title: "Complete Electronics" },
];

const router = Router();

/** Who am I, what am I, and where do I belong. */
router.get(
  "/me",
  route(async (req, res) => {
    const { db, user, role, schoolId } = req.auth;
    /* The approval columns arrive with student-approval.sql. If the server is
       deployed before that runs, asking for them makes PostgREST reject the
       whole select — and a null profile here would mean no name, no class and
       no school for every signed-in student. So fall back to the columns that
       have always existed. The deployment order is documented, but a documented
       order is not a guarantee, and this failure would look like total data
       loss to whoever hit it. */
    const BASE = "id, full_name, class_code, school_id, created_at";
    let { data: profile } = await db
      .from("profiles")
      .select(`${BASE}, status, joined_at, decided_at, decision_note`)
      .eq("id", user.id)
      .maybeSingle();

    if (!profile) {
      const fallback = await db.from("profiles").select(BASE).eq("id", user.id).maybeSingle();
      profile = fallback.data ?? null;
    }

    let school = null;
    if (schoolId) {
      const { data } = await db
        .from("schools")
        .select("id, name, join_code, region, status, active")
        .eq("id", schoolId)
        .maybeSingle();
      school = data ?? null;
    }

    /* `admitted` is the single flag the whole product gates on. Three things
       must all hold: the school exists and was approved, the school has not
       since been paused, and this particular student was approved into it.

       It is computed on every request rather than stored, so revoking either a
       school or one student takes effect on their next page load — no backfill,
       no stale flag, and no way for a rejected account to keep working because
       something forgot to be updated.

       Staff are exempt: a school account is admitted by its own approval, and
       an administrator by being one. */
    const staff = role === "admin" || role === "school" || role === "teacher";
    const schoolOk = Boolean(school && school.status === "approved" && school.active);
    const studentOk = (profile?.status ?? "approved") === "approved";
    const admitted = staff ? schoolOk || role === "admin" : schoolOk && studentOk;

    res.json({
      id: user.id,
      email: user.email,
      role,
      profile: profile ?? null,
      school,
      admitted,
      /* What the portal shows when `admitted` is false. "Waiting" and "turned
         down" are very different messages and must not be guessed at from the
         absence of admission. */
      approval: {
        status: profile?.status ?? "approved",
        joinedAt: profile?.joined_at ?? null,
        decidedAt: profile?.decided_at ?? null,
        note: profile?.decision_note ?? null,
      },
    });
  })
);

/** Update the parts of a profile a student owns. */
router.patch(
  "/me",
  route(async (req, res) => {
    const { db, user } = req.auth;
    const patch = {};
    if (typeof req.body?.full_name === "string") patch.full_name = req.body.full_name.trim().slice(0, 120);
    if (typeof req.body?.class_code === "string") patch.class_code = req.body.class_code.trim().slice(0, 40);
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    const { data, error } = await db
      .from("profiles")
      .update(patch)
      .eq("id", user.id)
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  })
);

/**
 * Join a school with its code.
 *
 * The lookup runs as the SERVICE ROLE, deliberately: a student who has not
 * joined yet cannot see any school under RLS, so they could never resolve the
 * code themselves. Only the matched school's id is used, and only to write the
 * caller's own profile — nothing else escapes the lookup.
 *
 * A code belonging to a school that is pending, rejected or paused is refused
 * with the reason, rather than a flat "invalid code". A student holding a real
 * code from a school still awaiting approval has done nothing wrong and needs
 * to know it is not their mistake.
 */
router.post(
  "/me/school",
  route(async (req, res) => {
    const code = String(req.body?.join_code ?? "").trim().toUpperCase();
    if (!code) return res.status(400).json({ error: "Enter your school's join code." });

    const admin = adminClient();
    const { data: school } = await admin
      .from("schools")
      .select("id, name, status, active")
      .eq("join_code", code)
      .maybeSingle();

    if (!school) {
      return res.status(404).json({
        error: "That code does not match any school. Check it with your teacher — codes look like ABCD-2345.",
      });
    }
    if (school.status === "pending") {
      return res.status(403).json({
        error: `${school.name} has applied but has not been approved yet. Your code will start working as soon as it is.`,
      });
    }
    if (school.status === "rejected") {
      return res.status(403).json({ error: `${school.name} is not an approved school on DroneLab.` });
    }
    if (!school.active) {
      return res.status(403).json({ error: `${school.name} is not currently active. Ask your teacher to get in touch.` });
    }

    /* The code attaches the student to the school and puts them in the queue.
       It does NOT admit them — see student-approval.sql for why a circulated
       code is a convenience rather than a credential.

       Written with the service role because the status columns are guarded by a
       trigger that only an administrator or the server may satisfy; the student
       is allowed to ask, not to answer. */
    const { error } = await admin
      .from("profiles")
      .update({
        school_id: school.id,
        status: "pending",
        joined_at: new Date().toISOString(),
        decided_at: null,
        decided_by: null,
        decision_note: null,
      })
      .eq("id", req.auth.user.id);
    if (error) return res.status(400).json({ error: error.message });

    res.json({
      joined: { id: school.id, name: school.name },
      admitted: false,
      status: "pending",
    });
  })
);

/** The learning progress the student panel is built around. */
router.get(
  "/progress",
  route(async (req, res) => {
    const { db, user } = req.auth;
    const [{ data: rows }, { data: activity }] = await Promise.all([
      db.from("module_progress").select("*").eq("user_id", user.id),
      db
        .from("activity_log")
        .select("day, flights, crashes, seconds")
        .eq("user_id", user.id)
        .order("day", { ascending: false })
        .limit(60),
    ]);

    const byId = new Map((rows ?? []).map((r) => [r.module_id, r]));
    /* Every module appears, whether or not the student has touched it.
       Returning only started modules would make an untouched course look
       like an empty account rather than a course not yet begun. */
    const modules = MODULES.map((m) => {
      const r = byId.get(m.id);
      return {
        ...m,
        completed: Boolean(r?.completed),
        tasksDone: r?.tasks_done ?? 0,
        tasksTotal: r?.tasks_total ?? 0,
        currentTask: r?.current_task ?? null,
        updatedAt: r?.updated_at ?? null,
      };
    });

    const completed = modules.filter((m) => m.completed).length;
    const totals = (activity ?? []).reduce(
      (a, d) => ({
        flights: a.flights + d.flights,
        crashes: a.crashes + d.crashes,
        seconds: a.seconds + d.seconds,
      }),
      { flights: 0, crashes: 0, seconds: 0 }
    );

    res.json({
      modules,
      summary: {
        modulesCompleted: completed,
        modulesTotal: MODULES.length,
        percent: Math.round((completed / MODULES.length) * 100),
        ...totals,
        streak: streakFrom(activity ?? []),
      },
      activity: activity ?? [],
    });
  })
);

/* --------------------------------------------------------------- help */
/**
 * ASKING FOR HELP
 * ---------------
 * The school panel counts students who "may need help" by inferring it from
 * silence. These routes let a student say it outright, in their own words, and
 * that is always better evidence than an inference.
 *
 * A student may have one open request at a time. This is not a limitation to
 * work around — it is what keeps the school's list readable, and it pushes the
 * student to describe the one thing actually blocking them rather than filing a
 * queue of half-thoughts.
 */
router.get(
  "/help",
  route(async (req, res) => {
    const { db, user } = req.auth;
    const { data, error } = await db
      .from("help_requests")
      .select("id, module_id, message, status, reply, answered_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return res.status(400).json({ error: error.message });

    const rows = data ?? [];
    res.json({ requests: rows, open: rows.find((r) => r.status === "open") ?? null });
  })
);

router.post(
  "/help",
  route(async (req, res) => {
    const { db, user, schoolId } = req.auth;

    const message = String(req.body?.message ?? "").trim().slice(0, 1000);
    const moduleId = req.body?.module_id ? String(req.body.module_id).slice(0, 20) : null;
    if (message.length < 5) {
      return res.status(400).json({
        error: "Tell your teacher what is going wrong — even one sentence is enough to act on.",
      });
    }
    if (!schoolId) {
      return res.status(409).json({
        error: "Join your school with its code first, so your question reaches someone.",
      });
    }

    const { data: existing } = await db
      .from("help_requests")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "open")
      .maybeSingle();

    /* Reword rather than pile up: a second request while one is open replaces
       it, so the teacher reads the current problem, not the history of it. */
    if (existing) {
      const { data, error } = await db
        .from("help_requests")
        .update({ message, module_id: moduleId, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select()
        .maybeSingle();
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ request: data, replaced: true });
    }

    const { data, error } = await db
      .from("help_requests")
      .insert({ user_id: user.id, school_id: schoolId, module_id: moduleId, message })
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ request: data, replaced: false });
  })
);

/** Withdraw it — "actually, I worked it out". */
router.delete(
  "/help/:id",
  route(async (req, res) => {
    const { db, user } = req.auth;
    const { error } = await db
      .from("help_requests")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", user.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  })
);

/** Consecutive days ending today (or yesterday — a streak survives until midnight tomorrow). */
function streakFrom(rows) {
  const days = new Set(rows.map((r) => r.day));
  const d = new Date();
  let n = 0;
  const iso = (x) => x.toISOString().slice(0, 10);
  if (!days.has(iso(d))) d.setDate(d.getDate() - 1);
  while (days.has(iso(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export default router;
