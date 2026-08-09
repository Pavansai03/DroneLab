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

async function request(path, { method = "GET", body } = {}) {
  const {
    data: { session },
  } = await supabase().auth.getSession();

  if (!session) {
    const err = new Error("You are signed out.");
    err.status = 401;
    throw err;
  }

  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

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
    approve: (id) => request(`/api/admin/applications/${id}/approve`, { method: "POST" }),
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
