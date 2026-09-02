"use client";

import { FRAMES, frameLabel } from "./frames.js";

/**
 * REPORT EXPORT
 * =============
 * CSV, deliberately.
 *
 * A report here is evidence for a person: a teacher writing an end-of-term
 * comment, a head of department signing off a course, an administrator
 * answering a parent. All three want to open it in Excel, sort it, and paste a
 * row into something else. A PDF looks more official and can do none of that,
 * and building one would mean shipping a rendering library to every student's
 * browser for a file most of them will never generate.
 *
 * One builder per report, all returning plain text, so what is exported is
 * exactly what can be read in the panel — no second source of truth.
 */

/** RFC 4180: quote anything containing a comma, quote or newline; double inner quotes. */
function cell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

function when(v) {
  return v ? new Date(v).toLocaleString() : "";
}

function day(v) {
  return v ? new Date(v).toLocaleDateString() : "";
}

/**
 * Hand the file to the browser.
 *
 * A Blob and an object URL rather than a data: URI — a whole-school export runs
 * to hundreds of rows, and data: URIs have a length limit that a school large
 * enough to need the report is exactly the one that would hit.
 */
export function download(filename, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Turn a name into something safe to put in a filename. */
export function slug(s) {
  return (s || "report")
    .toString()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .toLowerCase() || "report";
}

/* ==================================================================== */
/* One student                                                          */
/* ==================================================================== */
/**
 * `detail` is what /api/teacher/students/:id returns, or the student's own
 * /api/progress reshaped to match. Both carry modules and activity; the school
 * and administration versions additionally know the student's own row.
 */
/**
 * EVERY COPTER, EVERY TIME.
 *
 * The panels have an airframe dropdown; this deliberately ignores it. A report
 * is evidence, and a file that quietly omitted two of the three aircraft
 * because of a filter someone left set is the worst kind of wrong — it is not
 * obviously incomplete to the person reading it later. So the summary is broken
 * out per copter, and the module table carries a Copter column with all nine
 * rows in it.
 */
export function studentReportCsv({ student, modules, activity, build, school, byFrame, overall, unattributed }) {
  const rows = [];
  rows.push(["DroneLab — student report"]);
  rows.push(["Generated", when(new Date())]);
  rows.push([]);

  rows.push(["Student"]);
  rows.push(["Name", student?.full_name || "(not set)"]);
  if (student?.email) rows.push(["Email", student.email]);
  rows.push(["Class", student?.class_code || ""]);
  rows.push(["School", school?.name ?? student?.school_name ?? ""]);
  if (student?.student_status) rows.push(["Approval status", student.student_status]);
  if (student?.joined_at) rows.push(["Joined", when(student.joined_at)]);
  if (student?.decided_at) rows.push(["Approved", when(student.decided_at)]);
  rows.push([]);

  /* An API that has not been redeployed sends no per-copter breakdown. Fall
     back to the single unlabelled course rather than an empty report. */
  const frames = byFrame ? FRAMES.filter((f) => byFrame[f.id]) : [];

  const totalsOf = (log) =>
    (log ?? []).reduce(
      (a, d) => ({
        flights: a.flights + (d.flights ?? 0),
        crashes: a.crashes + (d.crashes ?? 0),
        seconds: a.seconds + (d.seconds ?? 0),
      }),
      { flights: 0, crashes: 0, seconds: 0 }
    );

  const overallTotals = totalsOf(activity);
  const done = overall?.modulesCompleted ?? (modules ?? []).filter((m) => m.completed).length;
  const total = overall?.modulesTotal ?? (modules ?? []).length;

  rows.push(["Summary — whole course"]);
  rows.push(["Modules completed", `${done} of ${total}`]);
  rows.push(["Course progress", total ? `${Math.round((done / total) * 100)}%` : "0%"]);
  if (overall?.coptersTotal) {
    rows.push(["Copters finished", `${overall.coptersFinished} of ${overall.coptersTotal}`]);
  }
  rows.push(["Flights flown", overallTotals.flights]);
  rows.push(["Crashes", overallTotals.crashes]);
  rows.push(["Time in the simulator", `${Math.round(overallTotals.seconds / 60)} min`]);
  if (build?.frame_id) rows.push(["Current build", frameLabel(build.frame_id)]);
  rows.push([]);

  if (frames.length) {
    rows.push(["Summary — by copter"]);
    rows.push(["Copter", "Motors", "Modules completed", "Progress", "Flights", "Crashes", "Minutes", "Last worked on"]);
    for (const f of frames) {
      const s = byFrame[f.id].summary ?? {};
      const t = totalsOf(byFrame[f.id].activity);
      const last = (byFrame[f.id].modules ?? [])
        .map((m) => m.updatedAt)
        .filter(Boolean)
        .sort()
        .pop();
      rows.push([
        f.label,
        f.motors,
        `${s.modulesCompleted ?? 0} of ${s.modulesTotal ?? 3}`,
        `${s.percent ?? 0}%`,
        t.flights,
        t.crashes,
        Math.round(t.seconds / 60),
        when(last),
      ]);
    }
    if (
      (unattributed?.flights ?? 0) > 0 ||
      (unattributed?.crashes ?? 0) > 0 ||
      (unattributed?.modules ?? 0) > 0
    ) {
      /* Named, not hidden and not attributed to a copter that may never have
         flown them. See supabase/per-airframe-progress.sql. */
      rows.push([
        "Not recorded", "",
        (unattributed.modules ?? 0) > 0 ? `${unattributed.modules} finished` : "",
        "",
        unattributed.flights ?? 0,
        unattributed.crashes ?? 0,
        Math.round((unattributed.seconds ?? 0) / 60),
        "recorded before progress was kept per copter",
      ]);
    }
    rows.push([]);
  }

  rows.push(["Modules"]);
  rows.push(["Copter", "#", "Module", "Status", "Tasks done", "Tasks total", "Current task", "Last worked on"]);
  const moduleRow = (label, m) => [
    label,
    m.number,
    m.title,
    m.completed ? "complete" : (m.tasksDone ?? 0) > 0 ? "in progress" : "not started",
    m.tasksDone ?? 0,
    m.tasksTotal ?? 0,
    m.currentTask ?? "",
    when(m.updatedAt),
  ];
  if (frames.length) {
    for (const f of frames) {
      for (const m of byFrame[f.id].modules ?? []) rows.push(moduleRow(f.label, m));
    }
  } else {
    for (const m of modules ?? []) rows.push(moduleRow("", m));
  }

  if ((activity ?? []).length) {
    rows.push([]);
    rows.push(["Practice log"]);
    rows.push(["Day", "Flights", "Crashes", "Minutes"]);
    for (const d of activity) {
      rows.push([day(d.day), d.flights ?? 0, d.crashes ?? 0, Math.round((d.seconds ?? 0) / 60)]);
    }
  }

  return toCsv(rows);
}

/* ==================================================================== */
/* One school                                                           */
/* ==================================================================== */
export function schoolReportCsv({ school, roster, summary }) {
  const rows = [];
  rows.push(["DroneLab — school report"]);
  rows.push(["Generated", when(new Date())]);
  rows.push([]);

  rows.push(["School"]);
  rows.push(["Name", school?.name ?? ""]);
  if (school?.join_code) rows.push(["Join code", school.join_code]);
  if (school?.region) rows.push(["Region", school.region]);
  if (school?.status) rows.push(["Status", school.status]);
  if (school?.contact_email) rows.push(["Contact", school.contact_email]);
  if (school?.applied_at) rows.push(["Applied", when(school.applied_at)]);
  if (school?.decided_at) rows.push(["Approved", when(school.decided_at)]);
  rows.push([]);

  if (summary) {
    rows.push(["Summary"]);
    rows.push(["Students", summary.students ?? 0]);
    rows.push(["Active this week", summary.activeThisWeek ?? 0]);
    rows.push([
      "Average modules completed",
      `${summary.averageModules ?? 0} of ${summary.modulesTotal ?? 9}`,
    ]);
    rows.push(["May need help", summary.needHelp ?? 0]);
    if (summary.asked !== undefined) rows.push(["Asked for help directly", summary.asked]);
    rows.push([]);
  }

  /* Per copter, for the whole school, when the roster carries the breakdown.
     A head of department signing off a course wants to know which aircraft the
     class stalled on, and that question is unanswerable from a single average. */
  if ((roster ?? []).some((r) => r.per_frame)) {
    rows.push(["Summary — by copter"]);
    rows.push(["Copter", "Modules completed (class total)", "Average per student", "Students who finished it", "Flights", "Crashes"]);
    const n = (roster ?? []).length || 1;
    for (const f of FRAMES) {
      const modules = (roster ?? []).reduce((a, r) => a + (r.per_frame?.[f.id]?.modules ?? 0), 0);
      rows.push([
        f.label,
        modules,
        +(modules / n).toFixed(1),
        (roster ?? []).filter((r) => (r.per_frame?.[f.id]?.modules ?? 0) >= 3).length,
        (roster ?? []).reduce((a, r) => a + (r.per_frame?.[f.id]?.flights ?? 0), 0),
        (roster ?? []).reduce((a, r) => a + (r.per_frame?.[f.id]?.crashes ?? 0), 0),
      ]);
    }
    rows.push([]);
  }

  rows.push(["Students"]);
  rows.push([
    "Name", "Class", "Approval", "Joined", "Approved on",
    "Modules completed", ...FRAMES.map((f) => `${f.label} modules`),
    "Flights", "Crashes", "Last active", "Working on", "Asked for help",
  ]);
  for (const r of roster ?? []) {
    rows.push([
      r.full_name || "(not set)",
      r.class_code || "",
      r.student_status || "approved",
      when(r.joined_at),
      when(r.decided_at),
      r.modules_completed ?? 0,
      ...FRAMES.map((f) => r.per_frame?.[f.id]?.modules ?? 0),
      r.total_flights ?? 0,
      r.total_crashes ?? 0,
      when(r.last_active),
      r.stuck_on ?? "",
      r.help_note ?? "",
    ]);
  }

  return toCsv(rows);
}

/* ==================================================================== */
/* Every school                                                         */
/* ==================================================================== */
export function schoolsReportCsv(schools) {
  const rows = [];
  rows.push(["DroneLab — all schools"]);
  rows.push(["Generated", when(new Date())]);
  rows.push([]);
  rows.push([
    "School", "Status", "Join code", "Region", "Contact", "Phone",
    "Applied", "Decided", "Students", "Modules completed",
    ...FRAMES.map((f) => `${f.label} modules`),
    "Average progress", "Active",
  ]);
  for (const s of schools ?? []) {
    rows.push([
      s.name,
      s.status,
      s.join_code ?? "",
      s.region ?? "",
      s.contact_email ?? "",
      s.phone ?? "",
      when(s.applied_at),
      when(s.decided_at),
      s.stats?.students ?? 0,
      s.stats?.modules ?? 0,
      ...FRAMES.map((f) => s.stats?.byFrame?.[f.id] ?? 0),
      s.stats?.percent != null ? `${s.stats.percent}%` : "",
      s.active ? "yes" : "no",
    ]);
  }
  return toCsv(rows);
}

/* ==================================================================== */
/* Every student an administrator can see                               */
/* ==================================================================== */
export function studentsReportCsv(rows_) {
  const rows = [];
  rows.push(["DroneLab — all students"]);
  rows.push(["Generated", when(new Date())]);
  rows.push([]);
  rows.push([
    "Name", "School", "Join code", "Class", "Approval", "Joined", "Approved on",
    "Modules completed (of 9)", ...FRAMES.map((f) => `${f.label} modules`),
    "Flights", "Crashes", "Last active",
  ]);
  for (const r of rows_ ?? []) {
    rows.push([
      r.full_name || "(not set)",
      r.school_name ?? "",
      r.join_code ?? "",
      r.class_code ?? "",
      r.student_status ?? "approved",
      when(r.joined_at),
      when(r.decided_at),
      r.modules_completed ?? 0,
      ...FRAMES.map((f) => r.per_frame?.[f.id]?.modules ?? 0),
      r.total_flights ?? 0,
      r.total_crashes ?? 0,
      when(r.last_active),
    ]);
  }
  return toCsv(rows);
}
