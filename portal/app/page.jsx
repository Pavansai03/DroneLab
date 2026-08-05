"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isConfigured } from "../lib/supabase.js";
import { api } from "../lib/api.js";
import { Loader } from "../components/DroneArt.jsx";

/**
 * The front door. Sends each role to the panel it actually uses.
 *
 * A teacher landing on the student panel every morning and clicking through to
 * their class is a small tax paid on every single sign-in, so the redirect is
 * worth the extra request it costs.
 *
 * The error handling here is not decoration. `supabase()` throws when the
 * project is not configured, and an earlier version let that rejection escape
 * an un-caught async function inside the effect — so a misconfigured deployment
 * sat on "Signing you in…" for ever, with an empty console, saying nothing.
 * A page that cannot proceed has to say why.
 */
export default function Home() {
  const router = useRouter();
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase().auth.getSession();
        if (!session) return router.replace("/login");

        try {
          const me = await api.me();
          if (me.role === "admin") router.replace("/admin");
          else if (me.role === "school" || me.role === "teacher") {
            /* A school account with an undecided application belongs on the
               pending screen, not on a dashboard with nothing in it. */
            const { application } = await api.school.application().catch(() => ({ application: null }));
            router.replace(application && application.status !== "approved" ? "/school/pending" : "/school");
          } else router.replace(me.admitted ? "/student" : "/student/join");
        } catch {
          /* Signed in, but the API is unreachable or slow to wake. The student
             panel handles that state itself and shows a real message. */
          router.replace("/student");
        }
      } catch (err) {
        if (alive) setProblem(err.message || String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  if (problem) {
    return (
      <main style={{ maxWidth: 640 }}>
        <h1>This deployment is not configured</h1>
        <div className="note bad" style={{ marginBottom: 16 }}>
          {problem}
        </div>
        <div className="note">
          {isConfigured() ? (
            <>Supabase is configured but could not be reached. Check the URL is correct and online.</>
          ) : (
            <>
              <strong>NEXT_PUBLIC_</strong> variables are baked into the JavaScript at <em>build</em> time,
              not read when the page loads. Setting them in your hosting dashboard does nothing until you
              trigger a <strong>new deployment</strong> — a restart is not enough.
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <main>
      <Loader label="Signing you in" />
    </main>
  );
}
