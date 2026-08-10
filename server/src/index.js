import "dotenv/config";
import express from "express";
import cors from "cors";

import { assertConfigured } from "./supabase.js";
import { requireAuth } from "./auth.js";
import studentRoutes from "./routes/student.js";
import teacherRoutes from "./routes/teacher.js";
import schoolRoutes from "./routes/school.js";
import adminRoutes from "./routes/admin.js";

/**
 * DRONELAB PORTAL API
 * ===================
 * Fails fast if it is misconfigured. An API that starts happily without a
 * service role key and then 500s on the first admin request is much harder
 * to diagnose than one that refuses to boot and says which variable is
 * missing.
 */
assertConfigured();

/**
 * SELF-SIGNED TLS ESCAPE HATCH — local development only.
 *
 * A self-hosted Supabase behind a reverse proxy with no certificate issued
 * yet serves the proxy's default self-signed cert, and Node refuses the
 * connection outright. That is Node behaving correctly: an unverified
 * certificate means the connection could be intercepted, and this one
 * carries a service role key.
 *
 * Setting ALLOW_SELF_SIGNED_TLS=true turns verification off so you can work
 * against your own server while the certificate is being sorted out. It is
 * refused outright in production, and it announces itself loudly, because
 * the failure mode it enables is silent: everything keeps working and
 * nothing tells you the connection is no longer authenticated.
 */
if (process.env.ALLOW_SELF_SIGNED_TLS === "true") {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ALLOW_SELF_SIGNED_TLS cannot be used with NODE_ENV=production. " +
        "Issue a real certificate for your Supabase domain instead."
    );
  }
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.warn(
    [
      "",
      "  !!  TLS certificate verification is OFF (ALLOW_SELF_SIGNED_TLS=true).",
      "  !!  Local development only. Remove this before deploying.",
      "",
    ].join("\n")
  );
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

/* CORS is an allow-LIST, not a wildcard. These endpoints are reached with a
   bearer token from a browser, and `origin: true` would let any site on the
   internet call them with a token it had managed to obtain.

   One concession: an entry may start with `*` to match a suffix. Vercel gives
   every branch and every deployment its own URL, and — importantly — those are
   NOT subdomains. `drone-lab-fgev-git-main-my-team.vercel.app` is a single
   hostname label joined by hyphens, so a subdomain rule can never match it and
   every preview deploy fails with a CORS error that looks like the backend is
   down.

   So the suffix is matched literally, INCLUDING its leading separator. That
   separator is what makes it safe:

     *-my-team.vercel.app   matches  anything-my-team.vercel.app
                            rejects  my-team.vercel.app.attacker.com
     *.example.com          matches  api.example.com
                            rejects  evil-example.com

   A pattern must therefore begin `*.` or `*-`; a bare `*` or `*foo` is refused
   at startup rather than silently allowing far more than intended. */
const allowed = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const exact = new Set(allowed.filter((a) => !a.startsWith("*")));
const suffixes = [];
for (const a of allowed) {
  if (!a.startsWith("*")) continue;
  const rest = a.slice(1);
  if (!/^[.-]/.test(rest)) {
    /* Skip it loudly rather than refusing to boot.
       An earlier version threw here, which meant one mistyped character in an
       allow-list took the entire API offline — every route, for every user,
       including the ones that had nothing to do with CORS. Failing fast is
       right for the Supabase keys, because nothing works without them. It is
       badly wrong here: the rest of the service is perfectly functional, and a
       dead API is far harder to diagnose than a rejected origin. */
    console.error(
      `[api] IGNORING CORS pattern "${a}" — no separator after the "*". ` +
        `Use "*.example.com" or "*-my-team.vercel.app", so the match cannot be ` +
        `satisfied by an unrelated domain. Requests from that origin will be refused.`
    );
    continue;
  }
  suffixes.push(rest);
}

function originAllowed(origin) {
  if (exact.has(origin)) return true;
  if (!suffixes.length) return false;
  let host;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false; // patterns are https-only
    host = u.host;
  } catch {
    return false;
  }
  return suffixes.some((s) => host.endsWith(s));
}

app.use(
  cors({
    origin(origin, cb) {
      // Same-origin and server-to-server requests send no Origin header
      if (!origin) return cb(null, true);
      const ok = originAllowed(origin);
      if (!ok) console.warn(`[api] CORS rejected origin: ${origin}`);
      cb(null, ok);
    },
    credentials: true,
  })
);

/* A PREFLIGHT IS A QUESTION, NOT A REQUEST.
   OPTIONS carries no credentials — the browser sends it precisely to ask
   whether the real request is permitted — so it must never reach requireAuth.

   It was reaching it. When the cors() origin callback declines, it adds no
   headers but does not end the request either, so the preflight fell through to
   the auth gate below and came back 401. The browser then reports only "no
   Access-Control-Allow-Origin", and a developer reading the network tab sees a
   401 on /api/me and goes looking for a broken token. The cause was an origin
   that was not on the list, which nothing in that exchange said.

   Now it answers here, and says which origin was refused. */
app.use((req, res, next) => {
  if (req.method !== "OPTIONS") return next();
  if (res.getHeader("Access-Control-Allow-Origin")) return res.sendStatus(204);
  return res.status(403).json({
    error:
      `Origin ${req.headers.origin ?? "(none)"} is not on this API's allowed list. ` +
      `Add it to CORS_ORIGINS and restart.`,
    code: "origin_not_allowed",
  });
});

/** Unauthenticated, so a load balancer can use it. */
app.get("/health", (_req, res) => res.json({ ok: true, service: "dronelab-api" }));

app.use("/api", requireAuth);
app.use("/api", studentRoutes);
app.use("/api/teacher", teacherRoutes);
app.use("/api/school", schoolRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
app.use((err, _req, res, _next) => {
  /* A 4xx we set ourselves is safe to pass on, and is the only kind worth
     passing on: it describes what the caller did wrong, in words we wrote. A
     mistyped date should not read as the server falling over. Anything without
     an explicit status is unexpected, and falls through to the opaque 500
     below. */
  if (err?.status >= 400 && err.status < 500 && typeof err.message === "string") {
    return res.status(err.status).json({ error: err.message });
  }

  console.error("[api]", err);
  /* Never return err.message to the client. Supabase and Postgres errors
     routinely name tables, columns and constraints, which hands an attacker
     a free schema dump. The detail goes to the log; the caller gets a
     reference. */
  const ref = Math.random().toString(36).slice(2, 8);
  console.error(`[api] ref=${ref}`);
  res.status(500).json({ error: `Something went wrong. Reference: ${ref}` });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`DroneLab API listening on http://localhost:${port}`);
  console.log(`CORS allow-list: ${allowed.join(", ")}`);
});
