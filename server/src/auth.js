import { adminClient, userClient } from "./supabase.js";

/**
 * AUTHENTICATION AND ROLE GATES
 * =============================
 * The browser sends the Supabase access token as a bearer token. We do not
 * decode or trust it ourselves — `auth.getUser(token)` asks Supabase to
 * verify the signature and expiry. Parsing the JWT locally without
 * verifying it is the classic way to build an auth system that anyone can
 * walk straight through by editing a claim.
 *
 * The ROLE is then read from the database, never from the token. Supabase
 * puts custom claims in the JWT only if you configure it to, and a claim
 * baked in at sign-in time goes stale the moment an admin changes someone's
 * role. Reading `user_roles` per request costs one indexed lookup and is
 * always current.
 */

/** Populates req.auth = { user, token, role, schoolId }. 401 if not signed in. */
export async function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: "Not signed in." });
  }

  try {
    // Verified by Supabase, not by us.
    const admin = adminClient();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Session expired or invalid." });
    }

    const userId = data.user.id;
    const [{ data: roleRow }, { data: profile }] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      admin.from("profiles").select("school_id, full_name").eq("id", userId).maybeSingle(),
    ]);

    req.auth = {
      user: data.user,
      token,
      role: roleRow?.role ?? "student",
      schoolId: profile?.school_id ?? null,
      fullName: profile?.full_name ?? null,
      // Convenience: a client bound to this caller, so routes get RLS for free
      db: userClient(token),
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Require one of the given roles.
 *
 * Ordinary reads do not need this — RLS already scopes them, and a role
 * check on top would only duplicate it. This exists for the routes that use
 * the service role, where the database has been told to stop checking and
 * something else has to.
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: "Not signed in." });
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({
        error: `This needs the ${roles.join(" or ")} role. You are signed in as ${req.auth.role}.`,
      });
    }
    next();
  };
}

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
