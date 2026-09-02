#!/usr/bin/env node
/**
 * WALK THE WHOLE ROUTE, HOP BY HOP
 * ================================
 *     npm run diagnose
 *     npm run diagnose -- https://drone.example.in
 *     npm run diagnose -- https://drone.example.in --api=https://api.example.in
 *
 * With no arguments it reads portal/.env.local, which is the development
 * deployment. Name the URLs to check production, because that is where the
 * values differ and where the outage will be.
 *
 * WHY THIS EXISTS
 * ---------------
 * "The Google button disappeared" and "sign-in says it cannot reach the
 * server" were the same incident, and neither sentence contains the word that
 * mattered: the VPS carrying both the API and Supabase had stopped answering
 * on every port. Working that out took DNS lookups, an RDAP query, a port
 * sweep, a traceroute and a certificate-transparency search. None of that was
 * clever; it was just tedious, and it will be needed again.
 *
 * So it is a command now. It walks the same path a student's browser walks:
 *
 *     browser → portal (Vercel)            static, almost never the problem
 *             → Supabase  /auth/v1/health  sign-in, sessions, every table
 *             → API       /health          roster, reports, admin
 *
 * and for each hop reports DNS, TCP, TLS and HTTP separately, because which
 * one fails is the entire diagnosis:
 *
 *     DNS fails            the record is wrong or missing
 *     TCP refused          the machine is alive, nothing is listening — the
 *                          container or reverse proxy is down
 *     TCP times out        packets are being dropped: the machine is off, or
 *                          a firewall is dropping rather than rejecting
 *     TLS fails            certificate expired, or issued for another name
 *     HTTP 502/503/504     the proxy is up and what sits behind it is not
 *     HTTP 200             that hop is fine; look at the next one
 *
 * Nothing here needs a password, and nothing here writes: every endpoint it
 * touches is one an unauthenticated browser already asks for.
 */

import { lookup } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 8000;

/* ------------------------------------------------------------ config */

/**
 * Read the deployment's own environment files rather than asking for the URLs.
 * They are the same values the build uses, so a typo in one shows up here as
 * the wrong host being probed — which is itself the answer.
 */
