"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../lib/supabase.js";
import { api } from "../lib/api.js";

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
      <main>
        <p className="sub">Loading…</p>
      </main>
    );
  }

  const rank = { student: 0, teacher: 1, admin: 2 };
  if (requireRole && rank[me.role] < rank[requireRole]) {
    return (
      <div className="shell">
        <TopBar me={me} pathname={pathname} />
        <main>
          <div className="note bad">
            This area needs the {requireRole} role. You are signed in as {me.role}.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <TopBar me={me} pathname={pathname} />
      <main>{typeof children === "function" ? children(me) : children}</main>
    </div>
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
        DRONE<span>LAB</span>
      </div>
      <nav>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={pathname === l.href ? "active" : ""}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="spacer" />
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
