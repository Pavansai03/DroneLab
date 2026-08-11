"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase.js";
import Brand from "../../components/Brand.jsx";
import PasswordField from "../../components/PasswordField.jsx";
import { DroneBackdrop, HeroDrone, Icon, Loader } from "../../components/DroneArt.jsx";

/**
 * SET A NEW PASSWORD
 * ==================
 * Where the link in the reset email lands. Supabase has no "change the password
 * for this address" call — only "change the password of whoever is signed in" —
 * so following the link IS the proof of ownership, and the whole job of this
 * page before the form appears is to turn that link into a session.
 *
 * THREE WAYS THE SESSION CAN ARRIVE, AND WE ACCEPT ALL OF THEM
 * -------------------------------------------------------------
 * The client asks for PKCE. This GoTrue ignores that and uses the implicit flow
 * anyway, and a different version or a different instance may not. Rather than
 * encode a guess about which, every shape is handled:
 *
 *   1. A FRAGMENT — #access_token=…&type=recovery. The implicit flow, and what
 *      this instance actually sends. Never reaches a server, which is exactly
 *      how the first version of this page failed: /auth/callback saw no `code`,
 *      redirected to /login, and the tokens went with the old URL.
 *   2. ?code=… — PKCE. Normally already exchanged by /auth/callback, but
 *      handled here too so this page works as a direct redirect target.
 *   3. Already signed in — the link was followed a moment ago, or the tab was
 *      reloaded after the client stored the session.
 *
 * The browser client has detectSessionInUrl on, so 1 and 2 are usually consumed
 * during initialise and getSession() simply returns the result. The explicit
 * fallbacks below exist for when it does not, because the failure is silent and
 * the person reading the screen has no way to tell what went wrong.
 *
 * AND A FOURTH: THE SIX-DIGIT CODE
 * ---------------------------------
 * The email offers one — "Alternatively, enter the code" — so the page has to
 * accept one. Promising a code and providing nowhere to type it is worse than
 * not offering it. It is also the only thing that works when the mail is opened
 * on a phone and the reset was requested on a school computer, which is the
 * ordinary case here, not an edge one.
 *
 * NO ROLE, SUBSCRIPTION OR APPROVAL CHECK
 * ----------------------------------------
 * Every other panel page is gated. This one is deliberately not. A student
 * awaiting approval, a school whose licence lapsed and an administrator can all
 * be locked out by a forgotten password, and none of those states is a reason
 * to refuse someone their own account back. Gating it on the subscription would
 * mean a school could not recover the account it needs in order to ask for the
 * renewal that would ungate it.
 */
