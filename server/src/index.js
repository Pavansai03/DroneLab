import "dotenv/config";
import express from "express";
import cors from "cors";

import { assertConfigured } from "./supabase.js";
import { requireAuth } from "./auth.js";
import studentRoutes from "./routes/student.js";
import teacherRoutes from "./routes/teacher.js";
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

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

/* CORS is an allow-LIST, not a wildcard. These endpoints are reached with a
   bearer token from a browser, and `origin: true` would let any site on the
   internet call them with a token it had managed to obtain. */
const allowed = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Same-origin and server-to-server requests send no Origin header
      if (!origin) return cb(null, true);
      cb(null, allowed.includes(origin));
    },
    credentials: true,
  })
);

/** Unauthenticated, so a load balancer can use it. */
app.get("/health", (_req, res) => res.json({ ok: true, service: "dronelab-api" }));

app.use("/api", requireAuth);
app.use("/api", studentRoutes);
app.use("/api/teacher", teacherRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
app.use((err, _req, res, _next) => {
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
