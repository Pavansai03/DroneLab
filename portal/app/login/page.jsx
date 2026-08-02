"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, isConfigured } from "../../lib/supabase.js";
import { HeroDrone, DroneBackdrop, Icon } from "../../components/DroneArt.jsx";

/**
 * Turn whatever Supabase threw into something a human can act on.
 *
 * supabase-js does not guarantee the shape of an auth error: sometimes
 * `message` is a string, sometimes the useful text is on `error_description`
 * or nested in the response body, and a self-hosted instance can surface a
 * bare 500. Rendering `err.message` alone once produced a red box containing
 * "{}", which is worse than no message at all — it tells the user something
 * failed and denies them any way to find out what.
 *
 * The three failures named outright are the ones a self-hosted deployment
 * actually hits, and none of them is the user's fault.
 */
function describeAuthError(err) {
  const raw =
    (typeof err?.message === "string" && err.message) ||
    err?.error_description ||
    err?.error ||
    err?.msg ||
    "";
  const text = typeof raw === "string" && raw.trim() && raw.trim() !== "{}" ? raw.trim() : "";

  if (/confirmation email|sending.*email|smtp/i.test(text)) {
    return (
      "The server could not send the confirmation email, so the account was not created. " +
      "An administrator needs to either configure SMTP, or turn on auto-confirm so accounts " +
      "work without email."
    );
  }
  if (/database error|saving new user/i.test(text)) {
    return (
      "The database rejected the new account. This usually means the setup SQL has not been " +
      "run on this Supabase instance."
    );
  }
  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return (
      "Could not reach the server. If it was working a moment ago, the address may have " +
      "switched between http and https — those are different origins to a browser."
    );
  }
  if (text) return text;

  const status = err?.status ?? err?.code;
  return status
    ? `Sign-in failed (error ${status}). Check the browser console for details.`
    : "Sign-in failed, and the server gave no reason. Check the browser console for details.";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [classCode, setClassCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  if (!isConfigured()) {
    return (
      <main style={{ maxWidth: 620 }}>
        <h1>Portal not configured</h1>
        <div className="note bad">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in{" "}
          <code>portal/.env.local</code>, then restart the dev server.
        </div>
      </main>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase().auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
      } else {
        const { data, error } = await supabase().auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName, class_code: classCode } },
        });
        if (error) throw error;
        /* With email confirmation on, Supabase returns a user but no session.
           Saying "check your email" only when that actually happened avoids
           telling a confirmed user to wait for mail that will never arrive. */
        if (data.session) router.replace(next);
        else setNotice("Account created. Check your email to confirm it, then sign in.");
      }
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DroneBackdrop dense />
      <div className="auth-wrap">
        {/* The showcase half. Hidden below 900px, where the form is all that
            matters and a decorative column would only push it off screen. */}
        <section className="auth-show">
          <div className="brand rise">
            <span className="mark">
              <Icon.Bolt />
            </span>
            DRONE<em>LAB</em>
          </div>

          <h2 className="rise d1">
            Build a drone.
            <br />
            Fly it. <em>Break it.</em>
            <br />
            Understand it.
          </h2>
          <p className="rise d2">
            A classroom simulator where the physics are real, the failures are real, and every
            component decision has a consequence you can hear and see. This portal is where the
            learning gets tracked.
          </p>

          <div className="features rise d2">
            <span className="feature">
              <Icon.Rocket /> Progress that follows you
            </span>
            <span className="feature">
              <Icon.School /> Class dashboards
            </span>
            <span className="feature">
              <Icon.Shield /> School-scoped privacy
            </span>
          </div>

          <div className="auth-art rise d3">
            <HeroDrone />
          </div>
        </section>

        {/* The form half. */}
        <section className="auth-form">
          <div className="auth-card rise d1">
            <h1 style={{ fontSize: 28 }}>{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
            <p className="sub">
              {mode === "signin"
                ? "Sign in to pick up where you left off."
                : "Students, teachers and administrators all start here. Roles are granted afterwards."}
            </p>

            <form onSubmit={submit} className="card">
              {mode === "signup" && (
                <div className="field">
                  <label htmlFor="name">Full name</label>
                  <input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
              )}
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              {mode === "signup" && (
                <div className="field">
                  <label htmlFor="class">Class code (optional)</label>
                  <input
                    id="class"
                    value={classCode}
                    onChange={(e) => setClassCode(e.target.value)}
                    placeholder="e.g. 9B"
                  />
                </div>
              )}

              {error && (
                <div className="note bad" style={{ marginBottom: 14 }}>
                  {error}
                </div>
              )}
              {notice && (
                <div className="note ok" style={{ marginBottom: 14 }}>
                  {notice}
                </div>
              )}

              <button
                className="btn primary"
                style={{ width: "100%", justifyContent: "center" }}
                disabled={busy}
              >
                {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>

            <div className="row" style={{ marginTop: 18, justifyContent: "center" }}>
              <span className="sub" style={{ margin: 0 }}>
                {mode === "signin" ? "No account yet?" : "Already have one?"}
              </span>
              <button
                className="btn small ghost"
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setError(null);
                  setNotice(null);
                }}
              >
                {mode === "signin" ? "Create one" : "Sign in"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

/**
 * useSearchParams() opts a route into client-side rendering, and Next refuses
 * to prerender the page unless the part reading it sits behind a Suspense
 * boundary.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main>
          <p className="sub">Loading…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
