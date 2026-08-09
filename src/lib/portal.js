/**
 * WHERE THE PORTAL IS
 * ===================
 * The simulator is deployed independently of the portal and is perfectly usable
 * on its own, so it cannot assume a portal exists. `VITE_PORTAL_URL` is what
 * tells it there is one to go back to; without it the back control simply does
 * not appear, and the simulator behaves exactly as it always has.
 */

export const portalUrl = () => {
  const configured = import.meta.env.VITE_PORTAL_URL;
  if (configured) return configured;
  /* Served from /sim inside the portal's own deployment, the portal is simply
     the root of this origin — no configuration needed, and the back control
     appears by default rather than only when someone remembers a variable.
     A standalone build (base "/") has no portal to return to. */
  return import.meta.env.BASE_URL === "/sim/" ? "/" : "";
};

/** Is there a portal to return to at all? */
export const hasPortal = () => Boolean(portalUrl());

/**
 * Go back to the portal.
 *
 * Prefers history.back() when the previous page really was the portal, because
 * that restores the exact page and scroll position the student left — which
 * `location.assign` cannot do. Falls back to a plain navigation when the
 * simulator was opened directly, bookmarked, or reloaded, where there is no
 * useful history entry to go back to.
 */
export function goToPortal() {
  const url = portalUrl();
  if (!url) return;
  try {
    const ref = document.referrer;
    /* `url` may be a bare path now that the two share an origin, and the URL
       constructor rejects those without a base. Resolving against the current
       location handles both forms. */
    const target = new URL(url, window.location.href);
    if (ref && new URL(ref).origin === target.origin && window.history.length > 1) {
      window.history.back();
      return;
    }
  } catch {
    /* A malformed referrer or URL is not worth failing navigation over. */
  }
  window.location.assign(url);
}
