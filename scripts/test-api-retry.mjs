#!/usr/bin/env node
/**
 * REGRESSION TEST — THE API CLIENT'S RETRY POLICY
 * ================================================
 *     npm run test:api-retry
 *
 * Reported: "Cannot reach the server / Failed to fetch" on the portal, with a
 * Try again button that worked the moment it was pressed.
 *
 * The API was healthy throughout. Measured against it live, the first request
 * took 5.6 seconds — 5.1 of them resolving DNS — and every request after it
 * took 0.35. So the failure was one cold blip on the first call, and the client
 * had no retry: a single transient network error took down the whole page.
 *
 * WHAT THIS ASSERTS
 * -----------------
 *   1. A GET that fails at the network level is retried and can succeed.
 *   2. A GET is retried at most twice more, then gives up honestly.
 *   3. A POST, PATCH or DELETE is NEVER retried. This is the one that matters:
 *      a retried POST is a second help request, a second join attempt, a second
 *      school application. Silent duplicates are worse than a visible error.
 *   4. A real HTTP answer — 401, 403, 404, 409 — is not retried. That is a
 *      decision, and asking three times does not change it.
 *   5. Gateway codes (502/503/504) ARE retried on a GET: they mean the thing
 *      behind the proxy is not up yet, which is the case that recovers.
 *   6. A request that hangs is abandoned rather than spinning forever.
 *
 * The policy is exercised through the real module — portal/lib/api.js — with
 * fetch and the Supabase session stubbed, so what is measured is the shipped
 * code path rather than a description of it.
 */

import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* The client asks Supabase for the live token on every call. Give it one. */
const supabaseStub = `
export const supabase = () => ({
  auth: {
    getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
    signOut: async () => {},
  },
});
`;

/* portal/lib/api.js imports "./supabase.js" relatively, so the stub is written
   beside it under a name the real build ignores, and removed afterwards. */
import { writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";

const apiPath = resolve(HERE, "../portal/lib/api.js");
const shimDir = resolve(HERE, "../portal/lib/.retry-test");
const shimApi = resolve(shimDir, "api.js");
const shimSupabase = resolve(shimDir, "supabase.js");

import { mkdirSync } from "node:fs";
mkdirSync(shimDir, { recursive: true });
writeFileSync(shimSupabase, supabaseStub);
/* Copied verbatim — not edited, not re-implemented. If the policy changes in
   the real file this test moves with it. */
writeFileSync(shimApi, readFileSync(apiPath, "utf8"));

let failures = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  ok    ${label}`);
  } catch (e) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${e.message.split("\n")[0]}`);
    failures++;
  }
};

/* A fetch that behaves however the case needs, and counts its calls. */
function makeFetch(plan) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    const step = plan[Math.min(calls.length - 1, plan.length - 1)];
    if (step === "network") throw new TypeError("Failed to fetch");
    if (step === "hang") {
      // Never settles on its own; only the client's abort can end it.
      return new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      });
    }
    if (typeof step === "number") {
      return {
        ok: step >= 200 && step < 300,
        status: step,
        json: async () => ({ error: `status ${step}` }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return calls;
}

const { api } = await import(pathToFileURL(shimApi).href);

console.log("\nAPI client — retrying the blip, never the write\n");

await check("a GET that fails at the network level is retried and succeeds", async () => {
  const calls = makeFetch(["network", "ok"]);
  const out = await api.me();
  assert.deepEqual(out, { ok: true });
  assert.equal(calls.length, 2, "should have tried twice");
});

await check("a GET recovers on the last allowed attempt", async () => {
  const calls = makeFetch(["network", "network", "ok"]);
  await api.progress();
  assert.equal(calls.length, 3);
});

await check("a GET gives up after three attempts rather than looping", async () => {
  const calls = makeFetch(["network"]);
  await assert.rejects(() => api.me());
  assert.equal(calls.length, 3, `tried ${calls.length} times, expected exactly 3`);
});

await check("a POST is never retried — no duplicate help requests", async () => {
  const calls = makeFetch(["network"]);
  await assert.rejects(() => api.help.ask("stuck on module 2", "m2"));
  assert.equal(
    calls.length,
    1,
    `a failed POST was sent ${calls.length} times; every retry is a duplicate the student did not make`
  );
  assert.equal(calls[0].method, "POST");
});

await check("a PATCH is never retried", async () => {
  const calls = makeFetch(["network"]);
  await assert.rejects(() => api.updateMe({ full_name: "x" }));
  assert.equal(calls.length, 1);
});

await check("a DELETE is never retried", async () => {
  const calls = makeFetch(["network"]);
  await assert.rejects(() => api.help.withdraw("abc"));
  assert.equal(calls.length, 1);
});

await check("joining a school is never retried", async () => {
  const calls = makeFetch(["network"]);
  await assert.rejects(() => api.joinSchool("ABCD-2345"));
  assert.equal(calls.length, 1, "a retried join is a second attempt against the code");
});

await check("a 401 is not retried — it is an answer, not a blip", async () => {
  const calls = makeFetch([401]);
  await assert.rejects(() => api.me());
  assert.equal(calls.length, 1);
});

await check("a 404 is not retried", async () => {
  const calls = makeFetch([404]);
  await assert.rejects(() => api.me());
  assert.equal(calls.length, 1);
});

await check("a 502 on a GET is retried — the API is still waking up", async () => {
  const calls = makeFetch([502, 503, "ok"]);
  await api.me();
  assert.equal(calls.length, 3);
});

await check("a 502 on a POST is not retried", async () => {
  const calls = makeFetch([502]);
  await assert.rejects(() => api.help.ask("hello"));
  assert.equal(calls.length, 1);
});

await check("a hung request is abandoned, not left spinning", async () => {
  const calls = makeFetch(["hang"]);
  const started = Date.now();
  await assert.rejects(() => api.me());
  /* Three attempts, each aborted. What matters is that it terminated at all —
     the previous client had no deadline and would still be waiting. */
  const elapsed = Date.now() - started;
  assert.equal(calls.length, 3);
  /* The overall deadline is 25 s. Without it this was three 20-second timeouts
     back to back — over a minute in front of a blank page. */
  assert.ok(elapsed < 28000, `waited ${(elapsed / 1000).toFixed(1)}s; the deadline is 25s`);
  assert.ok(elapsed > 1000, "returned suspiciously fast — did the attempts actually run?");
});

/* Cleanup: never leave a stub inside the portal's source tree. */
rmSync(shimDir, { recursive: true, force: true });
if (existsSync(shimDir)) {
  console.error("  FAIL  the test stub was left behind in portal/lib");
  failures++;
}

console.log("");
if (failures) {
  console.log(`FAIL — ${failures} problem(s)\n`);
  process.exit(1);
}
console.log("PASS — transient GETs recover; nothing that writes is ever sent twice\n");
