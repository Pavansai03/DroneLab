#!/usr/bin/env node
/**
 * ONE DEPLOYMENT, TWO APPLICATIONS
 * ================================
 * Builds the Vite simulator, drops it into the Next.js app's `public/sim`, and
 * leaves Next to build on top. The result is a single Vercel project serving
 * the portal at `/` and the simulator at `/sim`.
 *
 * WHY BOTHER
 * ----------
 * They were two Vercel projects on two origins, which meant two URLs — and once
 * one of them had a real domain, the other still sent students to a
 * `vercel.app` address. Same origin also removes the reason the session handoff
 * exists at all: browsers isolate storage per origin, so the portal had to pass
 * its tokens to the simulator through the URL fragment. On one origin they
 * simply share it.
 *
 * WHY A SCRIPT AND NOT A BUILD COMMAND
 * ------------------------------------
 * The copy has to happen between the two builds, and it has to be exact —
 * `public/sim` must contain only what this build produced. A stale asset left
 * behind from a previous build is served happily by Vercel and matches no
 * hashed filename anyone requests, which fails as a blank page rather than as a
 * build error. So the directory is removed first, every time.
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const target = resolve(root, "portal", "public", "sim");

const run = (cmd, cwd, env = {}) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
};

/* 1 — the simulator.
   BASE_PATH tells Vite to emit /sim/assets/... instead of /assets/..., because
   the app no longer sits at the root of its origin. Without it every asset URL
   is absolute to `/` and resolves into the portal, which answers with a 404
   page and no explanation. */
run("npm run build", root, { BASE_PATH: "/sim/" });

if (!existsSync(dist)) {
  console.error("\nThe simulator build produced no dist/ — stopping before it is copied.");
  process.exit(1);
}

/* 2 — hand it to Next.
   Removed first: see the note at the top about stale hashed assets. */
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, target, { recursive: true });
console.log(`\nCopied ${readdirSync(dist).length} entries -> portal/public/sim`);

/* 3 — the portal, which now has the simulator inside its public directory and
   will serve it as static files at /sim. */
run("npm run build", resolve(root, "portal"));

console.log("\nBoth applications built. Portal at /, simulator at /sim.");
