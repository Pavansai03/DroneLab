import { Router } from "express";
import { route, requireRole } from "../auth.js";
import { MODULES, shapeProgress } from "./student.js";
import { FRAMES, DEFAULT_FRAME } from "../frames.js";

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
      /* The same figures narrowed to one copter, so the panel's airframe
         dropdown changes the headline numbers as well as the table. Computed
         here rather than in the browser so the tile and the roster underneath
         it are counting the same thing. */
      summaryByFrame: Object.fromEntries(
        FRAMES.map((f) => [f.id, summarise(students, f.id)])
      ),
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
        .select("day, frame_id, flights, crashes, seconds")
        .eq("user_id", id)
        .order("day", { ascending: false })
        /* One row per airframe per day, so the window grows with them. */
        .limit(120),
      db.from("builds").select("frame_id, updated_at").eq("user_id", id).maybeSingle(),
    ]);

    /* Shaped by the same function the student's own panel uses. A teacher and a
       student looking at the same three copters must not be reading two
       different roll-ups of the same rows. */
    const shaped = shapeProgress(progress, activity);

    res.json({
      student: profile,
      ...shaped,
      /* The quadcopter's modules at the top level, as before. Every copter is
         in `byFrame`; this keeps an older panel bundle rendering a real table
         rather than an empty one. */
      modules: shaped.byFrame[DEFAULT_FRAME].modules,
      summary: shaped.overall,
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
      .select("id, name, join_code, region, created_at, subscription_starts_at, subscription_ends_at")
      .eq("id", schoolId)
      .maybeSingle();
    res.json({ school: data ?? null });
  })
);

/* ------------------------------------------------------------- help */
/** Everything the school's students have actually asked for. */
router.get(
  "/help",
  route(async (req, res) => {
    const { db, role, schoolId } = req.auth;

    let q = db
      .from("help_requests")
      .select("id, user_id, school_id, module_id, message, status, reply, answered_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    const wanted = req.query.school || (role === "admin" ? null : schoolId);
    if (wanted) q = q.eq("school_id", wanted);
    if (req.query.status) q = q.eq("status", req.query.status);

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    /* Attach names here rather than making the panel cross-reference the
       roster: a list of user ids is not something a teacher can read. */
    const rows = data ?? [];
    const ids = [...new Set(rows.map((r) => r.user_id))];
    let names = new Map();
    if (ids.length) {
      const { data: people } = await db
        .from("class_roster")
        .select("user_id, full_name, class_code")
        .in("user_id", ids);
      names = new Map((people ?? []).map((p) => [p.user_id, p]));
    }

    res.json({
      requests: rows.map((r) => ({
        ...r,
        full_name: names.get(r.user_id)?.full_name ?? null,
        class_code: names.get(r.user_id)?.class_code ?? null,
      })),
    });
  })
);

/** Answer one, or mark it dealt with. */
router.post(
  "/help/:id",
  route(async (req, res) => {
    const { db, user } = req.auth;
    const reply = req.body?.reply ? String(req.body.reply).trim().slice(0, 2000) : null;
    const status = req.body?.status === "closed" ? "closed" : "answered";

    const { data, error } = await db
      .from("help_requests")
      .update({
        reply,
        status,
        answered_by: user.id,
        answered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.id)
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "No such request in your school." });
    res.json({ request: data });
  })
);

/**
 * Roll a roster up.
 *
 * `frameId` narrows every figure to one copter; omitted, it is the whole
 * course — all three aircraft, so nine modules rather than three. The
 * per-airframe numbers come out of `per_frame`, the jsonb the class_roster view
 * carries; a row without it (an instance where the migration has not been run)
 * falls back to the pooled figure rather than reporting zero, because "no data"
 * and "no progress" look identical on a dashboard and mean opposite things.
 */
function summarise(rows, frameId) {
  const n = rows.length;
  if (!n) {
    return {
      students: 0, averageModules: 0, activeThisWeek: 0, needHelp: 0, asked: 0,
      frameId: frameId ?? null,
    };
  }
  const weekAgo = Date.now() - 7 * 864e5;
  const modulesOf = (r) =>
    frameId
      ? (r.per_frame?.[frameId]?.modules ?? 0)
      : (r.modules_completed ?? 0);
  const activeOf = (r) =>
    frameId ? (r.per_frame?.[frameId]?.last_active ?? null) : (r.last_active ?? null);

  return {
    frameId: frameId ?? null,
    modulesTotal: frameId ? MODULES.length : MODULES.length * FRAMES.length,
    students: n,
    averageModules: +(rows.reduce((a, r) => a + modulesOf(r), 0) / n).toFixed(1),
    activeThisWeek: rows.filter((r) => {
      const t = activeOf(r);
      return t && Date.parse(t) > weekAgo;
    }).length,
    /* Two ways onto this list, and the first outranks the second.
       ASKED: the student raised a request from their own panel and said what is
       wrong. That is not an inference, it is a request.
       STUCK: started a module, not finished it, not seen for a week. Silence is
       weak evidence, but a student who has quietly given up will never file a
       request — that is precisely what giving up looks like. Being merely slow
       does not qualify: a class works at different speeds by design. */
    asked: rows.filter((r) => (r.help_open ?? 0) > 0).length,
    needHelp: rows.filter((r) => {
      if ((r.help_open ?? 0) > 0) return true;
      const stuck = frameId ? r.per_frame?.[frameId]?.stuck_on : r.stuck_on;
      const seen = activeOf(r);
      return Boolean(stuck) && (!seen || Date.parse(seen) < weekAgo);
    }).length,
  };
}

export default router;
