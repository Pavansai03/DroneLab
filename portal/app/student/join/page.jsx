"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "../../../components/Shell.jsx";
import { api } from "../../../lib/api.js";
import { HeroDrone, Icon } from "../../../components/DroneArt.jsx";

/**
 * THE JOIN GATE
 * =============
 * A student can sign in without a school. They cannot fly without one.
 *
 * That is the point of the gate: the join code is what proves this person is
 * actually at an approved school, and it is what puts their progress on that
 * school's dashboard. Skipping it would give anyone with an email address a
 * free simulator and give their school no way to see them.
 *
 * The screen is deliberately singular — one field, one action, and a plain
 * statement of what happens next. Anything else here is a distraction from the
 * only thing the student can usefully do.
 */
export default function JoinPage() {
  return <Shell>{(me) => <Join me={me} />}</Shell>;
}

function Join({ me }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [joined, setJoined] = useState(null);

  if (me.admitted) {
    return (
      <>
        <div className="note ok" style={{ marginBottom: 18 }}>
          You are already a member of <strong>{me.school?.name}</strong>.
        </div>
        <a className="btn primary" href="/student">Go to my learning</a>
      </>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { joined } = await api.joinSchool(code.trim().toUpperCase());
      setJoined(joined);
      /* On to the waiting room, not into the product. The code attaches them to
         a school; an administrator admits them. A moment on the confirmation
         first, because jumping instantly leaves it unclear whether the code was
         accepted or the page simply changed. */
      setTimeout(() => router.replace("/student/pending"), 1400);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (joined) {
    return (
      <div className="joincode-card rise" style={{ textAlign: "center" }}>
        <small>Welcome to</small>
        <b style={{ fontSize: 28 }}>{joined.name}</b>
        <p>The simulator is unlocked. Taking you to your learning…</p>
      </div>
    );
  }

  return (
    <>
      <section className="hero rise">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>One more step</h1>
            <p>
              Enter your school's <strong>join code</strong> to unlock the simulator. Your school
              has it — it looks like <span className="mono">ABCD-2345</span>.
            </p>
          </div>
          <div className="hero-art"><HeroDrone /></div>
        </div>
      </section>

      <div className="grid cols-2">
        <form className="card" onSubmit={submit}>
          <div className="field">
            <label htmlFor="jc">Join code</label>
            <input
              id="jc"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-2345"
              className="mono"
              style={{ fontSize: 20, letterSpacing: "0.14em", textAlign: "center" }}
              autoFocus
              required
            />
          </div>
          {error && <div className="note bad" style={{ marginBottom: 14 }}>{error}</div>}
          <button className="btn primary" style={{ width: "100%", justifyContent: "center" }}
                  disabled={busy || !code.trim()}>
            {busy ? "Checking…" : "Unlock the simulator"}
          </button>
        </form>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Why this is needed</h2>
          <div className="sub" style={{ margin: 0, lineHeight: 1.8 }}>
            <p style={{ margin: "0 0 12px" }}>
              The code confirms you are at a school that has been approved, and it is what puts your
              progress on your school's dashboard.
            </p>
            <p style={{ margin: 0 }}>
              Do not have one? Ask your school. If your school has not registered yet, they can do
              it from the sign-in page — it takes a minute and an administrator approves it.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
