"use client";

import { useEffect, useMemo, useState } from "react";
import Shell from "../../components/Shell.jsx";
import { api } from "../../lib/api.js";
import { ExportSchool, ExportSchools, ExportStudent, ExportStudents } from "../../components/Export.jsx";
import { HeroDrone, Icon, Loader } from "../../components/DroneArt.jsx";

/**
 * THE ADMINISTRATION PANEL
 * ========================
 * Two things happen here and nothing else: schools are approved, and the
 * platform is looked at.
 *
 * The overview is four numbers, and every one of them opens the list behind it.
 * That constraint is the design: a figure you cannot drill into is trivia — it
 * tells you something is true and gives you no way to act on it. Anything that
 * failed the test was removed rather than kept for decoration.
 *
 * Two panels went entirely:
 *
 *   * a separate Schools tab, which listed the same rows Approvals already
 *     owns. One list, one place.
 *   * a flights chart, which read `activity_log` — a table nothing has ever
 *     written to. It was guaranteed to render "no activity recorded" for ever,
 *     which is worse than absent: an empty chart reads as a broken feature
 *     rather than a missing one.
 */
export default function AdminPage() {
  return <Shell requireRole="admin">{() => <Panel />}</Shell>;
}

function Panel() {
  const [tab, setTab] = useState("approvals");
  const [pending, setPending] = useState(0);
  const [pendingStudents, setPendingStudents] = useState(0);

  return (
    <>
      <section className="hero rise">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>
              <em>Administration</em>
            </h1>
            <p>
              Approve schools and see the whole platform. Roles and schools can only be changed from
              here — neither is writable from a browser, which is what stops anyone promoting
              themselves.
            </p>
          </div>
          <div className="hero-art">
            <HeroDrone />
          </div>
        </div>
      </section>

      <div className="tabbar">
        {[
          ["approvals", "Approvals", pending + pendingStudents],
          ["overview", "Overview", 0],
        ].map(([id, label, badge]) => (
          <button
            key={id}
            className={`tab-btn ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
            {badge > 0 && <span className="tab-badge">{badge}</span>}
          </button>
        ))}
      </div>

      {tab === "approvals" && (
        <>
          <Approvals onPending={setPending} />
          <StudentApprovals onPending={setPendingStudents} />
        </>
      )}
      {tab === "overview" && <Overview />}
    </>
  );
}

/* ============================================================== overview */

const VIEWS = {
  schools: { label: "Total schools", icon: Icon.School },
  students: { label: "Total students", icon: Icon.Users },
  admins: { label: "Administrators", icon: Icon.Shield },
  active: { label: "Active this week", icon: Icon.Bolt },
};

function Overview() {
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.admin.stats().then(setStats).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="note bad">{err}</div>;
  if (!stats) return <Loader label="Loading the overview" />;

  const t = stats.totals;
  const tiles = [
    { key: "schools", value: t.schools },
    { key: "students", value: t.students },
    { key: "admins", value: t.admins },
    { key: "active", value: t.activeThisWeek },
  ];

  return (
    <>
      <div className="grid cols-4">
        {tiles.map(({ key, value }) => {
          const V = VIEWS[key];
          return (
            <button
              key={key}
              className={`stat clickable ${open === key ? "open" : ""}`}
              onClick={() => setOpen(open === key ? null : key)}
            >
              <i className="accentbar" />
              <div className="ico">
                <V.icon />
              </div>
              <b>{value}</b>
              <small>{V.label}</small>
              <span className="stat-cue">{open === key ? "Hide" : "View list"}</span>
            </button>
          );
        })}
      </div>

      {open === "schools" && <SchoolList />}
      {(open === "students" || open === "active") && <StudentList onlyActive={open === "active"} />}
      {open === "admins" && <AdminList />}

      {!open && (
        <div className="note" style={{ marginTop: 20 }}>
          Select any figure above to see the accounts behind it.
        </div>
      )}
    </>
  );
}

/** Shared search + filter bar, so every drill-down behaves the same way. */
function ListControls({ q, setQ, placeholder, filters }) {
  return (
    <div className="listbar">
      <div className="search">
        <Icon.Search />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
        {q && (
          <button className="clear" onClick={() => setQ("")} aria-label="Clear search">
            ×
          </button>
        )}
      </div>
      {filters}
    </div>
  );
}

function Empty({ children }) {
  return <div className="note">{children}</div>;
}

/* ------------------------------------------------------------- schools */

function SchoolList() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("approved");
  const [sort, setSort] = useState("name");
  const [err, setErr] = useState(null);

  const reload = () =>
    api.admin
      .schools()
      .then((r) => setRows(r.schools))
      .catch((e) => setErr(e.message));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows
      .filter((s) => (status === "all" ? true : s.status === status))
      /* Search matches the join code too. An administrator chasing a support
         question almost always has the code in front of them, not the name. */
      .filter((s) =>
        !needle
          ? true
          : [s.name, s.join_code, s.region, s.contact_email]
              .filter(Boolean)
              .some((v) => v.toLowerCase().includes(needle))
      )
      .sort((a, b) =>
        sort === "students"
          ? b.stats.students - a.stats.students
          : sort === "progress"
            ? b.stats.percent - a.stats.percent
            : a.name.localeCompare(b.name)
      );
  }, [rows, q, status, sort]);

  if (err) return <div className="note bad">{err}</div>;
  if (!rows) return <Loader label="Loading schools" size={64} />;

  return (
    <div className="drill rise">
      <h2>Schools</h2>
      <ListControls
        q={q}
        setQ={setQ}
        placeholder="Search by name, join code, region or email…"
        filters={
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
              <option value="all">All statuses</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="name">Sort: name</option>
              <option value="students">Sort: most students</option>
              <option value="progress">Sort: most progress</option>
            </select>
          </>
        }
      />

      {rows.length > 0 && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
          <ExportSchools schools={view} />
        </div>
      )}

      {view.length === 0 ? (
        <Empty>No schools match.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>Join code</th>
                <th>Students</th>
                <th>Active/wk</th>
                <th style={{ minWidth: 170 }}>Teaching progress</th>
                <th>Status</th>
                <th>Decided</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <div className="cell-sub">
                      {[s.region, s.contact_email].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td>
                    {s.join_code ? (
                      <code className="code-chip">{s.join_code}</code>
                    ) : (
                      <span className="cell-sub">not issued</span>
                    )}
                  </td>
                  <td className="mono">{s.stats.students}</td>
                  <td className="mono">{s.stats.active}</td>
                  <td>
                    <div className="bar" style={{ marginBottom: 5 }}>
                      <i style={{ width: `${s.stats.percent}%` }} />
                    </div>
                    <div className="cell-sub">
                      {s.stats.percent}% · {s.stats.modules} modules completed
                    </div>
                  </td>
                  <td>
                    <span
                      className={`pill ${
                        s.status === "approved" ? "ok" : s.status === "pending" ? "warn" : "bad"
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="cell-sub mono">
                    {s.decided_at ? (
                      new Date(s.decided_at).toLocaleString()
                    ) : (
                      <span title="Applied but not yet decided">—</span>
                    )}
                    {s.applied_at && (
                      <div className="cell-sub">applied {new Date(s.applied_at).toLocaleDateString()}</div>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                      <ExportSchool school={s} schoolId={s.id} small label="Export" />
                      <Decide school={s} onDone={reload} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ students */

function StudentList({ onlyActive }) {
  const [rows, setRows] = useState(null);
  const [schools, setSchools] = useState([]);
  const [q, setQ] = useState("");
  const [school, setSchool] = useState("");
  const [sort, setSort] = useState("recent");
  const [approval, setApproval] = useState("");
  const [err, setErr] = useState(null);

  const reload = () =>
    api.admin
      .users({ role: "student" })
      .then((r) => setRows(r.users))
      .catch((e) => setErr(e.message));

  useEffect(() => {
    reload();
    api.admin
      .schools()
      .then((r) => setSchools(r.schools))
      .catch(() => {});
  }, []);

  const week = Date.now() - 7 * 864e5;
  const view = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows
      .filter((u) => (onlyActive ? u.last_active && Date.parse(u.last_active) > week : true))
      .filter((u) => (school ? u.school_id === school : true))
      .filter((u) => (approval ? (u.student_status ?? "approved") === approval : true))
      .filter((u) =>
        !needle
          ? true
          : [u.full_name, u.school_name, u.join_code, u.class_code]
              .filter(Boolean)
              .some((v) => v.toLowerCase().includes(needle))
      )
      .sort((a, b) =>
        sort === "progress"
          ? (b.modules_completed ?? 0) - (a.modules_completed ?? 0)
          : sort === "name"
            ? (a.full_name ?? "").localeCompare(b.full_name ?? "")
            : Date.parse(b.last_active ?? 0) - Date.parse(a.last_active ?? 0)
      );
  }, [rows, q, school, sort, onlyActive, approval, week]);

  if (err) return <div className="note bad">{err}</div>;
  if (!rows) return <Loader label="Loading students" size={64} />;

  return (
    <div className="drill rise">
      <h2>{onlyActive ? "Students active this week" : "Students"}</h2>
      <ListControls
        q={q}
        setQ={setQ}
        placeholder="Search by name, school, join code or class…"
        filters={
          <>
            <select value={school} onChange={(e) => setSchool(e.target.value)}>
              <option value="">All schools</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select value={approval} onChange={(e) => setApproval(e.target.value)}>
              <option value="">Any approval</option>
              <option value="pending">Waiting</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">Sort: most recent</option>
              <option value="progress">Sort: most progress</option>
              <option value="name">Sort: name</option>
            </select>
          </>
        }
      />

      {rows.length > 0 && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
          <ExportStudents rows={view} />
        </div>
      )}

      {view.length === 0 ? (
        <Empty>
          {onlyActive ? "Nobody has been active in the last seven days." : "No students match."}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>School</th>
                <th>Join code</th>
                <th>Class</th>
                <th style={{ minWidth: 150 }}>Progress</th>
                <th>Last active</th>
                <th>Approval</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.map((u) => {
                const pct = Math.round(((u.modules_completed ?? 0) / 3) * 100);
                const stale = !u.last_active || Date.parse(u.last_active) < week;
                return (
                  <tr key={u.user_id}>
                    <td>
                      <strong>{u.full_name || <em className="cell-sub">no name set</em>}</strong>
                    </td>
                    <td>
                      {u.school_name ?? <span className="pill warn">not joined</span>}
                      {u.school_status && u.school_status !== "approved" && (
                        <div className="cell-sub">school {u.school_status}</div>
                      )}
                    </td>
                    <td>
                      {u.join_code ? (
                        <code className="code-chip">{u.join_code}</code>
                      ) : (
                        <span className="cell-sub">—</span>
                      )}
                    </td>
                    <td className="mono cell-sub">{u.class_code || "—"}</td>
                    <td>
                      <div className="bar" style={{ marginBottom: 5 }}>
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <div className="cell-sub">
                        {u.modules_completed ?? 0}/3 modules · {pct}%
                      </div>
                    </td>
                    <td className="mono cell-sub" style={{ color: stale ? "var(--warn)" : undefined }}>
                      {u.last_active ? new Date(u.last_active).toLocaleDateString() : "never"}
                    </td>
                    <td>
                      <StatusPill value={u.student_status} />
                      <div className="cell-sub mono">
                        {u.decided_at
                          ? new Date(u.decided_at).toLocaleString()
                          : u.joined_at
                            ? `joined ${new Date(u.joined_at).toLocaleDateString()}`
                            : "—"}
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                        <ExportStudent id={u.user_id} name={u.full_name} label="Export" />
                        <DecideStudent row={u} onDone={reload} />
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

/* -------------------------------------------------------------- admins */

function AdminList() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.admin
      .users({ role: "admin" })
      .then((r) => setRows(r.users))
      .catch((e) => setErr(e.message));
  }, []);

  const view = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter((u) =>
      !needle ? true : (u.full_name ?? "").toLowerCase().includes(needle)
    );
  }, [rows, q]);

  if (err) return <div className="note bad">{err}</div>;
  if (!rows) return <Loader label="Loading administrators" size={64} />;

  return (
    <div className="drill rise">
      <h2>Administrators</h2>
      <ListControls q={q} setQ={setQ} placeholder="Search by name…" />

      <div className="note" style={{ marginBottom: 14 }}>
        Administrators see every school and every account, and are the only accounts that can approve
        a school or grant a role. Add one under <strong>People</strong> by changing an existing
        account&apos;s role.
      </div>

      {view.length === 0 ? (
        <Empty>No administrators match.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>School</th>
                <th>Account created</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {view.map((u) => (
                <tr key={u.user_id}>
                  <td>
                    <strong>{u.full_name || <em className="cell-sub">no name set</em>}</strong>{" "}
                    <span className="pill info">admin</span>
                  </td>
                  <td className="cell-sub">{u.school_name ?? "platform-wide"}</td>
                  <td className="mono cell-sub">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="mono cell-sub">
                    {u.last_active ? new Date(u.last_active).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ============================================================= approvals */

/**
 * The approval queue.
 *
 * Pending first and oldest first, because this is a queue to be worked through
 * rather than a list to be browsed — a school waiting three days should not sit
 * below one that applied this morning.
 *
 * Approving mints the join code and emails it. The result of that email is
 * REPORTED rather than assumed: with no SMTP configured, the code is shown here
 * so it can be passed on by hand. An approval that silently produced a code
 * nobody received would look like success and leave a school stuck.
 */
function Approvals({ onPending }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState("");
  const [subscriptionStarts, setSubscriptionStarts] = useState({});
  const [subscriptionEnds, setSubscriptionEnds] = useState({});

  const load = () =>
    api.admin
      .applications()
      .then((d) => {
        setData(d);
        onPending?.(d.applications.filter((a) => a.status === "pending").length);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(a, kind) {
    setBusy(a.id);
    setErr(null);
    try {
      if (kind === "approve") {
        const body = {
          subscription_starts_at: subscriptionStarts[a.id] || null,
          subscription_ends_at: subscriptionEnds[a.id] || null,
        };
        const r = await api.admin.approve(a.id, body);
        setResult({ kind: "approved", school: r.school, mail: r.mail });
      } else {
        const r = await api.admin.reject(a.id, note);
        setResult({ kind: "rejected", name: a.name, mail: r.mail });
        setRejecting(null);
        setNote("");
      }
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (err) return <div className="note bad">{err}</div>;
  if (!data) return <Loader label="Loading applications" />;

  const pending = data.applications.filter((a) => a.status === "pending");
  const decided = data.applications.filter((a) => a.status !== "pending").reverse();

  return (
    <>
      {result && (
        <div className={`note ${result.kind === "approved" ? "ok" : ""}`} style={{ marginBottom: 18 }}>
          {result.kind === "approved" ? (
            <>
              <strong>{result.school.name} approved.</strong> Join code{" "}
              <code className="code-chip">{result.school.join_code}</code>{" "}
              {result.mail?.sent
                ? `— emailed to ${result.school.contact_email}.`
                : `— the email did NOT go out (${result.mail?.reason}), so pass this code on yourself.`}
            </>
          ) : (
            <>
              <strong>{result.name} rejected.</strong>{" "}
              {result.mail?.sent ? "The school has been told." : `No email was sent (${result.mail?.reason}).`}
            </>
          )}
        </div>
      )}

      {!data.mailConfigured && (
        <div className="note" style={{ marginBottom: 18 }}>
          SMTP is not configured, so approval emails cannot be sent. Approving still works and the
          join code is shown here — you will need to pass it on yourself.
        </div>
      )}

      {/* Named to match the students queue below it. "Waiting for a decision"
          described the queue without saying whose, which read as ambiguous the
          moment a second queue appeared underneath. */}
      <h2 style={{ marginTop: 0 }}>
        Schools waiting to join{" "}
        {pending.length > 0 && <span className="pill warn">{pending.length}</span>}
      </h2>

      {pending.length === 0 ? (
        <Empty>Nothing waiting. New school registrations appear here.</Empty>
      ) : (
        <div className="grid cols-2">
          {pending.map((a) => (
            <div className="card hover" key={a.id}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <strong style={{ fontSize: 16 }}>{a.name}</strong>
                <span className="pill warn">pending</span>
              </div>
              <div className="cell-sub" style={{ lineHeight: 1.9, marginBottom: 14 }}>
                <div>{a.contact_email}</div>
                {a.phone && <div className="mono">{a.phone}</div>}
                {a.region && <div>{a.region}</div>}
                <div>Applied {new Date(a.applied_at).toLocaleString()}</div>
              </div>

              {rejecting === a.id ? (
                <>
                  <div className="field">
                    <label htmlFor={`n${a.id}`}>Reason (sent to the school)</label>
                    <input
                      id={`n${a.id}`}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="row">
                    <button className="btn danger" disabled={busy === a.id} onClick={() => decide(a, "reject")}>
                      Confirm rejection
                    </button>
                    <button className="btn ghost" onClick={() => setRejecting(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="field" style={{ marginBottom: 10 }}>
                    <label htmlFor={`ss${a.id}`}>Subscription start</label>
                    <input
                      id={`ss${a.id}`}
                      type="datetime-local"
                      value={subscriptionStarts[a.id] ?? ""}
                      onChange={(e) =>
                        setSubscriptionStarts((prev) => ({ ...prev, [a.id]: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 10 }}>
                    <label htmlFor={`se${a.id}`}>Subscription end</label>
                    <input
                      id={`se${a.id}`}
                      type="datetime-local"
                      value={subscriptionEnds[a.id] ?? ""}
                      onChange={(e) =>
                        setSubscriptionEnds((prev) => ({ ...prev, [a.id]: e.target.value }))
                      }
                    />
                  </div>
                  <div className="row">
                    <button className="btn primary" disabled={busy === a.id} onClick={() => decide(a, "approve")}>
                      {busy === a.id ? "Approving…" : "Approve & send code"}
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setRejecting(a.id);
                        setNote("");
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <h2>Decided</h2>
      {decided.length === 0 ? (
        <Empty>No decisions yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Join code</th>
                <th>Members</th>
                <th>Starts</th>
                <th>Ends</th>
                <th>Decided</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.name}</strong>
                  </td>
                  <td className="cell-sub">{a.contact_email}</td>
                  <td>
                    <span className={`pill ${a.status === "approved" ? "ok" : "bad"}`}>{a.status}</span>
                  </td>
                  <td>
                    {a.join_code ? <code className="code-chip">{a.join_code}</code> : <span className="cell-sub">—</span>}
                  </td>
                  <td className="mono">{a.member_count ?? 0}</td>
                  <td className="mono cell-sub">
                    {a.subscription_starts_at ? new Date(a.subscription_starts_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="mono cell-sub">
                    {a.subscription_ends_at ? new Date(a.subscription_ends_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="mono cell-sub">
                    {a.decided_at ? new Date(a.decided_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ================================================================ people */

function People() {
  const [users, setUsers] = useState(null);
  const [schools, setSchools] = useState([]);
  const [err, setErr] = useState(null);
  const [filterRole, setFilterRole] = useState("");
  const [q, setQ] = useState("");

  const load = () =>
    api.admin
      .users(filterRole ? { role: filterRole } : {})
      .then((r) => setUsers(r.users))
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterRole]);
  useEffect(() => {
    api.admin
      .schools()
      .then((r) => setSchools(r.schools))
      .catch(() => {});
  }, []);

  async function setRole(u, role) {
    setErr(null);
    try {
      await api.admin.setRole(u.user_id, role);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function setSchool(u, school_id) {
    setErr(null);
    try {
      await api.admin.setSchool(u.user_id, school_id || null);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  const rows = (users ?? []).filter((u) =>
    q ? (u.full_name ?? "").toLowerCase().includes(q.toLowerCase()) : true
  );

  return (
    <>
      {err && <div className="note bad" style={{ marginBottom: 14 }}>{err}</div>}

      <ListControls
        q={q}
        setQ={setQ}
        placeholder="Search by name…"
        filters={
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
            <option value="">All roles</option>
            <option value="student">Students</option>
            <option value="school">Schools</option>
            <option value="admin">Administrators</option>
          </select>
        }
      />

      {!users ? (
        <Loader label="Loading accounts" size={64} />
      ) : rows.length === 0 ? (
        <Empty>No accounts match.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>School</th>
                <th>Role</th>
                <th>Modules</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.user_id}>
                  <td>{u.full_name || <em className="cell-sub">no name set</em>}</td>
                  <td>
                    <select
                      value={u.school_id ?? ""}
                      onChange={(e) => setSchool(u, e.target.value)}
                      style={{ maxWidth: 210 }}
                    >
                      <option value="">— none —</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={u.role === "teacher" ? "school" : u.role}
                      onChange={(e) => setRole(u, e.target.value)}
                      style={{ maxWidth: 150 }}
                    >
                      <option value="student">student</option>
                      <option value="school">school</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="mono">{u.modules_completed ?? 0}</td>
                  <td className="mono cell-sub">
                    {u.last_active ? new Date(u.last_active).toLocaleDateString() : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="sub" style={{ marginTop: 12, fontSize: 12.5 }}>
        Role changes take effect on the account&apos;s next request. You cannot remove your own admin
        role — ask another administrator.
      </p>
    </>
  );
}

/* ==================================================== approval controls */

function StatusPill({ value }) {
  const v = value ?? "approved";
  return (
    <span className={`pill ${v === "approved" ? "ok" : v === "pending" ? "warn" : "bad"}`}>
      {v === "pending" ? "waiting" : v}
    </span>
  );
}

/**
 * Revoke or restore a school, from the list rather than the queue.
 *
 * A decision that can only be made once is not a decision, it is a trapdoor. A
 * school closes, a trial ends, an application turns out to have been made by
 * someone who did not have the authority — all of those happen after approval,
 * and the only remedy without this was deleting the school and everything its
 * students had done.
 */
function Decide({ school, onDone }) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState(null);

  async function run(kind) {
    setBusy(true);
    setErr(null);
    try {
      if (kind === "approve") await api.admin.approve(school.id);
      else await api.admin.reject(school.id, note || null);
      setAsking(false);
      setNote("");
      await onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (school.status === "pending") {
    return <span className="cell-sub">in the queue</span>;
  }

  if (asking) {
    return (
      <div style={{ minWidth: 210 }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (emailed to the school)"
          style={{ marginBottom: 6 }}
        />
        <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
          <button className="btn small" onClick={() => setAsking(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn small danger" onClick={() => run("reject")} disabled={busy}>
            {busy ? "Working…" : "Revoke access"}
          </button>
        </div>
        {err && <div className="note bad">{err}</div>}
      </div>
    );
  }

  return (
    <>
      {school.status === "approved" ? (
        <button className="btn small" onClick={() => setAsking(true)} disabled={busy}
                title="Withdraw this school's approval. Its students lose access immediately.">
          Revoke
        </button>
      ) : (
        <button className="btn small" onClick={() => run("approve")} disabled={busy}
                title="Approve this school again. A new join code is issued.">
          {busy ? "Working…" : "Re-approve"}
        </button>
      )}
      {err && <div className="note bad">{err}</div>}
    </>
  );
}

/** The same, for one student. */
function DecideStudent({ row, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const status = row.student_status ?? "approved";

  async function run(decision) {
    setBusy(true);
    setErr(null);
    try {
      await api.admin.studentDecision(row.user_id, decision, null);
      await onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!row.school_id) return <span className="cell-sub">no school</span>;

  return (
    <>
      {status === "approved" ? (
        <button className="btn small" onClick={() => run("rejected")} disabled={busy}
                title="Withdraw this student's access. Their work is kept.">
          {busy ? "…" : "Revoke"}
        </button>
      ) : (
        <button className="btn small primary" onClick={() => run("approved")} disabled={busy}>
          {busy ? "…" : "Approve"}
        </button>
      )}
      {err && <div className="note bad">{err}</div>}
    </>
  );
}

/**
 * STUDENTS WAITING
 * ================
 * The second queue on the approvals tab. It sits below the schools rather than
 * beside them because the order matters: a school has to exist before its
 * students can be let into it, and approving students for a school that is
 * still pending would be putting them behind a door that is not there yet.
 */
function StudentApprovals({ onPending }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState("");

  const load = () =>
    api.admin
      .students({ status: "pending" })
      .then((r) => {
        setRows(r.students);
        onPending?.(r.students.length);
        setErr(null);
      })
      .catch((e) => {
        /* Before student-approval.sql has run, the column this queue filters on
           does not exist and the request fails. That is a setup step outstanding,
           not a fault — so say which one, rather than showing a database error
           to someone who cannot act on it. */
        setRows([]);
        onPending?.(0);
        setErr(
          /student_status|column|schema/i.test(e.message)
            ? "Student approvals are not switched on yet — run supabase/student-approval.sql."
            : e.message
        );
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(row, decision) {
    setBusy(row.user_id);
    setErr(null);
    try {
      await api.admin.studentDecision(row.user_id, decision, decision === "rejected" ? note || null : null);
      setRejecting(null);
      setNote("");
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (!rows) return null;
  if (err) {
    return (
      <>
        <h2>Students waiting to join</h2>
        <div className="note">{err}</div>
      </>
    );
  }

  return (
    <>
      <h2>
        Students waiting to join{" "}
        {rows.length > 0 && <span className="pill warn">{rows.length}</span>}
      </h2>

      {rows.length === 0 ? (
        <Empty>
          No students waiting. A student appears here the moment they enter a valid join code — the
          code attaches them to a school, it does not admit them.
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>School</th>
                <th>Class</th>
                <th>Requested</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td>
                    <strong>{r.full_name || <em className="cell-sub">no name set</em>}</strong>
                  </td>
                  <td>
                    {r.school_name}
                    {r.school_status !== "approved" && (
                      <div className="cell-sub">school {r.school_status}</div>
                    )}
                  </td>
                  <td className="mono cell-sub">{r.class_code || "—"}</td>
                  <td className="mono cell-sub">
                    {r.joined_at ? new Date(r.joined_at).toLocaleString() : "—"}
                  </td>
                  <td>
                    {rejecting === r.user_id ? (
                      <div style={{ minWidth: 220 }}>
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Reason shown to the student"
                          style={{ marginBottom: 6 }}
                        />
                        <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                          <button className="btn small" onClick={() => setRejecting(null)}>
                            Cancel
                          </button>
                          <button
                            className="btn small danger"
                            disabled={busy === r.user_id}
                            onClick={() => decide(r, "rejected")}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                        <button className="btn small" onClick={() => setRejecting(r.user_id)}>
                          Reject
                        </button>
                        <button
                          className="btn small primary"
                          disabled={busy === r.user_id}
                          onClick={() => decide(r, "approved")}
                        >
                          {busy === r.user_id ? "Working…" : "Approve"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
