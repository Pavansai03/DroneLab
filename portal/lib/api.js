"use client";

import { supabase } from "./supabase.js";

/**
 * The Express API client.
 *
 * Every call attaches the CURRENT access token, fetched at call time rather
 * than captured once. Supabase rotates the token roughly hourly; a client
 * that grabbed it at mount would start returning 401s partway through a
 * lesson, which is exactly the sort of failure that looks random.
 */

const base = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/** Where this build points its API calls. Shown in error states, because
    "cannot reach the server" is not actionable without knowing which one. */
export const apiUrl = base;

/**
 * RETRYING THE FIRST REQUEST
 * ==========================
 * "Failed to fetch" is what a browser says when the request never reached the
 * server at all — DNS, TLS, or a connection that was refused. It is usually
 * transient, and it was fatal here: one blip on the very first call and the
 * whole portal rendered "Cannot reach the server", with a Try again button that
 * worked perfectly if the student thought to press it.
 *
 * Measured against the live API, a cold first lookup took 5.6 seconds — 5.1 of
 * them in DNS — and every request after it took 0.35. That is precisely the
 * shape a retry fixes, and precisely the shape the error card was describing
 * when it said the API might be "asleep and still waking up".
 *
 * ONLY GET. A retried POST is a second help request, a second join attempt, a
 * second application. Idempotency is not a detail to assume, so anything that
 * changes state fails on the first attempt exactly as it always did.
 *
 * NOT RETRIED EITHER: anything the server actually answered with. A 401, a 403
 * or a 404 is a decision, and asking three times does not change it. A blocked
 * CORS preflight also lands here as a network error and will be retried twice —
 * that is a few wasted milliseconds on a request that was going to fail anyway,
 * which is a fair price for the case that recovers.
 */
const RETRY = {
  /** Attempts in total, first one included. */
  ATTEMPTS: 3,
  /** Per-attempt ceiling. A cold DNS lookup measured 5.1 s on its own, so this
      has to clear that comfortably — a timeout tighter than reality turns a
      slow load into a failed one. */
  TIMEOUT_MS: 8000,
  /** Ceiling on the WHOLE thing, retries and backoff included.
      Without it the worst case is every attempt timing out in series, and a
      student who has hit something genuinely unreachable sits in front of a
      blank page for a minute before being told. Better to give up at a
      believable moment and show the error, which has a Try again on it. */
  DEADLINE_MS: 25000,
  /** Waits between attempts. */
  BACKOFF_MS: [400, 1200],
  /** Gateway codes that mean "the thing behind the proxy is not up yet". */
  STATUS: new Set([502, 503, 504]),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with a deadline, so a hung connection cannot spin forever. */
async function fetchWithTimeout(url, init, budgetMs) {
  if (typeof AbortController === "undefined") return fetch(url, init);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(1, budgetMs));
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, init, retryable) {
  const startedAt = Date.now();
  const left = () => RETRY.DEADLINE_MS - (Date.now() - startedAt);
  const attempts = retryable ? RETRY.ATTEMPTS : 1;

  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const wait = RETRY.BACKOFF_MS[attempt - 1] ?? 1200;
      if (left() <= wait) break;
      await sleep(wait);
    }
    if (attempt > 0 && left() <= 0) break;

    try {
      const res = await fetchWithTimeout(
        url,
        init,
        Math.min(RETRY.TIMEOUT_MS, retryable ? left() : RETRY.TIMEOUT_MS)
      );
      if (
        retryable &&
        RETRY.STATUS.has(res.status) &&
        attempt < attempts - 1 &&
        left() > 0
      ) {
        continue;
      }
      return res;
    } catch (err) {
      // Network-level: DNS, TLS, refused, or our own abort on timeout.
      lastError = err;
    }
  }
  throw lastError ?? new Error("Failed to fetch");
}

async function request(path, { method = "GET", body } = {}) {
  const {
    data: { session },
  } = await supabase().auth.getSession();

  if (!session) {
    const err = new Error("You are signed out.");
    err.status = 401;
    throw err;
  }

  const res = await fetchWithRetry(
    `${base()}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    method === "GET"
  );

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* A 502 from a proxy has no JSON body; fall through to the status text. */
  }

  if (!res.ok) {
    /* Signed in somewhere else. Clearing the local session here rather than
       letting the caller decide means every page gets the same behaviour for
       free: the next thing the student sees is the login screen with a reason,
       not a panel full of failed requests. */
    if (payload?.code === "session_superseded") {
      try {
        await supabase().auth.signOut();
      } catch {
        /* Already gone; the redirect below is what matters. */
      }
      if (typeof window !== "undefined") {
        window.location.href = `/login?error=${encodeURIComponent(payload.error)}`;
      }
    }

    const err = new Error(payload?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export const api = {
  me: () => request("/api/me"),
  updateMe: (patch) => request("/api/me", { method: "PATCH", body: patch }),
  joinSchool: (join_code) => request("/api/me/school", { method: "POST", body: { join_code } }),
  progress: () => request("/api/progress"),

  help: {
    mine: () => request("/api/help"),
    ask: (message, module_id) => request("/api/help", { method: "POST", body: { message, module_id } }),
    withdraw: (id) => request(`/api/help/${id}`, { method: "DELETE" }),
  },

  school: {
    apply: (body) => request("/api/school/apply", { method: "POST", body }),
    application: () => request("/api/school/application"),
  },

  teacher: {
    school: () => request("/api/teacher/school"),
    roster: (schoolId) => request(`/api/teacher/roster${schoolId ? `?school=${schoolId}` : ""}`),
    student: (id) => request(`/api/teacher/students/${id}`),
    help: (schoolId) => request(`/api/teacher/help${schoolId ? `?school=${schoolId}` : ""}`),
    answerHelp: (id, reply, status) =>
      request(`/api/teacher/help/${id}`, { method: "POST", body: { reply, status } }),
  },

  admin: {
    stats: () => request("/api/admin/stats"),
    applications: (status) =>
      request(`/api/admin/applications${status ? `?status=${status}` : ""}`),
    approve: (id, body) => request(`/api/admin/applications/${id}/approve`, { method: "POST", body }),
    reject: (id, note) =>
      request(`/api/admin/applications/${id}/reject`, { method: "POST", body: { note } }),
    schools: () => request("/api/admin/schools"),
    createSchool: (body) => request("/api/admin/schools", { method: "POST", body }),
    updateSchool: (id, body) => request(`/api/admin/schools/${id}`, { method: "PATCH", body }),
    users: (params = {}) => {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/admin/users${q ? `?${q}` : ""}`);
    },
    setRole: (id, role) => request(`/api/admin/users/${id}/role`, { method: "POST", body: { role } }),
    setSchool: (id, school_id) =>
      request(`/api/admin/users/${id}/school`, { method: "POST", body: { school_id } }),
    students: (params = {}) => {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/admin/students${q ? `?${q}` : ""}`);
    },
    studentDecision: (id, decision, note) =>
      request(`/api/admin/students/${id}/decision`, { method: "POST", body: { decision, note } }),
  },
};
