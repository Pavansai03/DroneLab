"use client";

import { useEffect, useState } from "react";

/**
 * Which social sign-in providers this Supabase instance actually has enabled —
 * and whether it answered at all.
 *
 * Asked at runtime rather than hard-coded, so the Google button appears the
 * moment an administrator enables Google in the server's environment and
 * disappears if they turn it off — no rebuild, no code change. Showing a button
 * for a provider the server has not been configured for is worse than showing
 * nothing: it fails with a raw provider error the student cannot act on.
 *
 * `/auth/v1/settings` is public and unauthenticated by design; it is what the
 * Supabase UI itself reads.
 *
 * REACHABILITY IS REPORTED SEPARATELY, AND THAT MATTERS.
 * -----------------------------------------------------
 * A server that is down and a server with Google switched off used to be the
 * same thing here: both ended as `{}`, and both simply removed the button. So
 * when the authentication host stopped answering, the visible symptom was that
 * Continue with Google had vanished — which reads as "the deploy broke the
 * page", sends you looking through the portal's code, and says nothing about
 * the machine that is actually down. Every password sign-in was failing at the
 * same moment for the same reason, and nothing on the page connected the two.
 *
 * `reachable` is null while the question is open, true once the server has
 * answered, false once it has failed to.
 */
export function useAuthProviders() {
  const [state, setState] = useState({ providers: null, reachable: null, host: null });

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return setState({ providers: {}, reachable: null, host: null });

    /* The host, not the whole URL: it is the part worth reading out loud, and
       the part to check in a hosting panel. */
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* Not a parseable URL — show it as given, which is itself the answer. */
    }

    let alive = true;
    fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`settings ${r.status}`))))
      .then((s) => alive && setState({ providers: s?.external ?? {}, reachable: true, host }))
      /* A failure here must not block password sign-in, which is the fallback —
         but it is now said out loud rather than absorbed. */
      .catch(() => alive && setState({ providers: {}, reachable: false, host }));
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
