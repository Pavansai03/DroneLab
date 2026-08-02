"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase.js";
import { api } from "../lib/api.js";

/**
 * The front door. Sends each role to the panel it actually uses.
 *
 * A teacher landing on the student panel every morning and clicking through
 * to their class is a small tax paid on every single sign-in, so the
 * redirect is worth the extra request it costs.
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase().auth.getSession();
      if (!session) return router.replace("/login");
      try {
        const me = await api.me();
        router.replace(me.role === "admin" ? "/admin" : me.role === "teacher" ? "/teacher" : "/student");
      } catch {
        router.replace("/student");
      }
    })();
  }, [router]);

  return (
    <main>
      <p className="sub">Signing you in…</p>
    </main>
  );
}
