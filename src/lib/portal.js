/**
 * WHERE THE PORTAL IS
 * ===================
 * The simulator is deployed independently of the portal and is perfectly usable
 * on its own, so it cannot assume a portal exists. `VITE_PORTAL_URL` is what
 * tells it there is one to go back to; without it the back control simply does
 * not appear, and the simulator behaves exactly as it always has.
 */

export const portalUrl = () => {
  /* When the simulator is built into the portal under /sim, the portal is
     simply the site root. In that case we ignore any stale VITE_PORTAL_URL
     value and return the local root, because the portal is on the same origin.
     This prevents a merged deployment from redirecting back to a development
     or old domain. */
  if (import.meta.env.BASE_URL === "/sim/") return "/";

  const configured = import.meta.env.VITE_PORTAL_URL;
  return configured || "";
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
    if (ref) {
      const refUrl = new URL(ref);
      if (refUrl.origin === target.origin) {
        if (window.history.length > 1) {
          window.history.back();
          return;
        }
        window.location.assign(ref);
        return;
      }
    }
  } catch {
    /* A malformed referrer or URL is not worth failing navigation over. */
  }
  window.location.assign(url);
}
