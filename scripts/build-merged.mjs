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
import { cpSync, existsSync, rmSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const target = resolve(root, "portal", "public", "sim");

const run = (cmd, cwd, env = {}) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
};

/* 1 — the simulator's own dependencies.
   Vercel installs in the project's Root Directory, which is `portal/` — so the
   portal's packages are there and the repository root's are not. Vite lives at
   the root, and `npm run build` there fails in about a second with "vite: not
   found", which reads like a broken build command rather than a missing
   install. Nothing else in the pipeline can succeed without this.

   --include=dev is not optional here, however redundant it looks. Vercel sets
   NODE_ENV=production, and npm honours that by omitting devDependencies — which
   is where vite is. Without the flag the install "succeeds", installs no build
   tooling at all, and the next line dies with the very "vite: not found" this
   step exists to prevent.

   Skipped when the modules are already present, so running this locally does
   not reinstall on every build. `npm ci` when there is a lockfile, because it
   is both faster and reproducible; `npm install` if that fails, which happens
   when the lockfile has drifted from package.json. */
if (!existsSync(resolve(root, "node_modules", "vite"))) {
  console.log("\nInstalling the simulator's dependencies (root package.json)…");
  const lock = existsSync(resolve(root, "package-lock.json"));
  try {
    run(lock ? "npm ci --include=dev" : "npm install --include=dev", root);
  } catch {
    console.log("\nnpm ci failed — falling back to npm install.");
    run("npm install --include=dev", root);
  }

  /* Checked here rather than left to fail obscurely two lines down. An install
     that quietly omitted the build tooling is the exact failure this block
     exists for, and it deserves a sentence rather than a stack trace. */
  if (!existsSync(resolve(root, "node_modules", "vite"))) {
    console.error(
      "\nInstalled, but vite is still missing — devDependencies were omitted.\n" +
        `NODE_ENV is "${process.env.NODE_ENV}", and the build tooling lives in devDependencies.`
    );
    process.exit(1);
  }
}

/* 2 — the simulator.
   BASE_PATH tells Vite to emit /sim/assets/... instead of /assets/..., because
   the app no longer sits at the root of its origin. Without it every asset URL
   is absolute to `/` and resolves into the portal, which answers with a 404
   page and no explanation. */
run("npm run build", root, { BASE_PATH: "/sim/" });

if (!existsSync(dist)) {
  console.error("\nThe simulator build produced no dist/ — stopping before it is copied.");
  process.exit(1);
}

/* 3 — hand it to Next.
   Removed first: see the note at the top about stale hashed assets. */
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, target, { recursive: true });

/* Rewrite the ignore file the wipe just removed.
   Re-created rather than preserved: wiping the directory is the whole point of
   this step, and carving out an exception would be one more thing to get wrong.
   Written by the script rather than committed once, so it cannot go missing —
   the first build after the wipe put a 1.1MB bundle into a commit. */
writeFileSync(
  resolve(target, ".gitignore"),
  [
    "# Written by scripts/build-merged.mjs. Nothing here is authored by hand.",
    "# The filenames are content-hashed and change every build, so committing",
    "# them means endless meaningless diffs, and stale assets shipping beside",
    "# fresh ones.",
    "*",
    "!.gitignore",
    "",
  ].join("\n")
);

console.log(`\nCopied ${readdirSync(dist).length} entries -> portal/public/sim`);

/* 3b — the brand assets, for the portal itself.
   The simulator's copy arrives inside dist/, but the portal's own pages need
   them at /brand/... on the site root. Copied from the one source rather than
   committed twice, so updating the logo means replacing a single file. */
{
  const brandSrc = resolve(root, "public", "brand");
  const brandDst = resolve(root, "portal", "public", "brand");
  if (existsSync(brandSrc)) {
    rmSync(brandDst, { recursive: true, force: true });
    cpSync(brandSrc, brandDst, { recursive: true });
    writeFileSync(
      resolve(brandDst, ".gitignore"),
      "# Copied from public/brand by scripts/build-merged.mjs.\n*\n!.gitignore\n"
    );
    console.log("Copied brand assets -> portal/public/brand");
  }
}

/* 4 — the portal, which now has the simulator inside its public directory and
   will serve it as static files at /sim. */
run("npm run build", resolve(root, "portal"));

console.log("\nBoth applications built. Portal at /, simulator at /sim.");
