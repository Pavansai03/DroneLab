/**
 * THEME
 * =====
 * Light and dark, driven by a `data-theme` attribute on <html>. Every colour in
 * styles.css reads from a CSS variable, so the whole interface repaints from
 * this one attribute — no per-component branching.
 *
 * The default follows the operating system, because a student who has already
 * told their machine they prefer light should not have to tell us as well. Once
 * they pick explicitly, that choice wins and is remembered.
 */

const KEY = "dronelab.theme";

export const THEMES = ["dark", "light"];

/** What the OS asks for, when the user has expressed no preference of their own. */
export function systemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function storedTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : null;
  } catch {
    // Private browsing can throw on localStorage. A theme is not worth crashing over.
    return null;
  }
}

export function initialTheme() {
  return storedTheme() ?? systemTheme();
}

export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const t = THEMES.includes(theme) ? theme : "dark";
  document.documentElement.setAttribute("data-theme", t);
  /* Tells the browser to render form controls, scrollbars and the like to match,
     so native chrome does not stay dark inside a light page. */
  document.documentElement.style.colorScheme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
}

/**
 * Read a resolved CSS variable as a hex number, for the three.js side.
 *
 * The 3D scene cannot use CSS variables directly, and duplicating the palette in
 * JavaScript would guarantee the two drift apart. Reading the computed value
 * keeps a single source of truth in styles.css.
 */
export function cssColor(varName, fallback = 0x000000) {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  if (raw.startsWith("#")) {
    const hex = raw.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    const n = parseInt(full, 16);
    return Number.isNaN(n) ? fallback : n;
  }
  const m = raw.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
  return fallback;
}
