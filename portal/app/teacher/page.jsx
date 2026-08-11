"use client";

import { useEffect, useMemo, useState } from "react";
import Shell from "../../components/Shell.jsx";
import { api } from "../../lib/api.js";
import { ExportSchool, ExportStudent, ExportStudents } from "../../components/Export.jsx";
import { HeroDrone, Icon, Loader } from "../../components/DroneArt.jsx";

/**
 * THE TEACHER / SCHOOL PANEL
 * ==========================
 * Built around the question a teacher actually has at the start of a
 * lesson: who is stuck?
 *
 * "Stuck" is defined as having started something and not been seen for a
 * week — not as being behind. A class works at different speeds by design,
 * and a dashboard that flags the slowest third as a problem every week
 * trains its user to ignore it.
 *
 * The roster is scoped to the teacher's own school by Row Level Security in
 * the database, not by anything on this page.
 */
export default function TeacherPage() {
  return <Shell requireRole="teacher">{(me) => <Panel me={me} />}</Shell>;
}

function Panel({ me }) {
  const [data, setData] = useState(null);
  const [school, setSchool] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState("all");
  const [help, setHelp] = useState([]);

  const loadHelp = () =>
    api.teacher
      .help()
      .then((r) => setHelp(r.requests ?? []))
      .catch(() => setHelp([]));

  useEffect(() => {
    api.teacher.roster().then(setData).catch((e) => setError(e.message));
    api.teacher
      .school()
      .then((r) => setSchool(r.school))
      .catch(() => {});
    loadHelp();
  }, []);

  if (error) return <div className="note bad">{error}</div>;
  if (!data) return <Loader label="Loading your class" />;

  const openAsks = help.filter((r) => r.status === "open");

  return (
    <>
      <section className="hero rise">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>{school?.name ?? "My school"}</h1>
            <p>
              {school?.join_code ? (
                <>
                  Students join with the code{" "}
                  <strong
                    className="mono"
                    style={{ color: "var(--accent)", fontSize: 17, letterSpacing: "0.06em" }}
                  >
                    {school.join_code}
                  </strong>
                  {me.role === "admin" ? " — you are viewing this as an administrator." : "."}
                </>
              ) : (
                "Class overview."
              )}
            </p>
          </div>
          <div className="hero-art">
            <HeroDrone />
          </div>
        </div>
        {/* The school's own report and its licence, where the school's own
            details are. A school should not have to ask an administrator when
            its subscription runs out. */}
        <div className="row" style={{ marginTop: 6, alignItems: "center", gap: 14 }}>
          <ExportSchool school={school} roster={data.roster} summary={data.summary} />
          <SubscriptionBadge endsAt={school?.subscription_ends_at} />
        </div>
      </section>

      {/* Every figure opens the list behind it, exactly as the administration
          overview does. A count with no way to ask "which ones?" is trivia —
          and a teacher's first question is always which ones. */}
      <div className="grid cols-4">
        <StatTile k="all" open={open} setOpen={setOpen} icon={<Icon.Users />}
                  value={data.summary.students} label="Students" />
        <StatTile k="active" open={open} setOpen={setOpen} icon={<Icon.Bolt />}
                  value={data.summary.activeThisWeek} label="Active this week" />
        <StatTile k="progress" open={open} setOpen={setOpen} icon={<Icon.Chart />}
                  value={data.summary.averageModules} label="Avg modules done" />
        <StatTile k="help" open={open} setOpen={setOpen} icon={<Icon.Shield />}
                  value={data.summary.needHelp} label="May need help"
                  note={openAsks.length ? `${openAsks.length} asked directly` : null}
                  tone={data.summary.needHelp ? "warn" : null} />
      </div>

      {/* What students actually said comes before what the system inferred.
          An unanswered question is the most actionable thing on this page. */}
      {open === "help" && <HelpQueue requests={help} onChange={loadHelp} />}

      <Roster rows={data.roster} view={open} onSelect={setSelected} />

      {selected && <StudentDetail id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function StudentDetail({ id, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setD(null);
    api.teacher.student(id).then(setD).catch((e) => setErr(e.message));
  }, [id]);

  return (
    <>
      <h2>Student detail</h2>
      <div className="card">
        {err && <div className="note bad">{err}</div>}
        {!d && !err && <Loader size={64} />}
        {d && (
          <>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <strong style={{ fontSize: 16 }}>{d.student.full_name || "Unnamed student"}</strong>
                <div className="sub" style={{ margin: "4px 0 0" }}>
                  {d.student.class_code ? `Class ${d.student.class_code} · ` : ""}
                  {d.student.total_flights ?? 0} flights, {d.student.total_crashes ?? 0} crashes
                  {d.build?.frame_id ? ` · building a ${d.build.frame_id}` : ""}
                </div>
              </div>
              <button className="btn small" onClick={onClose}>
                Close
              </button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Status</th>
                  <th>Tasks</th>
                  <th>Last worked on</th>
                </tr>
              </thead>
              <tbody>
                {d.modules.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.number}. {m.title}
                    </td>
                    <td>
                      <span className={`pill ${m.completed ? "ok" : m.tasksDone ? "warn" : "muted"}`}>
                        {m.completed ? "complete" : m.tasksDone ? "in progress" : "not started"}
                      </span>
                    </td>
                    <td className="mono">
                      {m.tasksDone}/{m.tasksTotal || "—"}
                    </td>
                    <td className="mono" style={{ color: "var(--dim)" }}>
                      {m.updatedAt ? new Date(m.updatedAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}

/**
 * A stat tile. The icon carries the meaning at a glance; the number carries it
 * on a second look. Both matter — a wall of bare numbers takes real effort to
 * scan, and a wall of icons says nothing.
 */
function Stat({ icon, value, label, tone }) {
  return (
    <div className="stat">
      <i className="accentbar" />
      <div className="ico">{icon}</div>
      <b style={tone ? { color: `var(--${tone})` } : undefined}>{value}</b>
      <small>{label}</small>
    </div>
  );
}

/** A figure that opens the list behind it. */
function StatTile({ k, open, setOpen, icon, value, label, tone, note }) {
  return (
    <button
      className={`stat clickable ${open === k ? "open" : ""}`}
      onClick={() => setOpen(open === k ? null : k)}
    >
      <i className="accentbar" />
      <div className="ico">{icon}</div>
      <b style={tone ? { color: `var(--${tone})` } : undefined}>{value}</b>
      <small>{label}</small>
      {note && <small className="stat-note">{note}</small>}
      <span className="stat-cue">{open === k ? "Hide" : "View list"}</span>
    </button>
  );
}

/**
 * WHAT STUDENTS ACTUALLY ASKED
 * ============================
 * The roster below can only infer difficulty from silence. This is the other
 * half: the students who said what is wrong, in their own words, from their own
 * panel. Answering one closes it on both sides.
 */
function HelpQueue({ requests, onChange }) {
  const [openOnly, setOpenOnly] = useState(true);
  const list = openOnly ? requests.filter((r) => r.status === "open") : requests;

  return (
    <div className="drill rise" style={{ marginBottom: 18 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Questions from students</h2>
        <button className="btn small" onClick={() => setOpenOnly((v) => !v)}>
          {openOnly ? "Show answered too" : "Show unanswered only"}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="note" style={{ marginTop: 14 }}>
          {openOnly
            ? "Nothing unanswered. Students can raise a question from their own panel whenever they get stuck — it lands here."
            : "No questions yet."}
        </div>
      ) : (
        <div className="help-queue">
          {list.map((r) => (
            <HelpItem key={r.id} r={r} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function HelpItem({ r, onChange }) {
  const [reply, setReply] = useState(r.reply ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function answer(status) {
    setBusy(true);
    setErr(null);
    try {
      await api.teacher.answerHelp(r.id, reply.trim() || null, status);
      await onChange();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className={`card help-item ${r.status}`}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <strong>{r.full_name || "Unnamed student"}</strong>
          <div className="sub" style={{ margin: "3px 0 0", fontSize: 12.5 }}>
            {r.class_code ? `Class ${r.class_code} · ` : ""}
            {r.module_id ? `${r.module_id} · ` : ""}
            {new Date(r.created_at).toLocaleDateString()}
          </div>
        </div>
        <span className={`pill ${r.status === "open" ? "warn" : "ok"}`}>
          {r.status === "open" ? "unanswered" : r.status}
        </span>
      </div>

      <p className="help-quote">{r.message}</p>

      {err && <div className="note bad">{err}</div>}

      {r.status === "open" ? (
        <>
          <textarea
            rows={2}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply — they will see it on their panel."
            maxLength={2000}
          />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn small" disabled={busy} onClick={() => answer("closed")}>
              Dealt with in person
            </button>
            <button
              className="btn primary small"
              disabled={busy || reply.trim().length === 0}
              onClick={() => answer("answered")}
            >
              {busy ? "Sending…" : "Send reply"}
            </button>
          </div>
        </>
      ) : (
        r.reply && <p className="help-answer">{r.reply}</p>
      )}
    </div>
  );
}

/**
 * The class roster, filtered by whichever figure is open.
 *
 * "May need help" is started-and-not-seen-for-a-week, not simply behind. A class
 * works at different speeds by design, and a list that flags the slowest third
 * every week trains its reader to ignore it.
 */
function Roster({ rows, view, onSelect }) {
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const [sort, setSort] = useState("name");

  const week = Date.now() - 7 * 864e5;
  const classes = useMemo(
    () => [...new Set(rows.map((r) => r.class_code).filter(Boolean))].sort(),
    [rows]
  );

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (view === "active") return r.last_active && Date.parse(r.last_active) > week;
        if (view === "help")
          return (
            (r.help_open ?? 0) > 0 ||
            (r.stuck_on && (!r.last_active || Date.parse(r.last_active) < week))
          );
        if (view === "progress") return (r.modules_completed ?? 0) > 0;
        return true;
      })
      .filter((r) => (cls ? r.class_code === cls : true))
      .filter((r) =>
        !needle
          ? true
          : [r.full_name, r.class_code, r.stuck_on, r.help_note]
              .filter(Boolean)
              .some((v) => v.toLowerCase().includes(needle))
      )
      .sort((a, b) =>
        sort === "progress"
          ? (b.modules_completed ?? 0) - (a.modules_completed ?? 0)
          : sort === "active"
            ? Date.parse(b.last_active ?? 0) - Date.parse(a.last_active ?? 0)
            : (a.full_name ?? "").localeCompare(b.full_name ?? "")
      );
  }, [rows, q, cls, sort, view, week]);

  if (!view) {
    return (
      <div className="note" style={{ marginTop: 20 }}>
        Select any figure above to see the students behind it.
      </div>
    );
  }

  const title = {
    all: "Class roster",
    active: "Active this week",
    progress: "Students who have completed a module",
    help: "May need help — asked, or gone quiet",
  }[view];

  return (
    <div className="drill rise">
      <h2>{title}</h2>

      <div className="listbar">
        <div className="search">
          <Icon.Search />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, class or task…" />
          {q && (
            <button className="clear" onClick={() => setQ("")} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
        {classes.length > 0 && (
          <select value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">Sort: name</option>
          <option value="progress">Sort: most progress</option>
          <option value="active">Sort: last active</option>
        </select>
      </div>

      {list.length > 0 && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
          <ExportStudents rows={list} filename="dronelab-class-report.csv" />
        </div>
      )}

      {list.length === 0 ? (
        <div className="note">
          {rows.length === 0
            ? "Nobody has joined yet. Give your students the join code above; it goes in their profile page."
            : "No students match."}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th style={{ minWidth: 150 }}>Progress</th>
                <th>Last active</th>
                <th>Approval</th>
                <th>Working on</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const pct = Math.round(((r.modules_completed ?? 0) / 3) * 100);
                const stale = !r.last_active || Date.parse(r.last_active) < week;
                return (
                  <tr key={r.user_id}>
                    <td>
                      <strong>{r.full_name || <em className="cell-sub">no name set</em>}</strong>
                    </td>
                    <td className="mono cell-sub">{r.class_code || "—"}</td>
                    <td>
                      <div className="bar" style={{ marginBottom: 5 }}>
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <div className="cell-sub">
                        {r.modules_completed ?? 0}/3 modules · {pct}%
                      </div>
                    </td>
                    <td className="mono cell-sub" style={{ color: stale ? "var(--warn)" : undefined }}>
                      {r.last_active ? new Date(r.last_active).toLocaleDateString() : "never"}
                    </td>
                    {/* A school cannot decide this, but it very much needs to
                        see it: "why can't Priya open the simulator" is answered
                        here rather than by a support email. */}
                    <td>
                      <span
                        className={`pill ${
                          (r.student_status ?? "approved") === "approved"
                            ? "ok"
                            : r.student_status === "pending"
                              ? "warn"
                              : "bad"
                        }`}
                      >
                        {r.student_status === "pending" ? "waiting" : r.student_status ?? "approved"}
                      </span>
                      {r.decided_at && (
                        <div className="cell-sub mono">
                          {new Date(r.decided_at).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="cell-sub">
                      {(r.help_open ?? 0) > 0 && (
                        <span className="pill warn" style={{ marginBottom: 5 }}>
                          asked for help
                        </span>
                      )}
                      <div>{r.help_note || r.stuck_on || "—"}</div>
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                        <button className="btn small" onClick={() => onSelect(r.user_id)}>
                          View
                        </button>
                        <ExportStudent id={r.user_id} name={r.full_name} label="Export" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * How long this school's subscription has left.
 *
 * Shown to the school itself, not only to administrators. A licence that lapses
 * without warning in the middle of a lesson is a bad afternoon for a teacher
 * who was never told it was close — and they are the person who can chase it.
 *
 * The end date counts THROUGH that day: an end date of the 11th is valid until
 * the end of the 11th, matching what the API enforces.
 */
function SubscriptionBadge({ endsAt }) {
  if (!endsAt) return null;

  const d = new Date(endsAt);
  const endOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999);
  const days = Math.ceil((endOfDay - Date.now()) / 86400000);
  const when = d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  if (days < 0) {
    return (
      <span className="cell-sub">
        <span className="pill bad">Subscription ended</span> {when}
      </span>
    );
  }
  return (
    <span className="cell-sub">
      <span className={`pill ${days <= 14 ? "warn" : "ok"}`}>
        {days === 0 ? "Subscription ends today" : `${days} day${days === 1 ? "" : "s"} of subscription left`}
      </span>{" "}
      until {when}
    </span>
  );
}
