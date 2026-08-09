"use client";

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
export function studentReportCsv({ student, modules, activity, build, school }) {
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

  const done = (modules ?? []).filter((m) => m.completed).length;
  const total = (modules ?? []).length;
  rows.push(["Summary"]);
  rows.push(["Modules completed", `${done} of ${total}`]);
  rows.push(["Course progress", total ? `${Math.round((done / total) * 100)}%` : "0%"]);
  const totals = (activity ?? []).reduce(
    (a, d) => ({
      flights: a.flights + (d.flights ?? 0),
      crashes: a.crashes + (d.crashes ?? 0),
      seconds: a.seconds + (d.seconds ?? 0),
    }),
    { flights: 0, crashes: 0, seconds: 0 }
  );
  rows.push(["Flights flown", totals.flights]);
  rows.push(["Crashes", totals.crashes]);
  rows.push(["Time in the simulator", `${Math.round(totals.seconds / 60)} min`]);
  if (build?.frame_id) rows.push(["Current build", build.frame_id]);
  rows.push([]);

  rows.push(["Modules"]);
  rows.push(["#", "Module", "Status", "Tasks done", "Tasks total", "Current task", "Last worked on"]);
  for (const m of modules ?? []) {
    rows.push([
      m.number,
      m.title,
      m.completed ? "complete" : (m.tasksDone ?? 0) > 0 ? "in progress" : "not started",
      m.tasksDone ?? 0,
      m.tasksTotal ?? 0,
      m.currentTask ?? "",
      when(m.updatedAt),
    ]);
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
    rows.push(["Average modules completed", summary.averageModules ?? 0]);
    rows.push(["May need help", summary.needHelp ?? 0]);
    if (summary.asked !== undefined) rows.push(["Asked for help directly", summary.asked]);
    rows.push([]);
  }

  rows.push(["Students"]);
  rows.push([
    "Name", "Class", "Approval", "Joined", "Approved on",
    "Modules completed", "Flights", "Crashes", "Last active", "Working on", "Asked for help",
  ]);
  for (const r of roster ?? []) {
    rows.push([
      r.full_name || "(not set)",
      r.class_code || "",
      r.student_status || "approved",
      when(r.joined_at),
      when(r.decided_at),
      r.modules_completed ?? 0,
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
    "Applied", "Decided", "Students", "Modules completed", "Average progress", "Active",
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
    "Modules completed", "Flights", "Crashes", "Last active",
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
      r.total_flights ?? 0,
      r.total_crashes ?? 0,
      when(r.last_active),
    ]);
  }
  return toCsv(rows);
}
