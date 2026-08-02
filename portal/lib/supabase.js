"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * The browser's Supabase client.
 *
 * `createBrowserClient` from @supabase/ssr stores the session in cookies
 * rather than localStorage, which is what lets the Next.js middleware read
 * it on the server and redirect an unauthenticated request before any page
 * renders. With localStorage the server sees nothing and every page has to
 * flash a loading state first.
 *
 * The anon key is inlined into this bundle and is readable by anyone. That
 * is by design — it identifies the project, it does not authorise anything.
 * Row Level Security is what decides who may read which row.
 */

let client = null;

export function supabase() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Copy portal/.env.example to portal/.env.local and set " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  client = createBrowserClient(url, key);
  return client;
}

export const isConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
