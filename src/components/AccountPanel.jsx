import React, { useState } from "react";
import { isSupabaseConfigured, supabaseConfigNote, buildEnvReport } from "../lib/supabase.js";
import { signIn, signUp, signOut } from "../lib/useCloudSync.js";
import { hasPortal, goToPortal } from "../lib/portal.js";

/**
 * Sign in / sign up, and the signed-in summary.
 *
 * When Supabase is not configured this panel explains that plainly rather than
 * showing a login form that could never work.
 */
export default function AccountPanel({ auth, syncStatus, syncError, onSignedIn }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [classCode, setClassCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  if (!isSupabaseConfigured) {
    return (
      <div>
        <div className="cat-row">Accounts unavailable</div>
        <div className="tip" style={{ borderColor: "var(--info-edge)", background: "var(--info-tint)", color: "var(--info-ink)" }}>
          {supabaseConfigNote}
        </div>
        <div className="sect-note">
          The simulator is fully usable like this — nothing is disabled. Progress
          simply is not saved between sessions.
          <br />
          <br />
          To switch it on, build with <b className="mono">VITE_SUPABASE_URL</b> and{" "}
          <b className="mono">VITE_SUPABASE_ANON_KEY</b> set as{" "}
          <b>build arguments</b> (not runtime variables — Vite bakes them into the
          bundle at build time).
        </div>

        {/* Exactly what the build received. Without this, "the variables are set
            but the app says they are not" is unfalsifiable from the outside —
            you cannot tell a wrong project from a stale build from a typo. */}
        <div className="cat-row" style={{ marginTop: 18 }}>
          VITE_ variables this build received
        </div>
        <div className="sect-note" style={{ marginBottom: 10 }}>
          {buildEnvReport.length === 0 ? (
            <>
              <b>None.</b> This bundle was compiled with no VITE_ variables at all. Either they were
              added to a different Vercel project, or this deployment was built before they were
              added — Vite bakes them in at build time, so a redeploy is required after any change.
            </>
          ) : (
            <>
              <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
                {buildEnvReport.map((v) => (
                  <li key={v.name} className="mono" style={{ fontSize: 11.5 }}>
                    {v.name} <span style={{ color: "var(--faint)" }}>({v.chars} chars)</span>
                  </li>
                ))}
              </ul>
              If a name here looks slightly wrong, that is the problem — Vite only exposes exact
              matches beginning <b className="mono">VITE_</b>.
            </>
          )}
        </div>

        {/* The Account tab is where a student looks for anything to do with their
            account, so when this simulator has no account layer of its own it
            should still point at the place that does, rather than being a dead
            end that only explains why it is empty. */}
        {hasPortal() && (
          <>
            <div className="cat-row" style={{ marginTop: 18 }}>Your account lives in the portal</div>
            <div className="sect-note" style={{ marginBottom: 12 }}>
              Sign in there to see your progress, your class and your profile.
            </div>
            <button className="btn go" style={{ width: "100%" }} onClick={goToPortal}>
              Open the portal
            </button>
          </>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------- signed in */
  if (auth.user) {
    const statusText = {
      idle: "Up to date",
      loading: "Loading your saved build...",
      saving: "Saving...",
      saved: "Saved to the cloud",
      error: "Save failed",
    }[syncStatus] || "";

    return (
      <div>
        <div className="cat-row">Signed in</div>
        <div style={{ padding: "10px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {auth.profile?.full_name || auth.user.email}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--dim)", marginTop: 3 }}>
            {auth.user.email}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <span className={`sev ${auth.isTeacher ? "nominal" : "warning"}`}>
              {auth.isTeacher ? "TEACHER" : "STUDENT"}
            </span>
            {auth.profile?.class_code && (
              <span className="opt-flag">CLASS {auth.profile.class_code}</span>
            )}
          </div>
        </div>

        <div className="check-row">
          <span
            className={`check-dot ${
              syncStatus === "error" ? "fail" : syncStatus === "saved" || syncStatus === "idle" ? "pass" : "opt"
            }`}
          />
          <div>
            <div className="check-label">{statusText}</div>
            {syncError && <div className="check-detail" style={{ color: "var(--bad)" }}>{syncError}</div>}
            {!syncError && (
              <div className="check-detail">
                Your build and module progress follow you to any machine.
              </div>
            )}
          </div>
        </div>

        {!auth.isTeacher && (
          <div className="sect-note">
            Teacher accounts are granted in Supabase Studio, not from here — a
            student cannot promote themselves.
          </div>
        )}

        <div style={{ padding: 10 }}>
          <button className="btn wide" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------ signed out */
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);

    const res =
      mode === "signin"
        ? await signIn(email, password)
        : await signUp(email, password, fullName, classCode);

    setBusy(false);
    if (res.error) {
      setMessage({ tone: "bad", text: res.error });
      return;
    }
    if (res.needsConfirmation) {
      setMessage({
        tone: "warn",
        text: "Account created. Check your email for the confirmation link before signing in.",
      });
      return;
    }
    onSignedIn?.();
  };

  return (
    <div>
      <div className="tabs">
        <button
          className={`tab ${mode === "signin" ? "active" : ""}`}
          onClick={() => { setMode("signin"); setMessage(null); }}
        >
          Sign in
        </button>
        <button
          className={`tab ${mode === "signup" ? "active" : ""}`}
          onClick={() => { setMode("signup"); setMessage(null); }}
        >
          Create account
        </button>
      </div>

      <form onSubmit={submit} style={{ padding: 12, display: "grid", gap: 9 }}>
        {mode === "signup" && (
          <>
            <label className="field">
              <span>Full name</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            </label>
            <label className="field">
              <span>Class code (optional)</span>
              <input value={classCode} onChange={(e) => setClassCode(e.target.value)} placeholder="e.g. 9B-DRONE" />
            </label>
          </>
        )}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        </label>

        <button className="btn primary wide" type="submit" disabled={busy}>
          {busy ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        {message && (
          <div
            className="tip"
            style={{
              margin: 0,
              borderColor: message.tone === "bad" ? "rgba(255,92,98,0.4)" : "rgba(255,171,74,0.35)",
              background: message.tone === "bad" ? "rgba(255,92,98,0.08)" : "rgba(255,171,74,0.08)",
              color: message.tone === "bad" ? "var(--bad-ink)" : "var(--warn-ink)",
            }}
          >
            {message.text}
          </div>
        )}
      </form>

      <div className="sect-note">
        Signing in saves your build and module progress so you can carry on from
        another machine. You can use the simulator without an account — nothing is
        locked behind it.
      </div>
    </div>
  );
}
