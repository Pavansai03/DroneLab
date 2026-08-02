import { Router } from "express";
import { route, requireRole } from "../auth.js";
import { adminClient } from "../supabase.js";

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

/* --------------------------------------------------------------- schools */

router.get(
  "/schools",
  route(async (_req, res) => {
    const db = adminClient();
    const [{ data: schools }, { data: roster }] = await Promise.all([
      db.from("schools").select("*").order("name"),
      db.from("class_roster").select("school_id, role, modules_completed, last_active"),
    ]);

    const byShool = new Map();
    for (const r of roster ?? []) {
      if (!r.school_id) continue;
      const s = byShool.get(r.school_id) ?? { students: 0, teachers: 0, modules: 0, active: 0 };
      if (r.role === "teacher") s.teachers++;
      else {
        s.students++;
        s.modules += r.modules_completed ?? 0;
        if (r.last_active && Date.parse(r.last_active) > Date.now() - 7 * 864e5) s.active++;
      }
      byShool.set(r.school_id, s);
    }

    res.json({
      schools: (schools ?? []).map((s) => ({
        ...s,
        stats: byShool.get(s.id) ?? { students: 0, teachers: 0, modules: 0, active: 0 },
      })),
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

/* ----------------------------------------------------------------- people */

router.get(
  "/users",
  route(async (req, res) => {
    const db = adminClient();
    let q = db.from("class_roster").select("*").order("created_at", { ascending: false });
    if (req.query.school) q = q.eq("school_id", req.query.school);
    if (req.query.role) q = q.eq("role", req.query.role);
    const { data, error } = await q.limit(500);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ users: data ?? [] });
  })
);

/** Grant a role. The one operation the client is structurally unable to do. */
router.post(
  "/users/:id/role",
  route(async (req, res) => {
    const role = String(req.body?.role ?? "");
    if (!["student", "teacher", "admin"].includes(role)) {
      return res.status(400).json({ error: "Role must be student, teacher or admin." });
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
    const [{ data: roster }, { data: schools }, { data: activity }] = await Promise.all([
      db.from("class_roster").select("role, modules_completed, last_active, school_id"),
      db.from("schools").select("id, active"),
      db.from("activity_log").select("day, flights, crashes").order("day", { ascending: false }).limit(2000),
    ]);

    const rows = roster ?? [];
    const students = rows.filter((r) => r.role === "student");
    const week = Date.now() - 7 * 864e5;

    /* Flights per day for the last fortnight, oldest first, so the panel can
       draw it straight without reversing. */
    const byDay = new Map();
    for (const a of activity ?? []) {
      const d = byDay.get(a.day) ?? { day: a.day, flights: 0, crashes: 0 };
      d.flights += a.flights;
      d.crashes += a.crashes;
      byDay.set(a.day, d);
    }
    const daily = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-14);

    res.json({
      totals: {
        schools: (schools ?? []).length,
        activeSchools: (schools ?? []).filter((s) => s.active).length,
        students: students.length,
        teachers: rows.filter((r) => r.role === "teacher").length,
        admins: rows.filter((r) => r.role === "admin").length,
        unassigned: rows.filter((r) => !r.school_id).length,
        activeThisWeek: students.filter((r) => r.last_active && Date.parse(r.last_active) > week).length,
        modulesCompleted: students.reduce((a, r) => a + (r.modules_completed ?? 0), 0),
      },
      daily,
    });
  })
);

/** A short, typeable code — no ambiguous characters, seeded from the name. */
function makeJoinCode(name) {
  const letters = name.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 4).padEnd(4, "X");
  const digits = String(Math.floor(Math.random() * 9000) + 1000);
  return `${letters}-${digits}`;
}

export default router;
