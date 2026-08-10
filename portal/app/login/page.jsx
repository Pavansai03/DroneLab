"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, isConfigured } from "../../lib/supabase.js";
import { api } from "../../lib/api.js";
import Brand from "../../components/Brand.jsx";
import { HeroDrone, DroneBackdrop, Icon, Loader } from "../../components/DroneArt.jsx";
import { useAuthProviders } from "../../lib/providers.js";

/**
 * Turn whatever Supabase threw into something a human can act on.
 *
 * supabase-js does not guarantee the shape of an auth error, and a self-hosted
 * instance can surface a bare 500. Rendering `err.message` alone once produced
 * a red box containing "{}" — worse than no message, because it says something
 * failed and denies any way to find out what.
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
      "An administrator needs to configure SMTP, or turn on auto-confirm."
    );
  }
  if (/database error|saving new user/i.test(text)) {
    return "The database rejected the new account. The setup SQL may not have been run on this instance.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (/already registered|already exists/i.test(text)) {
    return "An account already exists with that email. Sign in instead.";
  }
  if (text) return text;
  const status = err?.status ?? err?.code;
  return status ? `Sign-in failed (error ${status}).` : "Sign-in failed, and the server gave no reason.";
}

/* Who is signing in. The choice changes the form, not just a label — a school
   registers an organisation and waits for approval, a student joins one that
   already exists, and an administrator is created by another administrator. */