function envFrom(file, keys) {
  const path = resolve(ROOT, file);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, k, raw] = m;
    if (!keys.includes(k)) continue;
    out[k] = raw.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const portalEnv = {
  ...envFrom("portal/.env.example", ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_API_URL"]),
  ...envFrom("portal/.env.local", ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_API_URL"]),
};

/* Named flags, because three URLs in a row is three chances to swap two. */
const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const positional = args.find((a) => !a.startsWith("--")) ?? null;

const portalOrigin = flag("portal") ?? positional ?? process.env.PORTAL_URL ?? null;
const supabaseUrl =
  flag("supabase") ?? process.env.SUPABASE_URL ?? portalEnv.NEXT_PUBLIC_SUPABASE_URL ?? null;
const apiUrl = flag("api") ?? process.env.API_URL ?? portalEnv.NEXT_PUBLIC_API_URL ?? null;

/* ------------------------------------------------------------- probes */

const ms = (t0) => `${Date.now() - t0}ms`;

async function dnsOf(host) {
  const t0 = Date.now();
  try {
    const all = await lookup(host, { all: true });
    return { ok: true, detail: all.map((a) => a.address).join(", "), took: ms(t0) };
  } catch (e) {
    return { ok: false, detail: e.code ?? e.message, took: ms(t0) };
  }
}

/**
 * REFUSED AND TIMED OUT ARE DIFFERENT ANSWERS, and conflating them is what
 * makes an outage take an afternoon. A refusal is a live machine saying
 * "nothing is listening here" — the service is down. A timeout is silence:
 * the machine is off, suspended, or something upstream is dropping packets.
 */
function tcpOf(host, port) {
  return new Promise((res) => {
    const t0 = Date.now();
    const s = new net.Socket();
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      s.destroy();
      res({ ok, detail, took: ms(t0) });
    };
    s.setTimeout(TIMEOUT);
    s.once("connect", () => done(true, "open"));
    s.once("timeout", () => done(false, "TIMED OUT — packets dropped, not refused"));
    s.once("error", (e) =>
      done(false, e.code === "ECONNREFUSED" ? "REFUSED — host alive, nothing listening" : e.code)
    );
    s.connect(port, host);
  });
}

function tlsOf(host, port) {
  return new Promise((res) => {
    const t0 = Date.now();
    const s = tls.connect(
      { host, port, servername: host, timeout: TIMEOUT, rejectUnauthorized: false },
      () => {
        const c = s.getPeerCertificate();
        const until = c?.valid_to ? new Date(c.valid_to) : null;
        const days = until ? Math.round((until - Date.now()) / 86400000) : null;
        s.end();
        res({
          ok: s.authorized || days > 0,
          detail:
            `${c?.subject?.CN ?? "?"} · ${c?.issuer?.O ?? "?"} · ` +
            (days === null ? "no expiry" : days < 0 ? `EXPIRED ${-days}d ago` : `${days}d left`) +
            (s.authorized ? "" : ` · UNTRUSTED (${s.authorizationError})`),
          took: ms(t0),
        });
      }
    );
    s.once("timeout", () => {
      s.destroy();
      res({ ok: false, detail: "handshake timed out", took: ms(t0) });
    });
    s.once("error", (e) => res({ ok: false, detail: e.code ?? e.message, took: ms(t0) }));
  });
}

async function httpOf(url, init = {}) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT + 4000);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    let body = "";
    try {
      body = (await r.text()).slice(0, 120).replace(/\s+/g, " ");
    } catch {
      /* a proxy error page with no body is still an answer */
    }
    return { ok: r.ok, status: r.status, detail: `${r.status} ${body}`.trim(), took: ms(t0), res: r };
  } catch (e) {
    return { ok: false, detail: e.cause?.code ?? e.name ?? e.message, took: ms(t0) };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------- output */

const notes = [];
const row = (label, r) =>
  console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${label.padEnd(26)} ${String(r.took).padStart(7)}  ${r.detail}`);

async function walk(name, rawUrl, healthPath) {
  console.log(`\n${name}`);
  if (!rawUrl) {
    console.log("  --    not configured — no URL to test");
    notes.push(`${name}: no URL configured, so nothing was checked.`);
    return null;
  }

  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    console.log(`  FAIL  unparseable URL: ${rawUrl}`);
    notes.push(`${name}: "${rawUrl}" is not a URL.`);
    return null;
  }
  console.log(`  ${u.origin}`);

  const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
  const dns = await dnsOf(u.hostname);
  row("DNS", dns);
  if (!dns.ok) {
    notes.push(`${name}: the hostname does not resolve. The DNS record is missing or wrong.`);
    return null;
  }

  const tcp = await tcpOf(u.hostname, port);
  row(`TCP ${port}`, tcp);
  if (!tcp.ok) {
    notes.push(
      tcp.detail.startsWith("TIMED OUT")
        ? `${name}: nothing on ${dns.detail} answered port ${port}, and it did not refuse either — ` +
          `the packets are being dropped. That is a machine that is off or suspended, or a firewall ` +
          `set to DROP. A crashed container would refuse, not go silent.`
        : `${name}: ${dns.detail} is alive but nothing is listening on ${port}. The reverse proxy ` +
          `or the container behind it is down.`
    );
    return null;
  }

  if (u.protocol === "https:") {
    const cert = await tlsOf(u.hostname, port);
    row("TLS", cert);
    if (!cert.ok) notes.push(`${name}: TLS failed — ${cert.detail}.`);
  }

  const health = await httpOf(`${u.origin}${healthPath}`);
  row(`GET ${healthPath}`, health);
  if ([502, 503, 504].includes(health.status)) {
    notes.push(
      `${name}: the proxy answered ${health.status}, so the proxy is up and the service behind it is not. ` +
        `Look at the container, not at DNS.`
    );
  }
  return { url: u, health };
}

/* ---------------------------------------------------------------- run */

console.log("\nDroneLab — walking the route a student's browser walks");
console.log("=".repeat(64));

const portal = await walk("PORTAL (the pages)", portalOrigin, "/login");
const supa = await walk("SUPABASE (sign-in, every table)", supabaseUrl, "/auth/v1/health");
const api = await walk("API (roster, reports, admin)", apiUrl, "/health");

/* Which social providers the login page will offer. This is the exact request
   that makes the Continue with Google button appear, and its failing is the
   whole reason the button "disappeared". */
if (supa?.health.ok) {
  console.log("\nSIGN-IN PROVIDERS");
  const settings = await httpOf(`${supa.url.origin}/auth/v1/settings`);
  row("GET /auth/v1/settings", settings);
  if (settings.ok) {
    try {
      const ext = JSON.parse(settings.detail.slice(settings.detail.indexOf("{")))?.external ?? {};
      const on = Object.entries(ext).filter(([, v]) => v).map(([k]) => k);
      console.log(`        enabled: ${on.join(", ") || "none — email and password only"}`);
      if (!ext.google) {
        notes.push(
          "Google is not enabled on this Supabase, so the Continue with Google button will not " +
            "appear. That is a setting, not a fault — see PORTAL-SETUP section 6."
        );
      }
    } catch {
      console.log("        (could not parse the provider list)");
    }
  }
}

/* The API is reached from the browser with a bearer token, so a wrong
   CORS_ORIGINS is invisible to curl and fatal in a browser. */
if (api?.health.ok && portal) {
  console.log("\nCORS (the API seen from the portal's origin)");
  const pre = await httpOf(`${api.url.origin}/api/me`, {
    method: "OPTIONS",
    headers: {
      Origin: portal.url.origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });
  const allow = pre.res?.headers.get("access-control-allow-origin") ?? null;
  row("preflight /api/me", {
    ok: allow === portal.url.origin,
    took: pre.took,
    detail: allow ? `allow-origin: ${allow}` : "no Access-Control-Allow-Origin header",
  });
  if (allow !== portal.url.origin) {
    notes.push(
      `CORS: the API does not allow ${portal.url.origin}. Add it to CORS_ORIGINS on the API, exactly, ` +
        `including the scheme. In a browser this looks identical to the API being down.`
    );
  }
}

/* If Supabase and the API share an address, they share a fate — and the two
   failures above are one incident, not two. Saying so is the difference
   between checking one machine and auditing a platform. */
if (supabaseUrl && apiUrl) {
  try {
    const a = (await dnsOf(new URL(supabaseUrl).hostname)).detail;
    const b = (await dnsOf(new URL(apiUrl).hostname)).detail;
    if (a && a === b && !supa?.health.ok && !api?.health.ok) {
      notes.push(
        `Supabase and the API are both at ${a}. They are one machine and they have failed ` +
          `together, so this is a single host to bring back, not two services to debug.`
      );
    }
  } catch {
    /* Unparseable URLs are already reported above. */
  }
}

console.log("\n" + "=".repeat(64));
if (!notes.length) {
  console.log("Every hop answered. If something is still wrong, it is above the network.\n");
} else {
  console.log("WHAT THIS MEANS\n");
  for (const n of notes) console.log(`  · ${n}\n`);
}
