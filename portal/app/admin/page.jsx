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
  const [tab, setTab] = useState("overview");
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

      {tab === "overview" && <Overview />}
      {tab === "schools" && <Schools />}
      {tab === "people" && <People />}
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
