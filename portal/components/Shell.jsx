"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../lib/supabase.js";
import { api } from "../lib/api.js";
import Brand from "./Brand.jsx";
import { DroneBackdrop, Icon, Loader } from "./DroneArt.jsx";
import { simulatorUrl, openSimulator } from "../lib/simulator.js";
import { apiUrl } from "../lib/api.js";

/**
 * The signed-in frame around every panel.
 *
 * It resolves the caller's role once and hands it to the page, so a page
 * never has to guess who is looking at it. Navigation is built from the
 * role: a student is not shown a school link that would 403, which is
 * kinder than letting them find out by clicking.
 *
 * The role is authoritative from the API (which reads the database), not
 * from anything the browser could edit. Hiding a link is presentation; the
 * actual refusal happens server-side.
 */
/**
 * Signing out is one click away from every screen, sits next to navigation, and
 * throws away unsaved work in the simulator tab. A confirmation is cheap
 * insurance against a misclick that costs a lesson.
 */
function SignOutConfirm({ onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Sign out?</h2>
        <p className="sub" style={{ marginBottom: 22 }}>
          Your progress is saved. You will need to sign in again to reach your learning or the
          simulator.
        </p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onCancel} autoFocus>
            Stay signed in
          </button>
          <button className="btn danger" onClick={onConfirm}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Shell({ children, requireRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase().auth.getSession();
        if (!session) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        const profile = await api.me();
        if (!alive) return;

        /* THE GATE, ENFORCED ON EVERY PANEL PAGE.
           Hiding the simulator button from an unapproved student is a courtesy,
           not a control — the panel itself is still behind approval, and typing
           /student in the address bar must not be a way past it. Sending them
           to the screen that explains their actual state is also kinder than a
           dashboard with everything greyed out and no reason given. */
        if (profile.role === "student" && !profile.admitted) {
          const want = profile.school ? "/student/pending" : "/student/join";
          /* Never redirect a gate page to itself. /student/join is wrapped in
             this Shell too, so without this check an unjoined student is sent
             to the page they are already on, `me` is never set, and they sit
             under a loading spinner for ever. */
          if (pathname !== want) return router.replace(want);
        }

        setMe(profile);
      } catch (e) {
        if (!alive) return;
        if (e.status === 401) router.replace("/login");
        else setError(e.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, pathname, attempt]);

  if (error) {
    /* A dead end is not an acceptable error state.
       This used to render the message alone, with no top bar — which meant no
       navigation, no sign-out, and no way back except the browser's own Back
       button. An error screen has to leave the user somewhere they can act. */
    return (
      <>
        <DroneBackdrop />
        <div className="shell">
          <header className="topbar">
            <Brand />
            <div className="spacer" />
            <a className="btn small sim-link" href={simulatorUrl()} onClick={openSimulator}>
              <Icon.Play />
              Simulator
            </a>
            <button
              className="btn small"
              onClick={async () => {
                await supabase().auth.signOut();
                router.replace("/login");
              }}
            >
              Sign out
            </button>
          </header>
          <main>
            <h1>Cannot reach the server</h1>
            <p className="sub">
              You are signed in, but the portal could not load your data.
            </p>
            <div className="note bad" style={{ marginBottom: 16 }}>
              {error}
            </div>
            <div className="note" style={{ marginBottom: 20 }}>
              {/failed to fetch|networkerror|load failed/i.test(error) ? (
                <>
                  The browser could not reach the API at <code>{apiUrl()}</code>. Two things cause this
                  most often: the API is asleep and still waking up, or this exact address is not on
                  the API&apos;s allowed list — note that a Vercel preview URL is a different address
                  from the production one.
                </>
              ) : (
                <>The API answered, but with an error. Trying again may be enough.</>
              )}
            </div>
            <div className="row">
              <button className="btn primary" onClick={() => { setError(null); setAttempt((n) => n + 1); }}>
                Try again
              </button>
              <a className="btn" href="/student">
                Back to my learning
              </a>
            </div>
          </main>
        </div>
      </>
    );
  }
  if (!me) {
    return (
      <>
        <DroneBackdrop />
        <main>
          <Loader label="Signing you in" />
        </main>
      </>
    );
  }

  const rank = { student: 0, teacher: 1, school: 1, admin: 2 };
  if (requireRole && rank[me.role] < rank[requireRole]) {
    return (
      <>
        <DroneBackdrop />
        <div className="shell">
          <TopBar me={me} pathname={pathname} />
          <main>
            <div className="note bad">
              This area needs the {requireRole} role. You are signed in as {me.role}.
            </div>
          </main>
        </div>
      </>
    );
  }

  return (
    <>
      <DroneBackdrop />
      <div className="shell">
        <TopBar me={me} pathname={pathname} />
        <main>{typeof children === "function" ? children(me) : children}</main>
      </div>
    </>
  );
}

function TopBar({ me, pathname }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const staff = me.role === "teacher" || me.role === "school" || me.role === "admin";
  /* A school account is not a student and has no learning of its own, so it is
     not shown a student panel it would only find empty. */
  const links = staff
    ? []
    : [{ href: "/student", label: "My learning" }, { href: "/student/profile", label: "Profile" }];
  /* "My school" is deliberately not offered to an administrator. They have no
     school of their own, so the panel would show either nothing or an arbitrary
     one — and every school is already reachable from Administration. */
  if (staff && me.role !== "admin") links.push({ href: "/school", label: "My school" });
  if (me.role === "admin") links.push({ href: "/admin", label: "Administration" });

  return (
    <header className="topbar">
      <Brand />
      <nav>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={pathname === l.href ? "active" : ""}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="spacer" />
      {/* The simulator is a separate application on another origin, so this is a
          real link rather than a route. Opened in a new tab deliberately: a
          student mid-flight should not lose the aircraft by pressing Back, and
          the portal session stays where it was. */}
      {/* Only once admitted. Offering the simulator to a student who has not
          entered a join code sends them somewhere they will be turned away
          from, which is worse than not offering it. */}
      {me.admitted || me.role === "admin" ? (
        <a
          className="btn small sim-link"
          href={simulatorUrl()}
          onClick={openSimulator}
          title="Open the flight simulator"
        >
          <Icon.Play />
          Simulator
          <Icon.External style={{ width: 12, height: 12, opacity: 0.7 }} />
        </a>
      ) : (
        <a className="btn small" href="/student/join" title="Enter your school's join code to unlock the simulator">
          <Icon.Play />
          Unlock simulator
        </a>
      )}
      <span className={`pill ${me.role === "admin" ? "info" : me.role === "teacher" ? "warn" : "muted"}`}>
        {me.role}
      </span>
      <button className="btn small" onClick={() => setConfirming(true)}>
        Sign out
      </button>
      {confirming && (
        <SignOutConfirm
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await supabase().auth.signOut();
            router.replace("/login");
          }}
        />
      )}
    </header>
  );
}
