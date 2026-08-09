"use client";

import { useState } from "react";
import { api } from "../lib/api.js";
import { Icon } from "./DroneArt.jsx";
import {
  download,
  slug,
  studentReportCsv,
  schoolReportCsv,
  schoolsReportCsv,
  studentsReportCsv,
} from "../lib/report.js";

/**
 * EXPORT BUTTONS
 * ==============
 * The same three reports are wanted from three different panels, by people
 * looking at the same underlying rows. Sharing the buttons rather than writing
 * one per panel is not only less code — it is the only way the administration's
 * export of a student and the school's export of that same student are
 * guaranteed to say the same thing.
 *
 * A per-student report fetches its detail on click rather than up front. A list
 * of two hundred students must not make two hundred requests on the chance that
 * someone exports one of them.
 */

function useExport(run) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  return {
    busy,
    err,
    go: async () => {
      setBusy(true);
      setErr(null);
      try {
        await run();
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    },
  };
}

function Btn({ busy, onClick, small, label, title }) {
  return (
    <button
      type="button"
      className={`btn ${small ? "small" : ""}`}
      onClick={onClick}
      disabled={busy}
      title={title || "Download a CSV report"}
    >
      <Icon.External />
      {busy ? "Preparing…" : label}
    </button>
  );
}

/* ------------------------------------------------------------ one student */
/**
 * `id` is enough for staff — the detail is fetched from the teacher route,
 * which an administrator may also call. A student exporting themselves has no
 * such route, so they pass their own already-loaded data as `data`.
 */
export function ExportStudent({ id, name, data, small = true, label = "Export report" }) {
  const { busy, err, go } = useExport(async () => {
    const detail = data ?? (await api.teacher.student(id));
    download(
      `dronelab-${slug(name || detail.student?.full_name)}-report.csv`,
      studentReportCsv(detail)
    );
  });

  return (
    <>
      <Btn busy={busy} onClick={go} small={small} label={label} />
      {err && <div className="note bad">{err}</div>}
    </>
  );
}

/* -------------------------------------------------------------- one school */
export function ExportSchool({ school, roster, summary, schoolId, small = false, label = "Export school report" }) {
  const { busy, err, go } = useExport(async () => {
    /* An administrator opening this from a list has the school row but not its
       roster, so fetch it. A school exporting itself already has both. */
    let rows = roster;
    let sum = summary;
    if (!rows) {
      const r = await api.teacher.roster(schoolId ?? school?.id);
      rows = r.roster;
      sum = r.summary;
    }
    download(
      `dronelab-${slug(school?.name)}-school-report.csv`,
      schoolReportCsv({ school, roster: rows, summary: sum })
    );
  });

  return (
    <>
      <Btn busy={busy} onClick={go} small={small} label={label} />
      {err && <div className="note bad">{err}</div>}
    </>
  );
}

/* ------------------------------------------------------------- whole lists */
export function ExportSchools({ schools, small = true }) {
  const { busy, go } = useExport(async () =>
    download("dronelab-all-schools.csv", schoolsReportCsv(schools))
  );
  return <Btn busy={busy} onClick={go} small={small} label="Export list" />;
}

export function ExportStudents({ rows, filename = "dronelab-all-students.csv", small = true }) {
  const { busy, go } = useExport(async () => download(filename, studentsReportCsv(rows)));
  return <Btn busy={busy} onClick={go} small={small} label="Export list" />;
}
