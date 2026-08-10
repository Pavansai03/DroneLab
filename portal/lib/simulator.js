"use client";

import { supabase } from "./supabase.js";

/**
 * Where the flight simulator lives.
 *
 * It ships inside this deployment now, as a static build under `/sim` — see
 * scripts/build-merged.mjs. The default is that path, so nothing needs
 * configuring for the normal case.
 *
 * Still overridable. Pointing NEXT_PUBLIC_SIMULATOR_URL at a full URL puts the
 * simulator back on its own host, which is what local development does when the
 * Vite dev server is running on 5173 and the two are genuinely separate.
 */
export const simulatorUrl = () =>
  process.env.NEXT_PUBLIC_SIMULATOR_URL || "/sim";

/**
 * Open the simulator, carrying the signed-in session across.
 *
 * The two applications sit on different origins and a browser isolates storage
 * per origin, so the simulator cannot see this session on its own — a student
 * who signed in thirty seconds ago would be asked to sign in again. A cookie on
 * a shared parent domain would normally solve it, but `vercel.app` is on the
 * Public Suffix List specifically so that one deployment cannot set cookies
 * another can read, so the session has to be handed over explicitly.
 *
 * It travels in the URL FRAGMENT, which is never transmitted to a server: it
 * cannot reach an access log, a proxy, or a `Referer` header. The simulator
 * strips it from the address bar the moment it is read. This is the same
 * mechanism Supabase's own OAuth implicit flow uses to hand a session to a
 * browser.
 */
export async function openSimulator(e) {
  if (e) e.preventDefault();
  const base = simulatorUrl();

  try {
    const {
      data: { session },
    } = await supabase().auth.getSession();

    const target = `${base}${
      session?.access_token && session?.refresh_token
        ? `#dl_session=${encodeURIComponent(
            btoa(
              JSON.stringify({
                access_token: session.access_token,
                refresh_token: session.refresh_token,
              })
            )
          )}`
        : ""
    }`;

    window.open(target, "_blank", "noopener noreferrer");
    return;
  } catch {
    /* No session, or Supabase unavailable. Fall through — the simulator is
       fully usable signed out, so a handoff failure must never block the link. */
  }
  window.open(base, "_blank", "noopener noreferrer");
}
