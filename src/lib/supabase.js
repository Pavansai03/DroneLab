import { createClient } from "@supabase/supabase-js";

/**
 * SUPABASE CLIENT
 * ===============
 * Optional by design. DroneLab is a self-contained simulator and must keep
 * working with no backend at all — so if the two variables below are absent the
 * whole cloud layer switches off and the app behaves exactly as it did before.
 *
 * BUILD TIME, NOT RUN TIME
 * ------------------------
 * Vite substitutes `import.meta.env.VITE_*` during `vite build`. Setting these
 * in a host's *runtime* environment panel does nothing for a static bundle —
 * they must be passed as build arguments. See the Dockerfile.
 *
 * The ANON key is meant to be public; it is safe in the browser only because
 * Row Level Security is enabled on every table (see supabase/schema.sql).
 * The SERVICE ROLE key must never appear here — it bypasses RLS entirely.
 */

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && anonKey);

/** Why the cloud layer is off, so the UI can say something useful. */
export const supabaseConfigNote = isSupabaseConfigured
  ? null
  : !url && !anonKey
    ? "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set, so progress is kept in this browser tab only."
    : !url
      ? "VITE_SUPABASE_URL is missing."
      : "VITE_SUPABASE_ANON_KEY is missing.";

/**
 * What this build was actually given.
 *
 * Vite replaces `import.meta.env` wholesale at build time, so this object is a
 * literal record of the VITE_* variables that existed when the bundle was
 * compiled — which is precisely the question you need answered when the app
 * insists it is unconfigured and the hosting dashboard insists it is not.
 *
 * It answers three failures that are otherwise indistinguishable from the
 * outside: the variables were set on a different project, the build ran before
 * they were added, or a name was mistyped (a stray character shows up here as
 * an unfamiliar entry rather than as silence).
 *
 * Names only. Values are reduced to their length, because the anon key is
 * public but there is no reason to paint it across the interface.
 */
export const buildEnvReport = Object.entries(import.meta.env)
  .filter(([k]) => k.startsWith("VITE_"))
  .map(([k, v]) => ({ name: k, chars: typeof v === "string" ? v.trim().length : 0 }))
  .sort((a, b) => a.name.localeCompare(b.name));

/* A common deployment mistake worth catching early: pointing the app at a
   plain-HTTP Supabase from an HTTPS page. The browser blocks that as mixed
   content and every request fails with no useful error. */
if (isSupabaseConfigured && typeof window !== "undefined") {
  if (window.location.protocol === "https:" && url.startsWith("http://")) {
    console.error(
      "[DroneLab] VITE_SUPABASE_URL is http:// but this page is https://. " +
        "The browser will block every Supabase request as mixed content. " +
        "Serve Supabase over https."
    );
  }
}

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

/** Turn a Supabase error into something a teacher can act on. */
export function describeError(error) {
  if (!error) return null;
  const msg = error.message || String(error);
  if (/Failed to fetch|NetworkError|ERR_CONNECTION/i.test(msg)) {
    return "Cannot reach Supabase. Check the URL, that the stack is running, and that it is served over https.";
  }
  if (/Invalid login credentials/i.test(msg)) return "Wrong email or password.";
  if (/Email not confirmed/i.test(msg)) {
    return "That account still needs email confirmation. Either confirm it, or turn off email confirmation in Supabase Auth settings.";
  }
  if (/User already registered/i.test(msg)) return "That email already has an account — sign in instead.";
  if (/row-level security/i.test(msg)) {
    return "Blocked by row level security. Has supabase/schema.sql been run on this instance?";
  }
  if (/relation .* does not exist/i.test(msg)) {
    return "The tables are missing. Run supabase/schema.sql in the SQL editor.";
  }
  return msg;
}
