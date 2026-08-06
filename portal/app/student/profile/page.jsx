"use client";

import { useState } from "react";
import Shell from "../../../components/Shell.jsx";
import { api } from "../../../lib/api.js";
import { Icon } from "../../../components/DroneArt.jsx";

/**
 * THE PROFILE PAGE
 * ================
 * One card, centred: who you are, and which school you belong to.
 *
 * School membership used to sit in a second card beside this one, which put the
 * join code — the thing a student is most often asked to read back — in a
 * different column from their own name. It is one identity, so it is one card,
 * and the code is set large enough to read off a screen from across a desk.
 */
export default function ProfilePage() {
  return <Shell>{(me) => <Profile me={me} />}</Shell>;
}

function Profile({ me }) {
  const [fullName, setFullName] = useState(me.profile?.full_name ?? "");
  const [classCode, setClassCode] = useState(me.profile?.class_code ?? "");
  const [joinCode, setJoinCode] = useState("");
  const [school, setSchool] = useState(me.school);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

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
    <div className="profile-wrap">
      <h1>Profile</h1>
      <p className="sub">Your account, and the school it belongs to.</p>

      {err && <div className="note bad" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="note ok" style={{ marginBottom: 16 }}>{msg}</div>}

      <form className="card profile-card" onSubmit={save}>
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

        {/* School and join code live here, with the rest of the student's
            identity, rather than in a separate panel. */}
        {school ? (
          <div className="school-block">
            <div className="school-row">
              <span className="school-ico">
                <Icon.School />
              </span>
              <div>
                <label style={{ margin: 0 }}>School</label>
                <strong>{school.name}</strong>
              </div>
            </div>
            {school.join_code && (
              <div className="school-row">
                <span className="school-ico">
                  <Icon.Shield />
                </span>
                <div>
                  <label style={{ margin: 0 }}>Join code</label>
                  <code className="code-chip big">{school.join_code}</code>
                </div>
              </div>
            )}
            <p className="school-note">
              Your school can see your name, your class, which modules you have finished and when you
              last practised. They cannot see your password, and nobody outside your school can see
              you at all.
            </p>
          </div>
        ) : (
          <div className="school-block">
            <label htmlFor="jc">Join code</label>
            <p className="school-note" style={{ margin: "0 0 12px" }}>
              You have not joined a school. Until you do, your progress is saved but no school can
              see it — and the simulator stays locked.
            </p>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input
                id="jc"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ABCD-2345"
                className="mono"
                style={{ letterSpacing: "0.1em" }}
              />
              <button
                type="button"
                className="btn primary"
                onClick={join}
                disabled={busy || !joinCode.trim()}
              >
                Join
              </button>
            </div>
          </div>
        )}

        <button className="btn primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