export default function ResetPage() {
  const router = useRouter();

  const [phase, setPhase] = useState("checking"); // checking | form | code | done
  const [email, setEmail] = useState(null);
  const [linkError, setLinkError] = useState(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /* For the six-digit fallback, which needs the address as well as the code —
     without a session there is nothing to tell us who is asking. */
  const [otpEmail, setOtpEmail] = useState("");
  const [otp, setOtp] = useState("");

  const adopt = useCallback((session) => {
    if (!session) return false;
    setEmail(session.user?.email ?? null);
    setPhase("form");
    return true;
  }, []);

  useEffect(() => {
    let alive = true;
    const client = (() => {
      try {
        return supabase();
      } catch {
        return null;
      }
    })();
    if (!client) {
      setLinkError("This deployment is not configured.");
      setPhase("code");
      return;
    }

    /* A refusal can come back in either half of the URL, depending on the flow,
       so both are read. Worth surfacing verbatim: "otp_expired" and
       "access_denied" mean different things to whoever has to fix it. */
    const hash = new URLSearchParams(
      typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : ""
    );
    const query = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : ""
    );
    const refusal =
      hash.get("error_description") ||
      hash.get("error") ||
      query.get("error_description") ||
      query.get("error");

    /* A late detection still counts. detectSessionInUrl resolves inside the
       client's own initialise, and PASSWORD_RECOVERY is the event it fires for
       exactly this link, so listening costs nothing and closes the race. */
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (alive && session) adopt(session);
    });

    (async () => {
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!alive) return;
        if (adopt(session)) return;

        /* Nothing was picked up. Try each shape by hand before giving up. */
        const code = query.get("code");
        if (code) {
          const { data, error } = await client.auth.exchangeCodeForSession(code);
          if (!alive) return;
          if (!error && adopt(data?.session)) return;
        }

        const access_token = hash.get("access_token");
        const refresh_token = hash.get("refresh_token");
        if (access_token && refresh_token) {
          const { data, error } = await client.auth.setSession({ access_token, refresh_token });
          if (!alive) return;
          if (!error && adopt(data?.session)) return;
        }

        if (alive) {
          setLinkError(refusal);
          setPhase("code");
        }
      } catch (e) {
        if (alive) {
          setLinkError(e.message);
          setPhase("code");
        }
      }
    })();

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [adopt]);

  /** The six-digit fallback: same outcome as the link, typed by hand. */
  async function useCode(e) {
    e.preventDefault();
    setError(null);
    const token = otp.replace(/\D/g, "");
    if (token.length !== 6) return setError("The code is six digits.");
    if (!otpEmail.trim()) return setError("Enter the email the code was sent to.");

    setBusy(true);
    try {
      const { data, error: err } = await supabase().auth.verifyOtp({
        email: otpEmail.trim(),
        token,
        type: "recovery",
      });
      if (err) throw err;
      if (!adopt(data?.session)) throw new Error("That code did not produce a session.");
      setError(null);
    } catch (err) {
      setError(
        /expired|invalid|not found/i.test(err?.message || "")
          ? "That code is not valid any more. Codes last one hour and work once — ask for a new email."
          : err?.message || "Could not check that code."
      );
    }
    setBusy(false);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) return setError("The two passwords do not match.");
    if (password.length < 6) return setError("Use at least six characters.");

    setBusy(true);
    try {
      const { error: err } = await supabase().auth.updateUser({ password });
      if (err) throw err;
      setPhase("done");
      /* Signed out on purpose. Carrying straight on would be smoother and would
         also mean nobody ever types the password they just chose — which is the
         moment it is most likely to be a typo they will not remember making. */
      await supabase().auth.signOut();
      setTimeout(() => router.replace("/login"), 2200);
    } catch (err) {
      setError(
        /should be different/i.test(err?.message || "")
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

  if (phase === "checking") {
    return (
      <Frame>
        <Loader label="Checking your link" />
      </Frame>
    );
  }

  if (phase === "done") {
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

  /**
   * The link did not carry a session. Not a dead end: the same email contains a
   * six-digit code, and typing it here does exactly what the link would have.
   * That is also the answer to the commonest failure — requesting the reset on
   * one device and opening the mail on another.
   */
  if (phase === "code") {
    return (
      <Frame>
        <section className="hero rise">
          <div className="hero-inner">
            <div className="hero-copy">
              <span className="pill warn">Use the code instead</span>
              <h1 style={{ marginTop: 14 }}>Enter the code from the email</h1>
              <p>
                The link did not carry you through — but the same email has a six-digit code near the
                bottom, and it does the same job. Nothing has been changed yet.
              </p>
            </div>
            <div className="hero-art">
              <HeroDrone />
            </div>
          </div>
        </section>

        {linkError && (
          <div className="note bad" style={{ marginBottom: 16 }}>
            The server said: {linkError}
          </div>
        )}

        <form onSubmit={useCode} className="card rise d1">
          <div className="field">
            <label htmlFor="otp-email">Email</label>
            <input
              id="otp-email"
              type="email"
              autoComplete="email"
              value={otpEmail}
              onChange={(e) => setOtpEmail(e.target.value)}
              placeholder="The address the email was sent to"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="otp">Six-digit code</label>
            <input
              id="otp"
              /* Not type="number": it strips leading zeros, offers spinners, and
                 scrolling over it silently changes the value. */
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              style={{ letterSpacing: "0.4em", fontSize: 20, fontWeight: 800 }}
              required
            />
            <div className="hint">Valid for one hour, and it works once.</div>
          </div>

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
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>

        <div className="note" style={{ marginTop: 18 }}>
          No email, or more than an hour ago? <a href="/login">Ask for a new one</a> — a code lasts an
          hour and works once, so an old one will always be refused.
        </div>
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
