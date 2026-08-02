"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, isConfigured } from "../../lib/supabase.js";

/**
 * Sign in and sign up on one screen.
 *
 * Sign-up collects a full name and an optional class join code, both of
 * which are written into the auth metadata. The database trigger from
 * schema.sql copies them into the profile, so a new student arrives with a
 * name already filled in rather than an anonymous UUID for a teacher to
 * decipher.
 */
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
      <main style={{ maxWidth: 560 }}>
        <h1>Portal not configured</h1>
        <div className="note bad">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in{" "}
          <code>portal/.env.local</code>, then restart the dev server. See{" "}
          <code>portal/.env.example</code>.
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
          options: {
            // Read by the handle_new_user() trigger to seed the profile
            data: { full_name: fullName, class_code: classCode },
          },
        });
        if (error) throw error;
        /* With email confirmation switched on, Supabase returns a user but
           no session. Saying "check your email" only when that is actually
           what happened avoids telling a confirmed user to go and wait for
           an email that will never arrive. */
        if (data.session) router.replace(next);
        else setNotice("Account created. Check your email to confirm it, then sign in.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, paddingTop: 70 }}>
      <div className="brand" style={{ fontSize: 20, marginBottom: 6 }}>
        DRONE<span>LAB</span>
      </div>
      <h1>{mode === "signin" ? "Sign in" : "Create an account"}</h1>
      <p className="sub">
        {mode === "signin"
          ? "Your progress follows you to any machine you sign in on."
          : "Students, teachers and administrators all start with an account. Roles are granted afterwards."}
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

        {error && <div className="note bad" style={{ marginBottom: 12 }}>{error}</div>}
        {notice && <div className="note ok" style={{ marginBottom: 12 }}>{notice}</div>}

        <button className="btn primary" style={{ width: "100%" }} disabled={busy}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="sub" style={{ marginTop: 16 }}>
        {mode === "signin" ? "No account yet? " : "Already have one? "}
        <button
          className="btn small"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
        >
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>
    </main>
  );
}

/**
 * useSearchParams() opts a route into client-side rendering, and Next
 * refuses to prerender the page unless the part that reads it sits behind a
 * Suspense boundary. The boundary is around the form rather than the whole
 * page so the branding still renders on the server.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main style={{ maxWidth: 420, paddingTop: 70 }}>
          <div className="brand" style={{ fontSize: 20, marginBottom: 6 }}>
            DRONE<span>LAB</span>
          </div>
          <p className="sub">Loading…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
