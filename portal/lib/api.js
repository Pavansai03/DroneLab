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

  teacher: {
    school: () => request("/api/teacher/school"),
    roster: (schoolId) => request(`/api/teacher/roster${schoolId ? `?school=${schoolId}` : ""}`),
    student: (id) => request(`/api/teacher/students/${id}`),
  },

  admin: {
    stats: () => request("/api/admin/stats"),
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
  },
};
