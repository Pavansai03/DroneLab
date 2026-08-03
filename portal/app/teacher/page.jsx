"use client";

import { useEffect, useState } from "react";
import Shell from "../../components/Shell.jsx";
import { api } from "../../lib/api.js";
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
  const [sort, setSort] = useState("name");

  useEffect(() => {
    api.teacher.roster().then(setData).catch((e) => setError(e.message));
    api.teacher
      .school()
      .then((r) => setSchool(r.school))
      .catch(() => {});
  }, []);

  if (error) return <div className="note bad">{error}</div>;
  if (!data) return <Loader label="Loading your class" />;

  const week = Date.now() - 7 * 864e5;
  const rows = [...data.roster].sort((a, b) => {
    if (sort === "progress") return (b.modules_completed ?? 0) - (a.modules_completed ?? 0);
    if (sort === "active") return Date.parse(b.last_active ?? 0) - Date.parse(a.last_active ?? 0);
    return (a.full_name ?? "").localeCompare(b.full_name ?? "");
  });

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
      </section>

      <div className="grid cols-4">
        <Stat icon={<Icon.Users />} value={data.summary.students} label="Students" />
        <Stat icon={<Icon.Bolt />} value={data.summary.activeThisWeek} label="Active this week" />
        <Stat icon={<Icon.Chart />} value={data.summary.averageModules} label="Avg modules done" />
        <Stat
          icon={<Icon.Shield />}
          value={data.summary.needHelp}
          label="May need help"
          tone={data.summary.needHelp ? "warn" : null}
        />
      </div>

      <div className="row" style={{ margin: "26px 0 12px", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Class roster</h2>
        <div className="row">
          <label style={{ margin: 0 }}>Sort</label>
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 160 }}>
            <option value="name">Name</option>
            <option value="progress">Modules complete</option>
            <option value="active">Last active</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="note">
          Nobody has joined yet. Give your students the join code above; it goes in their profile page.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th>Modules</th>
                <th>Flights</th>
                <th>Last active</th>
                <th>Working on</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const stale = !r.last_active || Date.parse(r.last_active) < week;
                return (
                  <tr key={r.user_id}>
                    <td>{r.full_name || <em style={{ color: "var(--dim)" }}>no name set</em>}</td>
                    <td className="mono" style={{ color: "var(--dim)" }}>
                      {r.class_code || "—"}
                    </td>
                    <td>
                      <span className={`pill ${r.modules_completed >= 3 ? "ok" : "muted"}`}>
                        {r.modules_completed ?? 0}/3
                      </span>
                    </td>
                    <td className="mono">{r.total_flights ?? 0}</td>
                    <td className="mono" style={{ color: stale ? "var(--warn)" : "var(--dim)" }}>
                      {r.last_active ? new Date(r.last_active).toLocaleDateString() : "never"}
                    </td>
                    <td style={{ color: "var(--dim)", fontSize: 12.5 }}>{r.stuck_on ?? "—"}</td>
                    <td>
                      <button className="btn small" onClick={() => setSelected(r.user_id)}>
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
