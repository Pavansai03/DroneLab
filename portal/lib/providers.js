"use client";

import { useEffect, useState } from "react";

/**
 * Which social sign-in providers this Supabase instance actually has enabled.
 *
 * Asked at runtime rather than hard-coded, so the Google button appears the
 * moment an administrator enables Google in the server's environment and
 * disappears if they turn it off — no rebuild, no code change. Showing a button
 * for a provider the server has not been configured for is worse than showing
 * nothing: it fails with a raw provider error the student cannot act on.
 *
 * `/auth/v1/settings` is public and unauthenticated by design; it is what the
 * Supabase UI itself reads.
 */
export function useAuthProviders() {
  const [providers, setProviders] = useState(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return setProviders({});

    let alive = true;
    fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => alive && setProviders(s?.external ?? {}))
      // A failure here must not block password sign-in, which is the fallback
      .catch(() => alive && setProviders({}));
    return () => {
      alive = false;
    };
  }, []);

  return providers;
}
