"use client";

import { useEffect, useState } from "react";
import Shell from "../../../components/Shell.jsx";
import { api } from "../../../lib/api.js";

/**
 * THE PROFILE PAGE
 * ================
 * Name, class, school membership — the things a student owns about
 * themselves — plus a plain statement of what their teacher can see.
 *
 * That last part is deliberate. A student can be told their progress is
 * visible to staff in a privacy notice nobody reads, or they can be told it
 * on the page where they type their name in. The second is honest.
 */
export default function ProfilePage() {
  return <Shell>{(me) => <Profile me={me} />}</Shell>;
}

function Profile({ me }) {
  const [fullName, setFullName] = useState(me.profile?.full_name ?? "");
  const [classCode, setClassCode] = useState(me.profile?.class_code ?? "");
  const [joinCode, setJoinCode] = useState("");
  const [school, setSchool] = useState(me.school);
  const [progress, setProgress] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.progress().then(setProgress).catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.updateMe({ full_name: fullName, class_code: classCode });
      setMsg("Saved.");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function join(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { joined } = await api.joinSchool(joinCode);
      setSchool(joined);
      setJoinCode("");
      setMsg(`Joined ${joined.name}.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Profile</h1>
      <p className="sub">Your account, and what it is connected to.</p>

      {err && <div className="note bad" style={{ marginBottom: 14 }}>{err}</div>}
      {msg && <div className="note ok" style={{ marginBottom: 14 }}>{msg}</div>}

      <div className="grid cols-2">
        <form className="card" onSubmit={save}>
          <h2 style={{ marginTop: 0 }}>About you</h2>
          <div className="field">
            <label>Email</label>
            <input value={me.email} disabled />
          </div>
          <div className="field">
            <label htmlFor="fn">Full name</label>
            <input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cc">Class</label>
            <input
              id="cc"
              value={classCode}
              onChange={(e) => setClassCode(e.target.value)}
              placeholder="e.g. 9B"
            />
          </div>
          <button className="btn primary" disabled={busy}>
            Save
          </button>
        </form>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>School</h2>
          {school ? (
            <>
              <p className="sub" style={{ marginBottom: 10 }}>
                You are a member of <strong style={{ color: "var(--text)" }}>{school.name}</strong>.
              </p>
              <div className="note">
                Your teacher can see your name, your class, which modules you have finished and when you last
                practised. They cannot see your password, and nobody outside your school can see you at all.
              </div>
            </>
          ) : (
            <form onSubmit={join}>
              <p className="sub" style={{ marginBottom: 12 }}>
                You have not joined a school. Until you do, your progress is saved to your account but no
                teacher can see it.
              </p>
              <div className="field">
                <label htmlFor="jc">Join code</label>
                <input
                  id="jc"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ABCD-1234"
                />
              </div>
              <button className="btn primary" disabled={busy || !joinCode.trim()}>
                Join school
              </button>
            </form>
          )}
        </div>
      </div>

      <h2>Learning record</h2>
      {progress ? (
        <div className="table-wrap">
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
              {progress.modules.map((m) => (
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
                    {m.updatedAt ? new Date(m.updatedAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="sub">Loading…</p>
      )}
    </>
  );
}
