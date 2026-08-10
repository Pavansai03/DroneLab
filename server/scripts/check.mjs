#!/usr/bin/env node
/**
 * PRE-FLIGHT CHECK FOR THE API
 * ============================
 *     npm run check          (in server/)
 *
 * Runs automatically before `npm start`, so a container refuses to start with
 * a clear message instead of crash-looping behind a 502.
 *
 * WHY THIS EXISTS
 * ---------------
 * A stray `.maybeSingle();` left attached to nothing in one route file took the
 * entire API down for the best part of an hour. Node parses a module when it is
 * first imported, so a syntax error anywhere under src/ kills the process at
 * boot — not just the route it is in. And the failure surfaced in a browser as
 * "no Access-Control-Allow-Origin", because a 502 comes from the proxy and
 * carries no CORS headers, which sent everyone looking at the allow-list.
 *
 * One second here would have caught it.
 *
 * THREE PASSES, BECAUSE EACH CATCHES WHAT THE LAST CANNOT
 * -------------------------------------------------------
 * 1. Every file under src/ is parsed. Catches a syntax error in a file the
 *    entry point only reaches indirectly.
 * 2. Every router is asked what routes it declares. Catches a router that
 *    silently exports nothing — which probing the running API cannot, because
 *    requireAuth sits in front of everything under /api and an unmounted route
 *    answers 401 exactly like a mounted one. A sweep of 401s looks like proof
 *    and is not.
 * 3. The server is actually started and asked for /health. Catches a bad import
 *    path, a missing export, a module that throws while being evaluated.
 *    Placeholder credentials are enough — it only needs to boot and answer.
 */

import { execFileSync, spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const PORT = 45871; // high and specific, so it cannot collide with a dev server

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith(".js") || name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

/* ------------------------------------------------------- 1. parse everything */
const files = jsFiles(SRC);
const broken = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    broken.push({ file, message: String(err.stderr || err.message).trim() });
  }
}

if (broken.length) {
  console.error(`\n${broken.length} of ${files.length} files do not parse:\n`);
  for (const b of broken) {
    console.error(`  ${b.file.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
    console.error(
      b.message
        .split("\n")
        .slice(0, 6)
        .map((l) => `      ${l}`)
        .join("\n")
    );
    console.error("");
  }
  process.exit(1);
}
console.log(`parsed ${files.length} files, all fine`);

/* ------------------------------------------------- 2. every route is mounted */
/* Walking the routers' own stacks, because probing the running API cannot tell
   you this: requireAuth sits in front of everything under /api, so a route that
   was never mounted answers 401 exactly like one that was. A 401 sweep looks
   like proof and is not. */
{
  const mounts = [
    ["/api", "../src/routes/student.js"],
    ["/api/teacher", "../src/routes/teacher.js"],
    ["/api/school", "../src/routes/school.js"],
    ["/api/admin", "../src/routes/admin.js"],
  ];

  let total = 0;
  const empty = [];
  for (const [base, rel] of mounts) {
    const mod = await import(new URL(rel, import.meta.url));
    const layers = (mod.default?.stack ?? []).filter((l) => l.route);
    if (!layers.length) empty.push(base);
    total += layers.length;
  }

  if (empty.length) {
    console.error(`
These routers declare no routes at all: ${empty.join(", ")}`);
    process.exit(1);
  }
  console.log(`${total} routes across ${mounts.length} routers`);
}

/* --------------------------------------------------------- 3. actually boot */
/* Placeholder credentials. The point is to evaluate every module and bind the
   port, not to reach a database — and using real ones would make a routine
   check depend on the network being up. */
const child = spawn(process.execPath, [join(SRC, "index.js")], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(PORT),
    SUPABASE_URL: "http://localhost:1",
    SUPABASE_ANON_KEY: "check",
    SUPABASE_SERVICE_ROLE_KEY: "check",
    CORS_ORIGINS: "http://localhost:3000",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));

const done = (code, msg) => {
  child.kill();
  if (msg) console.error(msg);
  process.exit(code);
};

child.on("exit", (code) => {
  /* Exiting at all is a failure: it should still be listening when we ask. */
  done(1, `\nThe API exited during startup (code ${code}):\n\n${output.trim()}\n`);
});

/* Poll rather than sleep a fixed time — fast when it is fine, and it still
   reports the real output if it never comes up. */
const deadline = Date.now() + 15000;
(async function waitForHealth() {
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      const body = await res.json();
      if (res.ok && body?.ok) {
        console.log(`booted and answered /health as "${body.service}"`);
        done(0);
      }
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      done(1, `\nThe API did not answer /health within 15s:\n\n${output.trim()}\n`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
})();
