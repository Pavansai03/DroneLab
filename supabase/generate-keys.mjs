#!/usr/bin/env node
/**
 * Generate the secrets the Dokploy Supabase template needs.
 *
 *   node supabase/generate-keys.mjs
 *
 * ANON_KEY and SERVICE_ROLE_KEY are NOT random strings — they are HS256 JWTs
 * signed with JWT_SECRET. If they are not signed with the same secret the stack
 * is given, every API call returns 401 and the cause is not obvious. That is the
 * single most common way a self-hosted Supabase ends up half-working.
 *
 * No dependencies: Node's built-in crypto does everything needed.
 *
 * The output is SECRET. SERVICE_ROLE_KEY bypasses Row Level Security entirely —
 * treat it like a root password. Do not commit it, and do not paste it into a
 * chat, an issue or a support thread.
 */

import { createHmac, randomBytes } from "node:crypto";

const b64url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Sign an HS256 JWT the way Supabase expects. */
function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = b64url(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

/** Alphanumeric only: some of these land in shell and YAML contexts where
    punctuation needs escaping, and a stray quote breaks the whole stack. */
function alnum(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

const jwtSecret = alnum(48); // Supabase requires at least 32
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 60 * 60 * 24 * 365 * 10; // 10 years

const anonKey = signJwt({ role: "anon", iss: "supabase", iat, exp }, jwtSecret);
const serviceKey = signJwt({ role: "service_role", iss: "supabase", iat, exp }, jwtSecret);

const out = {
  JWT_SECRET: jwtSecret,
  ANON_KEY: anonKey,
  SERVICE_ROLE_KEY: serviceKey,
  POSTGRES_PASSWORD: alnum(32),
  SECRET_KEY_BASE: alnum(64), // Realtime + Supavisor, min 64
  VAULT_ENC_KEY: alnum(32), // exactly 32
  REALTIME_DB_ENC_KEY: alnum(16), // exactly 16
  PG_META_CRYPTO_KEY: alnum(32), // min 32
  DASHBOARD_USERNAME: "supabase",
  DASHBOARD_PASSWORD: alnum(24), // Studio basic auth — must be changed from default
  LOGFLARE_API_KEY: alnum(32),
  LOGFLARE_PUBLIC_ACCESS_TOKEN: alnum(32),
  LOGFLARE_PRIVATE_ACCESS_TOKEN: alnum(32),
};

console.log("\n# ============================================================");
console.log("# Paste into the Supabase template's Environment tab in Dokploy.");
console.log("# KEEP THESE SECRET. SERVICE_ROLE_KEY bypasses row level security.");
console.log("# ============================================================\n");
for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);

console.log(`
# ------------------------------------------------------------
# Still to set by hand — they depend on YOUR domains:
#
#   SUPABASE_PUBLIC_URL=https://<kong-domain>
#   API_EXTERNAL_URL=https://<kong-domain>
#   SITE_URL=https://<dronelab-domain>
#   ADDITIONAL_REDIRECT_URLS=https://<dronelab-domain>
#   DOCKER_SOCKET_LOCATION=/var/run/docker.sock
#   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_ADMIN_EMAIL
#
# Then DroneLab is built with:
#   VITE_SUPABASE_URL=https://<kong-domain>
#   VITE_SUPABASE_ANON_KEY=<the ANON_KEY above>
# ------------------------------------------------------------
`);
