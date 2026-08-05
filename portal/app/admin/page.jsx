"use client";

import { useEffect, useState } from "react";
import Shell from "../../components/Shell.jsx";
import { api } from "../../lib/api.js";
import { HeroDrone, Icon, Loader } from "../../components/DroneArt.jsx";

/**
 * THE SUPER ADMIN PANEL
 * =====================
 * The owner's view: every school, every account, and the two operations
 * that exist nowhere else in the product — creating a school and granting a
 * role.
 *
 * Those two are here rather than in the teacher panel for a structural
 * reason. `user_roles` and `schools` have no client-writable RLS policy at
 * all, so the only way to write them is through the service role key, which
 * lives on the Express server. That is what stops a student promoting
 * themselves to teacher by editing a request.
 */
export default function AdminPage() {
  return <Shell requireRole="admin">{() => <Panel />}</Shell>;
}

function Panel() {
  const [tab, setTab] = useState("approvals");
  return (
    <>
      <section className="hero rise">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>
              <em>Administration</em>
            </h1>
            <p>
              Every school and every account on this deployment. This is the only place roles are
              granted and schools are created — neither can be done from a browser without the
              server, which is what stops a student promoting themselves.
            </p>
          </div>
          <div className="hero-art">
            <HeroDrone />
          </div>
        </div>
      </section>

      <div className="row" style={{ marginBottom: 20 }}>
        {[
          ["approvals", "Approvals"],
          ["overview", "Overview"],
          ["schools", "Schools"],
          ["people", "People"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`btn small ${tab === id ? "primary" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "approvals" && <Approvals />}
      {tab === "overview" && <Overview />}
      {tab === "schools" && <Schools />}
      {tab === "people" && <People />}
    </>
  );
}

/* ------------------------------------------------------------ approvals */

/**
 * The approval queue.
 *
 * Pending applications come first and oldest first, because this is a queue to
 * be worked through rather than a list to be browsed — a school waiting three
 * days should not sit below one that applied this morning.
 *
 * Approving mints the join code and emails it. The result of that email is
 * REPORTED rather than assumed: if SMTP is unconfigured or the send failed, the
 * code is shown here so it can be passed on by hand. An approval that silently
 * produced a code nobody received would look like success and leave a school
 * stuck waiting for an email that never existed.
 */
function Approvals() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState("");

  const load = () => api.admin.applications().then(setData).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);

  async function approve(a) {
    setBusy(a.id);
    setErr(null);
    try {
      const r = await api.admin.approve(a.id);
      setResult({ kind: "approved", school: r.school, mail: r.mail });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function reject(a) {
    setBusy(a.id);
    setErr(null);
    try {
      const r = await api.admin.reject(a.id, note);
      setResult({ kind: "rejected", name: a.name, mail: r.mail });
      setRejecting(null);
      setNote("");
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
              <b className="mono" style={{ fontSize: 16 }}>
                {result.school.join_code}
              </b>
              .{" "}
              {result.mail?.sent
                ? `Emailed to ${result.school.contact_email}.`
                : `The email did NOT go out (${result.mail?.reason}) — pass this code on yourself.`}
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

      <h2 style={{ marginTop: 0 }}>
        Waiting for a decision {pending.length > 0 && <span className="pill warn">{pending.length}</span>}
      </h2>

      {pending.length === 0 ? (
        <div className="note">Nothing waiting. New school registrations appear here.</div>
      ) : (
        <div className="grid cols-2">
          {pending.map((a) => (
            <div className="card hover" key={a.id}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <strong style={{ fontSize: 16 }}>{a.name}</strong>
                <span className="pill warn">pending</span>
              </div>
              <div className="sub" style={{ margin: "0 0 14px", lineHeight: 1.8, fontSize: 13 }}>
                <div>{a.contact_email}</div>
                {a.phone && <div className="mono">{a.phone}</div>}
                {a.region && <div>{a.region}</div>}
                <div style={{ color: "var(--faint)" }}>
                  Applied {new Date(a.applied_at).toLocaleString()}
                </div>
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
                    <button className="btn danger" disabled={busy === a.id} onClick={() => reject(a)}>
                      Confirm rejection
                    </button>
                    <button className="btn ghost" onClick={() => setRejecting(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className="row">
                  <button className="btn primary" disabled={busy === a.id} onClick={() => approve(a)}>
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
              )}
            </div>
          ))}
        </div>
      )}

      <h2>Decided</h2>
      {decided.length === 0 ? (
        <div className="note">No decisions yet.</div>
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
                <th>Decided</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.name}</strong>
                  </td>
                  <td className="sub" style={{ margin: 0, fontSize: 12.5 }}>
                    {a.contact_email}
                  </td>
                  <td>
                    <span className={`pill ${a.status === "approved" ? "ok" : "bad"}`}>{a.status}</span>
                  </td>
                  <td className="mono" style={{ color: "var(--accent-2)" }}>
                    {a.join_code ?? "—"}
                  </td>
                  <td className="mono">{a.member_count ?? 0}</td>
                  <td className="mono" style={{ color: "var(--dim)" }}>
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

/* ------------------------------------------------------------- overview */

function Overview() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.admin.stats().then(setD).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="note bad">{err}</div>;
  if (!d) return <Loader />;

  const t = d.totals;
  const max = Math.max(...d.daily.map((x) => x.flights), 1);

  return (
    <>
      <div className="grid cols-4">
        <Stat icon={<Icon.School />} value={t.activeSchools} label="Active schools" />
        <Stat icon={<Icon.Users />} value={t.students} label="Students" />
        <Stat icon={<Icon.Users />} value={t.teachers} label="Teachers" />
        <Stat icon={<Icon.Bolt />} value={t.activeThisWeek} label="Active this week" />
        <Stat icon={<Icon.Chart />} value={t.modulesCompleted} label="Modules completed" />
        <Stat icon={<Icon.Shield />} value={t.admins} label="Administrators" />
        <Stat
          icon={<Icon.Rocket />}
          value={t.unassigned}
          label="Not in a school"
          tone={t.unassigned ? "warn" : null}
        />
        <Stat icon={<Icon.School />} value={t.schools} label="Schools total" />
      </div>

      <h2>Flights, last 14 days</h2>
      <div className="card">
        {d.daily.length ? (
          <>
            <div className="spark">
              {d.daily.map((x) => (
                <i
                  key={x.day}
                  style={{ height: `${Math.max(4, (x.flights / max) * 100)}%` }}
                  title={`${x.day}: ${x.flights} flights, ${x.crashes} crashes`}
                />
              ))}
            </div>
            <div className="sub" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
              {d.daily[0]?.day} to {d.daily[d.daily.length - 1]?.day}
            </div>
          </>
        ) : (
          <p className="sub" style={{ margin: 0 }}>
            No activity recorded yet.
          </p>
        )}
      </div>

      {t.unassigned > 0 && (
        <div className="note" style={{ marginTop: 18 }}>
          {t.unassigned} account{t.unassigned === 1 ? " is" : "s are"} not attached to a school. Their progress
          is saved but invisible to any teacher — assign them under <strong>People</strong>.
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------- schools */

function Schools() {
  const [schools, setSchools] = useState(null);
  const [err, setErr] = useState(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.admin
      .schools()
      .then((r) => setSchools(r.schools))
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.admin.createSchool({ name, region });
      setName("");
      setRegion("");
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s) {
    try {
      await api.admin.updateSchool(s.id, { active: !s.active });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      {err && <div className="note bad" style={{ marginBottom: 14 }}>{err}</div>}

      <form className="card" onSubmit={create} style={{ marginBottom: 22 }}>
        <h2 style={{ marginTop: 0 }}>Add a school</h2>
        <div className="grid cols-3">
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="sn">Name</label>
            <input id="sn" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="sr">Region (optional)</label>
            <input id="sr" value={region} onChange={(e) => setRegion(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0, display: "flex", alignItems: "flex-end" }}>
            <button className="btn primary" disabled={busy || !name.trim()}>
              Create
            </button>
          </div>
        </div>
        <p className="sub" style={{ margin: "12px 0 0", fontSize: 12.5 }}>
          A join code is generated automatically. Students type it into their profile to join.
        </p>
      </form>

      {!schools ? (
        <Loader />
      ) : schools.length === 0 ? (
        <div className="note">No schools yet. Create the first one above.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>School</th>
                <th>Join code</th>
                <th>Students</th>
                <th>Teachers</th>
                <th>Active/wk</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schools.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.region && (
                      <div style={{ color: "var(--dim)", fontSize: 12 }}>{s.region}</div>
                    )}
                  </td>
                  <td className="mono" style={{ color: "var(--accent)" }}>
                    {s.join_code}
                  </td>
                  <td className="mono">{s.stats.students}</td>
                  <td className="mono">{s.stats.teachers}</td>
                  <td className="mono">{s.stats.active}</td>
                  <td>
                    <span className={`pill ${s.active ? "ok" : "muted"}`}>
                      {s.active ? "active" : "paused"}
                    </span>
                  </td>
                  <td>
                    <button className="btn small" onClick={() => toggle(s)}>
                      {s.active ? "Pause" : "Resume"}
                    </button>
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

/* --------------------------------------------------------------- people */

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

      <div className="row" style={{ marginBottom: 14 }}>
        <input
          placeholder="Search by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">All roles</option>
          <option value="student">Students</option>
          <option value="teacher">Teachers</option>
          <option value="admin">Administrators</option>
        </select>
      </div>

      {!users ? (
        <Loader />
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
                  <td>{u.full_name || <em style={{ color: "var(--dim)" }}>no name set</em>}</td>
                  <td>
                    <select
                      value={u.school_id ?? ""}
                      onChange={(e) => setSchool(u, e.target.value)}
                      style={{ maxWidth: 200 }}
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
                      value={u.role}
                      onChange={(e) => setRole(u, e.target.value)}
                      style={{ maxWidth: 150 }}
                    >
                      <option value="student">student</option>
                      <option value="teacher">teacher</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="mono">{u.modules_completed ?? 0}</td>
                  <td className="mono" style={{ color: "var(--dim)" }}>
                    {u.last_active ? new Date(u.last_active).toLocaleDateString() : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="sub" style={{ marginTop: 12, fontSize: 12.5 }}>
        Role changes take effect on the user&apos;s next request. You cannot remove your own admin role — ask
        another administrator.
      </p>
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
