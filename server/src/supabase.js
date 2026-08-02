import { createClient } from "@supabase/supabase-js";

/**
 * TWO CLIENTS, AND THE DIFFERENCE MATTERS
 * =======================================
 * Every request here builds one of two Supabase clients, and choosing the
 * wrong one is the difference between a working permission system and none
 * at all.
 *
 *   userClient(token)  — carries the caller's own JWT. Every query runs
 *                        through Row Level Security exactly as it would
 *                        from the browser. This is the default, and almost
 *                        every route uses it: the database decides what the
 *                        caller may see, and the API cannot accidentally
 *                        widen that.
 *
 *   adminClient()      — the SERVICE ROLE key. Bypasses RLS completely.
 *                        Used only where the operation is inherently
 *                        privileged: granting a role, creating a school,
 *                        counting across every school. Each such route
 *                        checks the caller is an admin FIRST, in code,
 *                        because the database will not be checking.
 *
 * The service role key must never reach the browser. That is the whole
 * reason this Express layer exists: Supabase's own client is perfectly
 * capable of everything else directly from Next.js.
 */

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function assertConfigured() {
  const missing = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Copy server/.env.example to server/.env and fill it in.`
    );
  }
}

/** A client acting as the signed-in user. RLS applies. */
export function userClient(accessToken) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** A client that bypasses RLS. Guard every call site with a role check. */
export function adminClient() {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
