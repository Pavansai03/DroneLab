import { Router } from "express";
import { route } from "../auth.js";

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
    const { data: profile } = await db
      .from("profiles")
      .select("id, full_name, class_code, school_id, created_at")
      .eq("id", user.id)
      .maybeSingle();

    let school = null;
    if (schoolId) {
      const { data } = await db
        .from("schools")
        .select("id, name, join_code, region")
        .eq("id", schoolId)
        .maybeSingle();
      school = data ?? null;
    }

    res.json({
      id: user.id,
      email: user.email,
      role,
      profile: profile ?? null,
      school,
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
 * Join a school by its code.
 *
 * The lookup runs as the SERVICE ROLE, deliberately: a student who has not
 * joined yet cannot see any school under RLS, so they could never resolve
 * the code themselves. Only the id of the matched school is used, and only
 * to write the caller's own profile — nothing else leaks out of the lookup.
 */
router.post(
  "/me/school",
  route(async (req, res) => {
    const code = String(req.body?.join_code ?? "").trim().toUpperCase();
    if (!code) return res.status(400).json({ error: "Enter a join code." });

    const { adminClient } = await import("../supabase.js");
    const admin = adminClient();
    const { data: school } = await admin
      .from("schools")
      .select("id, name, active")
      .eq("join_code", code)
      .maybeSingle();

    if (!school) return res.status(404).json({ error: "No school has that join code." });
    if (!school.active) return res.status(403).json({ error: `${school.name} is not currently active.` });

    const { error } = await req.auth.db
      .from("profiles")
      .update({ school_id: school.id })
      .eq("id", req.auth.user.id);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ joined: { id: school.id, name: school.name } });
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
