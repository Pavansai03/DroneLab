#!/usr/bin/env node
/**
 * Check that DroneLab can actually talk to your Supabase instance.
 *
 *   node supabase/check-connection.mjs
 *
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from .env.local (or from
 * the real environment) and works through every failure mode that produces a
 * silent or misleading symptom in the browser:
 *
 *   - anon key not signed with the deployed JWT_SECRET      -> 401 everywhere
 *   - pointing at the Studio domain instead of Kong         -> HTML, not JSON
 *   - schema.sql never run                                  -> 404 per table
 *   - RLS left off                                          -> the anon key is
 *                                                              a public read/write
 *                                                              credential
 *
 * Nothing here writes to your database.
 */

import { readFileSync, existsSync } from "node:fs";

const GREEN = "\x1b[32m", RED = "\x1b[31m", YEL = "\x1b[33m", DIM = "\x1b[2m", OFF = "\x1b[0m";
const ok = (m, d) => console.log(`${GREEN}  PASS${OFF}  ${m}${d ? `\n${DIM}        ${d}${OFF}` : ""}`);
const bad = (m, d) => { failures++; console.log(`${RED}  FAIL${OFF}  ${m}${d ? `\n${DIM}        ${d}${OFF}` : ""}`); };
const warn = (m, d) => { warnings++; console.log(`${YEL}  WARN${OFF}  ${m}${d ? `\n${DIM}        ${d}${OFF}` : ""}`); };

let failures = 0;
let warnings = 0;

/* ------------------------------------------------------------ env ---- */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = { ...loadEnvFile(".env"), ...loadEnvFile(".env.local") };
const URL_ = (process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || "").trim();
const KEY = (process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY || "").trim();

console.log("\nDroneLab -> Supabase connection check\n" + "=".repeat(38) + "\n");

if (!URL_ || !KEY) {
  bad(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not found",
    "Create .env.local in the project root with both values. See .env.example."
  );
  process.exit(1);
}

/* ------------------------------------------------------- 1. the URL -- */
console.log("1. URL");
let base = URL_.replace(/\/+$/, "");
if (base !== URL_) warn("Trailing slash removed", `Use ${base}`);

if (!/^https?:\/\//.test(base)) {
  bad("URL has no scheme", "It must start with https://");
} else if (base.startsWith("http://")) {
  warn(
    "URL is http://, not https://",
    "A page served over HTTPS cannot call an HTTP API — the browser blocks it as mixed content. Fine for local testing only."
  );
} else {
  ok(`${base}`);
}
if (/studio/i.test(base)) {
  warn(
    "This looks like the Studio domain",
    "DroneLab needs the KONG gateway domain (the one on port 8000), not Studio."
  );
}

/* -------------------------------------------------- 2. the anon key -- */
console.log("\n2. Anon key");
const parts = KEY.split(".");
if (parts.length !== 3) {
  bad("Not a JWT", "The anon key is a three-part JWT. You may have pasted the JWT_SECRET by mistake.");
} else {
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (payload.role === "anon") {
      ok(`role = anon, issuer = ${payload.iss ?? "(none)"}`);
    } else if (payload.role === "service_role") {
      bad(
        "This is the SERVICE ROLE key",
        "It bypasses row level security and must never reach a browser. Use ANON_KEY."
      );
    } else {
      warn(`Unexpected role "${payload.role}"`, "Supabase expects role \"anon\" for the public key.");
    }
    if (payload.exp) {
      const days = Math.round((payload.exp * 1000 - Date.now()) / 86400000);
      if (days < 0) bad(`Key expired ${-days} days ago`);
      // A key with days to run is a trap: it works today and fails in class.
      else if (days < 30) warn(`Key expires in ${days} day(s)`, "Generate a long-lived key — these normally run for 10 years.");
      else ok(`Expires in ${days} days`);
    }
  } catch {
    bad("Could not decode the key payload");
  }
}

/* --------------------------------------------------- 3. reachability -- */
console.log("\n3. Reachability");
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function get(path, extra = {}) {
  const res = await fetch(`${base}${path}`, { headers: { ...headers, ...extra } });
  const text = await res.text();
  return { status: res.status, text, type: res.headers.get("content-type") || "" };
}

let reachable = false;
try {
  const health = await get("/auth/v1/health");
  if (health.status === 200) {
    reachable = true;
    ok("GoTrue (auth) is up", health.text.slice(0, 120));
  } else if (health.status === 401) {
    bad(
      "401 from /auth/v1/health",
      "The anon key is not signed with the JWT_SECRET this stack was deployed with. Regenerate both together."
    );
  } else {
    bad(`/auth/v1/health returned ${health.status}`, health.text.slice(0, 160));
  }
} catch (e) {
  bad(
    "Cannot reach the host",
    `${e.cause?.code || e.message}. Check DNS, that the stack is running, and that the domain points at Kong.`
  );
}

if (reachable) {
  const rest = await get("/rest/v1/");
  if (rest.type.includes("text/html")) {
    bad("PostgREST returned HTML", "That domain is probably Studio or a proxy, not Kong on port 8000.");
  } else if (rest.status === 200) {
    ok("PostgREST (database API) is up");
  } else {
    bad(`/rest/v1/ returned ${rest.status}`, rest.text.slice(0, 160));
  }
}

/* --------------------------------------------------- 4. the schema --- */
if (reachable) {
  console.log("\n4. Schema");
  const tables = ["profiles", "user_roles", "module_progress", "builds"];
  let missing = 0;
  for (const t of tables) {
    const r = await get(`/rest/v1/${t}?select=*&limit=1`);
    if (r.status === 200) ok(`table ${t}`);
    else if (r.status === 404) { missing++; bad(`table ${t} is missing`); }
    else if (r.status === 401) bad(`table ${t}: 401`, "Key/secret mismatch.");
    else warn(`table ${t}: ${r.status}`, r.text.slice(0, 120));
  }
  const view = await get("/rest/v1/class_roster?select=*&limit=1");
  view.status === 200 ? ok("view class_roster") : bad("view class_roster is missing");

  if (missing) {
    bad(
      `${missing} object(s) missing`,
      "Run supabase/schema.sql in Studio -> SQL Editor."
    );
  }

  /* --------------------------------------------- 5. RLS actually on -- */
  console.log("\n5. Row level security");
  const anonRead = await get("/rest/v1/profiles?select=id");
  if (anonRead.status === 200) {
    let rows = [];
    try { rows = JSON.parse(anonRead.text); } catch {}
    if (rows.length === 0) {
      ok(
        "Anonymous read of profiles returns nothing",
        "Correct. Re-run this after a student signs up to confirm — an empty table looks the same either way."
      );
    } else {
      bad(
        `RLS IS OFF — anonymous read returned ${rows.length} profile row(s)`,
        "Anyone with the anon key (i.e. anyone who views source) can read your students' data. Run schema.sql, which enables RLS on every table."
      );
    }
  } else if (anonRead.status === 401 || anonRead.status === 403) {
    ok("Anonymous read is denied");
  }
}

/* ------------------------------------------------------- summary ---- */
console.log("\n" + "=".repeat(38));
if (failures === 0 && warnings === 0) {
  console.log(`${GREEN}Everything checks out.${OFF} Run "npm run dev" and open the Account tab to sign up.\n`);
} else if (failures === 0) {
  console.log(`${YEL}Usable, with ${warnings} warning(s) above.${OFF}\n`);
} else {
  console.log(`${RED}${failures} problem(s) to fix${OFF}${warnings ? `, plus ${warnings} warning(s)` : ""}.\n`);
  process.exit(1);
}
