"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase.js";
import Brand from "../../components/Brand.jsx";
import PasswordField from "../../components/PasswordField.jsx";
import { DroneBackdrop, HeroDrone, Icon, Loader } from "../../components/DroneArt.jsx";

/**
 * SET A NEW PASSWORD
 * ==================
 * Where the link in the reset email lands, by way of /auth/callback — the same
 * route Google sign-in uses. That route exchanges the one-time recovery token
 * for a real session, which is what makes the update below possible: Supabase
 * has no "change the password for this email" call, only "change the password
 * of whoever is signed in". Following the link IS the proof of ownership.
 *
 * NO ROLE CHECK, NO SUBSCRIPTION CHECK, NO APPROVAL CHECK
 * -------------------------------------------------------
 * Every other panel page is gated. This one is deliberately not. A student
 * still waiting on approval, a school whose licence lapsed last week, an
 * administrator — all of them can be locked out of their own account by a
 * forgotten password, and none of those states is a reason to refuse someone
 * the ability to get back into it. Gating this would mean a school could not
 * recover the account it needs in order to ask for the renewal that would
 * ungate it.
 *
 * WHAT HAPPENS TO THE OTHER SESSIONS
 * ----------------------------------
 * They end. Changing a password on an account you may have lost control of and
 * leaving every existing session signed in would defeat the point, and this
 * instance is configured for one session per user anyway.
 */
export default function ResetPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase().auth.getSession();
        if (!alive) return;
        setSignedIn(Boolean(session));
        setEmail(session?.user?.email ?? null);
      } catch (e) {
        if (alive) setError(e.message);
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) return setError("The two passwords do not match.");
    if (password.length < 6) return setError("Use at least six characters.");

    setBusy(true);
    try {
      const { error: err } = await supabase().auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
      /* Signed out on purpose, then sent to the login page. Signing them
         straight in would be smoother and would also mean nobody ever types the
         password they just chose — which is exactly the moment it is most
         likely to be a typo they will not remember making. */
      await supabase().auth.signOut();
      setTimeout(() => router.replace("/login"), 2200);
    } catch (err) {
      setError(
        /New password should be different/i.test(err?.message || "")
          ? "That is the password you already have. Choose a different one."
          : err?.message || "Could not set the password."
      );
      setBusy(false);
    }
  }

  const Frame = ({ children }) => (
    <>
      <DroneBackdrop />
      <div className="shell">
        <header className="topbar">
          <Brand />
          <div className="spacer" />
          <a className="btn small" href="/login">
            Back to sign in
          </a>
        </header>
        <main style={{ maxWidth: 560 }}>{children}</main>
      </div>
    </>
  );

  if (!ready) {
    return (
      <Frame>
        <Loader label="Checking your link" />
      </Frame>
    );
  }

  /**
   * No session means the link did not work. Three causes, and the reader cannot
   * tell them apart, so the screen names all three rather than guessing: the
   * hour ran out, the link had already been used, or it was opened in a
   * different browser from the one that asked for it.
   *
   * That last one is not rare. A student requests the reset on a school
   * computer and opens the mail on a phone; the code verifier lives in the
   * browser that made the request, so the exchange fails. Worth saying out
   * loud, because "try again" alone would send them round the same loop.
   */
  if (!signedIn) {
    return (
      <Frame>
        <section className="hero rise">
          <div className="hero-inner">
            <div className="hero-copy">
              <span className="pill warn">Link no longer valid</span>
              <h1 style={{ marginTop: 14 }}>This reset link did not work</h1>
              <p>Ask for a new one — it only takes a moment, and nothing has been changed.</p>
            </div>
            <div className="hero-art">
              <HeroDrone />
            </div>
          </div>
        </section>

        <div className="note" style={{ marginBottom: 18 }}>
          A reset link lasts one hour, works once, and has to be opened in the same browser that
          asked for it. Requesting it on a school computer and opening the email on a phone is the
          usual reason one fails.
        </div>

        <a className="btn primary" href="/login">
          Request a new link
        </a>
      </Frame>
    );
  }

  if (done) {
    return (
      <Frame>
        <div className="note ok" style={{ marginBottom: 18 }}>
          <strong>Password changed.</strong> Every device that was signed in to this account has been
          signed out. Taking you to the sign-in page…
        </div>
        <a className="btn primary" href="/login">
          Sign in now
        </a>
      </Frame>
    );
  }

  return (
    <Frame>
      <section className="hero rise">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="pill">Almost there</span>
            <h1 style={{ marginTop: 14 }}>Choose a new password</h1>
            <p>
              {email ? (
                <>
                  For <strong>{email}</strong>. At least six characters.
                </>
              ) : (
                "At least six characters."
              )}
            </p>
          </div>
          <div className="hero-art">
            <HeroDrone />
          </div>
        </div>
      </section>

      <form onSubmit={submit} className="card rise d1">
        <PasswordField
          id="new-password"
          label="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          hint="Use the eye to check what you typed before you save it."
        />
        <PasswordField
          id="new-confirm"
          label="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />

        {error && (
          <div className="note bad" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        <button
          className="btn primary"
          style={{ width: "100%", justifyContent: "center" }}
          disabled={busy}
        >
          <Icon.Shield />
          {busy ? "Saving…" : "Save the new password"}
        </button>
      </form>
    </Frame>
  );
}
