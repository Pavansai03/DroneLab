import { supabase, isSupabaseConfigured } from "./supabase.js";

/**
 * SESSION HANDOFF
 * ===============
 * Carries a signed-in session from the portal to the simulator.
 *
 * WHY THIS IS NEEDED AT ALL
 * -------------------------
 * The two applications are deployed to different origins — the portal on one
 * vercel.app hostname, the simulator on another — and a browser isolates
 * storage per origin. The simulator genuinely cannot read the portal's session,
 * so a student who signed in a moment ago is asked to sign in again, which is
 * both baffling and the sort of thing that stops people using the account layer
 * at all.
 *
 * The usual fix is a cookie on a shared parent domain. That is not available
 * here: `vercel.app` is on the Public Suffix List precisely so that one
 * deployment cannot set cookies readable by another, and a browser will refuse
 * to set one. Short of putting both apps behind one custom domain, the session
 * has to be handed over explicitly.
 *
 * WHY THE FRAGMENT, AND WHY IT IS ACCEPTABLE
 * ------------------------------------------
 * The tokens travel in the URL fragment — the part after `#`. That is not an
 * incidental choice:
 *
 *   - a fragment is NEVER sent to a server, so the token cannot appear in
 *     access logs, proxy logs, or a `Referer` header;
 *   - it is stripped from the address bar the instant it is consumed, so it
 *     does not linger in history or in a copied URL.
 *
 * This is the same mechanism Supabase's own OAuth implicit flow uses to return
 * a session to a browser. It is not free of risk — anything in a URL can be
 * shoulder-surfed or pasted somewhere careless — which is why the token is
 * removed immediately and why the access token here is the short-lived one that
 * Supabase rotates roughly hourly.
 */

const KEY = "dl_session";

/** Read a handed-over session, apply it, and scrub the URL. Safe to call always. */
export async function consumeSessionHandoff() {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash;
  if (!hash || !hash.includes(KEY)) return false;

  /* Scrub FIRST, before any await. If applying the session throws, or the user
     closes the tab mid-flight, the token must not be left sitting in the
     address bar for the next person at that machine. */
  const params = new URLSearchParams(hash.slice(1));
  const raw = params.get(KEY);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);

  if (!raw || !isSupabaseConfigured || !supabase) return false;

  try {
    const { access_token, refresh_token } = JSON.parse(atob(raw));
    if (!access_token || !refresh_token) return false;
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) {
      console.warn("[DroneLab] Session handoff rejected:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    /* A malformed or expired handoff is not an error worth showing anyone — the
       student simply lands signed out, which is the pre-existing behaviour. */
    console.warn("[DroneLab] Could not read the session handoff:", e.message);
    return false;
  }
}

/** Pack a session for a handoff URL. Used by the portal side. */
export function encodeSessionHandoff(session) {
  if (!session?.access_token || !session?.refresh_token) return null;
  return btoa(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })
  );
}

export const HANDOFF_KEY = KEY;
