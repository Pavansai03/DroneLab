import { Router } from "express";
import { route, requireRole } from "../auth.js";
import { MODULES } from "./student.js";

/**
 * TEACHER / SCHOOL ROUTES
 * =======================
 * A teacher sees their own school and nothing else. That scoping is not
 * written here — it is in the RLS policies, and every query below runs as
 * the caller. If a bug in this file asked for every student in the
 * database, the database would still return only the teacher's own school.
 *
 * `requireRole` is present anyway, so a student hitting these URLs gets a
 * clear 403 rather than a confusing empty list.
 */

const router = Router();

/* 'school' is the role a school account gets on registration; 'teacher'
   predates it and is kept so existing accounts keep working. Omitting 'school'
   here meant every school account reached its own dashboard and then had every
   request refused — the panel loaded and nothing in it did. */
router.use(requireRole("teacher", "school", "admin"));

/** The class roster, with progress rolled up per student. */
router.get(
  "/roster",
  route(async (req, res) => {
    const { db, role, schoolId } = req.auth;

    if (role !== "admin" && !schoolId) {
      return res.status(409).json({
        error: "Your account is not attached to a school yet. Ask an administrator to assign you one.",
        roster: [],
      });
    }

    let q = db.from("class_roster").select("*").order("full_name", { ascending: true });
    /* An admin may pass ?school= to look at one school; without it they see
       every school. A teacher's own scoping is enforced by RLS regardless of
       what they pass, so this filter is a convenience, not a control. */
    const wanted = req.query.school || (role === "admin" ? null : schoolId);
    if (wanted) q = q.eq("school_id", wanted);

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    const students = (data ?? []).filter((r) => r.role === "student");
    res.json({
      roster: students,
      summary: summarise(students),
    });
  })
);

/** One student in full: profile, per-module progress, recent activity. */
router.get(
  "/students/:id",
  route(async (req, res) => {
    const { db } = req.auth;
    const id = req.params.id;

    // RLS returns nothing for a student outside the teacher's school.
    const { data: profile } = await db
      .from("class_roster")
      .select("*")
      .eq("user_id", id)
      .maybeSingle();

    if (!profile) {
      return res.status(404).json({ error: "No such student in your school." });
    }

    const [{ data: progress }, { data: activity }, { data: build }] = await Promise.all([
      db.from("module_progress").select("*").eq("user_id", id),
      db
        .from("activity_log")
        .select("day, flights, crashes, seconds")
        .eq("user_id", id)
        .order("day", { ascending: false })
        .limit(30),
      db.from("builds").select("frame_id, updated_at").eq("user_id", id).maybeSingle(),
    ]);

    const byId = new Map((progress ?? []).map((r) => [r.module_id, r]));
    res.json({
      student: profile,
      modules: MODULES.map((m) => {
        const r = byId.get(m.id);
        return {
          ...m,
          completed: Boolean(r?.completed),
          tasksDone: r?.tasks_done ?? 0,
          tasksTotal: r?.tasks_total ?? 0,
          currentTask: r?.current_task ?? null,
          updatedAt: r?.updated_at ?? null,
        };
      }),
      activity: activity ?? [],
      build: build ?? null,
    });
  })
);

/** The school itself, for the panel header. */
router.get(
  "/school",
  route(async (req, res) => {
    const { db, schoolId } = req.auth;
    if (!schoolId) return res.json({ school: null });
    const { data } = await db
      .from("schools")
      .select("id, name, join_code, region, created_at")
      .eq("id", schoolId)
      .maybeSingle();
    res.json({ school: data ?? null });
  })
);

function summarise(rows) {
  const n = rows.length;
  if (!n) return { students: 0, averageModules: 0, activeThisWeek: 0, needHelp: 0 };
  const weekAgo = Date.now() - 7 * 864e5;
  return {
    students: n,
    averageModules: +(rows.reduce((a, r) => a + (r.modules_completed ?? 0), 0) / n).toFixed(1),
    activeThisWeek: rows.filter((r) => r.last_active && Date.parse(r.last_active) > weekAgo).length,
    /* "Needs help" is deliberately about being STUCK, not about being slow:
       someone who has started a module and not finished it, and has not been
       seen for a week. A student steadily working through module 1 is not a
       problem and should not be flagged as one. */
    needHelp: rows.filter(
      (r) => r.stuck_on && (!r.last_active || Date.parse(r.last_active) < weekAgo)
    ).length,
  };
}

export default router;
