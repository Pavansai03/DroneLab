"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../lib/supabase.js";
import { api } from "../lib/api.js";
import { DroneBackdrop, Icon, Loader } from "./DroneArt.jsx";
import { simulatorUrl } from "../lib/simulator.js";

/**
 * The signed-in frame around every panel.
 *
 * It resolves the caller's role once and hands it to the page, so a page
 * never has to guess who is looking at it. Navigation is built from the
 * role: a student is not shown a teacher link that would 403, which is
 * kinder than letting them find out by clicking.
 *
 * The role is authoritative from the API (which reads the database), not
 * from anything the browser could edit. Hiding a link is presentation; the
 * actual refusal happens server-side.
 */
export default function Shell({ children, requireRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);

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
  }, [router, pathname]);

  if (error) {
    return (
      <main>
        <div className="note bad">{error}</div>
      </main>
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

  const rank = { student: 0, teacher: 1, admin: 2 };
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
  const links = [{ href: "/student", label: "My learning" }, { href: "/student/profile", label: "Profile" }];
  if (me.role === "teacher" || me.role === "admin") links.push({ href: "/teacher", label: "My school" });
  if (me.role === "admin") links.push({ href: "/admin", label: "Administration" });

  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark">
          <Icon.Bolt />
        </span>
        DRONE<em>LAB</em>
      </div>
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
      <a
        className="btn small sim-link"
        href={simulatorUrl()}
        target="_blank"
        rel="noopener noreferrer"
        title="Open the flight simulator in a new tab"
      >
        <Icon.Play />
        Simulator
        <Icon.External style={{ width: 12, height: 12, opacity: 0.7 }} />
      </a>
      <span className={`pill ${me.role === "admin" ? "info" : me.role === "teacher" ? "warn" : "muted"}`}>
        {me.role}
      </span>
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
  );
}