const ROLES = [
  {
    id: "student",
    label: "Student",
    blurb: "Learn to build and fly. You will need your school's join code.",
    icon: Icon.Rocket,
  },
  {
    id: "school",
    label: "School",
    blurb: "Register your school. An administrator reviews it before it goes live.",
    icon: Icon.School,
  },
  {
    id: "admin",
    label: "Administrator",
    blurb: "Approve schools and manage the platform.",
    icon: Icon.Shield,
  },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [role, setRole] = useState("student");
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("error"));
  const [notice, setNotice] = useState(null);
  const providers = useAuthProviders();

  const isSchoolSignup = role === "school" && mode === "signup";

  if (!isConfigured()) {
    return (
      <main style={{ maxWidth: 620 }}>
        <h1>Portal not configured</h1>
        <div className="note bad">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then
          redeploy — they are compiled in at build time.
        </div>
      </main>
    );
  }

  /**
   * Google is offered to students only.
   *
   * Not a technical limit — it is about what the account means. A school
   * account is an organisation with a contact address and a phone number that
   * an administrator will vet; letting someone create one with a personal
   * Google account in two clicks makes that review meaningless. Administrators
   * are never self-serve at all.
   */
  async function signInWith(provider) {
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;
      /* Navigating away; `busy` stays true so a second click cannot fire. */
    } catch (err) {
      setError(describeAuthError(err));
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === "signup" && password !== confirm) {
      return setError("The two passwords do not match.");
    }
    if (isSchoolSignup && schoolName.trim().length < 2) {
      return setError("Enter the school's name.");
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase().auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        return;
      }

      const { data, error } = await supabase().auth.signUp({
        email,
        password,
        options: { data: { full_name: isSchoolSignup ? schoolName : fullName } },
      });
      if (error) throw error;

      if (!data.session) {
        setNotice("Account created. Confirm it from your email, then sign in.");
        setBusy(false);
        return;
      }

      if (isSchoolSignup) {
        /* File the application immediately, on the session we just received.
           Splitting it into a second visit would leave accounts that are
           school-shaped but have no application, which an administrator would
           have no way to interpret. */
        await api.school.apply({ name: schoolName.trim(), phone: phone.trim() });
        router.replace("/school/pending");
        return;
      }

      router.replace(next);
    } catch (err) {
      setError(describeAuthError(err));
      setBusy(false);
    }
  }

  const activeRole = ROLES.find((r) => r.id === role);

  return (
    <>
      <DroneBackdrop dense />
      <div className="auth-wrap">
        <section className="auth-show">
          {/* Larger here than in the top bar: this is the first page anyone
              sees, and the one place the identity should carry the screen
              rather than sit politely in a corner. */}
          <div className="rise">
            <Brand size={56} />
          </div>

          {/* Deliberately a <p>, not an <h2>. The site-wide h2 is the small
              uppercase section heading — display:flex with a gap and a trailing
              rule — and inheriting that here turned the three lines of this
              headline into three flex items that laid out side by side and
              wrapped independently. A display headline is not a section
              heading, so it does not borrow one's element. */}
          <p className="display rise d1">
            Build a drone.
            <br />
            Fly it. <em>Break it.</em>
            <br />
            Understand it.
          </p>

          <p className="lede rise d2">
            A classroom simulator where the physics are real, the failures are real, and every
            component decision has a consequence you can hear and see.
          </p>

          <div className="features rise d2">
            <span className="feature">
              <span className="feature-ico">
                <Icon.Rocket />
              </span>
              <span>
                <strong>Progress that follows you</strong>
                Pick up on any machine, exactly where you left off.
              </span>
            </span>
            <span className="feature">
              <span className="feature-ico">
                <Icon.School />
              </span>
              <span>
                <strong>School dashboards</strong>
                Teachers see who is flying and who is stuck.
              </span>
            </span>
            <span className="feature">
              <span className="feature-ico">
                <Icon.Shield />
              </span>
              <span>
                <strong>Approved schools only</strong>
                Students join with a code, never an open sign-up.
              </span>
            </span>
          </div>

          <div className="auth-art rise d3">
            <HeroDrone />
          </div>
        </section>

        <section className="auth-form">
          <div className="auth-card rise d1">
            <h1 style={{ fontSize: 27 }}>
              {mode === "signin" ? "Sign in" : isSchoolSignup ? "Register your school" : "Create your account"}
            </h1>
            <p className="sub" style={{ marginBottom: 18 }}>
              {mode === "signin" ? "Choose how you are signing in." : activeRole.blurb}
            </p>

            {/* The role selector. Cards rather than a <select> — this decides
                which of three quite different journeys you are starting, and a
                collapsed dropdown hides that from someone seeing it once. */}
            <div className="role-picker">
              {ROLES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`role-opt ${role === r.id ? "active" : ""}`}
                  onClick={() => {
                    setRole(r.id);
                    setError(null);
                    setNotice(null);
                    if (r.id === "admin") setMode("signin");
                  }}
                >
                  <r.icon />
                  <span>{r.label}</span>
                </button>
              ))}
            </div>

            {role === "admin" && mode === "signup" && (
              <div className="note" style={{ marginBottom: 16 }}>
                Administrator accounts are not self-serve. An existing administrator grants the role.
              </div>
            )}

            {/* Google, students only, and only when the server has it enabled. */}
            {role === "student" && providers?.google && (
              <>
                <button type="button" className="btn oauth" onClick={() => signInWith("google")} disabled={busy}>
                  <Icon.Google />
                  Continue with Google
                </button>
                <div className="divider">
                  <span>or use your email</span>
                </div>
              </>
            )}

            <form onSubmit={submit} className="card">
              {mode === "signup" && !isSchoolSignup && (
                <div className="field">
                  <label htmlFor="name">Full name</label>
                  <input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
              )}

              {isSchoolSignup && (
                <>
                  <div className="field">
                    <label htmlFor="sname">School name</label>
                    <input
                      id="sname"
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      placeholder="e.g. RajUddan Public School"
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="phone">Phone</label>
                    <input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 9xxxxxxxxx"
                    />
                  </div>
                </>
              )}

              <div className="field">
                <label htmlFor="email">{isSchoolSignup ? "School email" : "Email"}</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                {isSchoolSignup && (
                  <div className="hint">Your join code will be sent here once you are approved.</div>
                )}
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
                  <label htmlFor="confirm">Confirm password</label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    minLength={6}
                    required
                  />
                </div>
              )}

              {error && <div className="note bad" style={{ marginBottom: 14 }}>{error}</div>}
              {notice && <div className="note ok" style={{ marginBottom: 14 }}>{notice}</div>}

              <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
                {busy
                  ? "Working…"
                  : mode === "signin"
                    ? "Sign in"
                    : isSchoolSignup
                      ? "Submit for approval"
                      : "Create account"}
              </button>
            </form>

            {role !== "admin" && (
              <div className="row" style={{ marginTop: 18, justifyContent: "center" }}>
                <span className="sub" style={{ margin: 0 }}>
                  {mode === "signin"
                    ? role === "school"
                      ? "Not registered yet?"
                      : "No account yet?"
                    : "Already have one?"}
                </span>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    setMode(mode === "signin" ? "signup" : "signin");
                    setError(null);
                    setNotice(null);
                  }}
                >
                  {mode === "signin" ? (role === "school" ? "Register a school" : "Create one") : "Sign in"}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main>
          <Loader />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
