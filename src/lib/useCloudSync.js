import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured, describeError } from "./supabase.js";

/**
 * CLOUD SYNC
 * ==========
 * Session handling, plus loading and saving a student's build and module
 * progress. Every function here is a no-op when Supabase is not configured, so
 * the simulator keeps working offline with no code paths changed.
 *
 * The build state contains a Set (`links`), which JSON cannot represent, so it
 * is converted on the way in and out rather than silently serialising to `{}`.
 */

/* ------------------------------------------------------- serialisation */

export function serialiseBuild(build) {
  return {
    frameId: build.frameId,
    placed: build.placed,
    links: [...build.links], // Set -> array
    variants: build.variants,
    faults: build.faults,
    flags: build.flags,
  };
}

export function deserialiseBuild(row, fallback) {
  if (!row?.state) return fallback;
  const s = row.state;
  return {
    frameId: s.frameId ?? fallback.frameId,
    placed: s.placed ?? {},
    links: new Set(Array.isArray(s.links) ? s.links : []),
    variants: s.variants ?? {},
    faults: Array.isArray(s.faults) ? s.faults : [],
    // Merge over the defaults so a schema addition never leaves a flag undefined
    flags: { ...fallback.flags, ...(s.flags ?? {}) },
  };
}

/* ------------------------------------------------------------- session */

export function useAuthSession() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(!isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session ?? null);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null);
      setReady(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  /* Role and profile follow the session. The role is read-only to the client
     by design — only the service_role can grant `teacher`. */
  useEffect(() => {
    if (!isSupabaseConfigured || !session?.user) {
      setRole(null);
      setProfile(null);
      return;
    }
    let cancelled = false;

    (async () => {
      const [{ data: roleRow }, { data: profileRow }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", session.user.id).maybeSingle(),
        supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      setRole(roleRow?.role ?? "student");
      setProfile(profileRow ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  return {
    session,
    user: session?.user ?? null,
    role,
    isTeacher: role === "teacher",
    profile,
    ready,
    enabled: isSupabaseConfigured,
  };
}

/* --------------------------------------------------------------- actions */

export async function signIn(email, password) {
  if (!isSupabaseConfigured) return { error: "Supabase is not configured." };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: describeError(error) };
}

export async function signUp(email, password, fullName, classCode) {
  if (!isSupabaseConfigured) return { error: "Supabase is not configured." };
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // The trigger in schema.sql copies these into the profiles row.
    options: { data: { full_name: fullName || null, class_code: classCode || null } },
  });
  if (error) return { error: describeError(error) };
  // With email confirmation on, there is no session until the link is clicked.
  return { error: null, needsConfirmation: !data.session };
}

export async function signOut() {
  if (!isSupabaseConfigured) return;
  await supabase.auth.signOut();
}

/* ----------------------------------------------------------- build sync */

export function useBuildSync({ user, build, applyBuild, fallbackBuild }) {
  const [status, setStatus] = useState("idle"); // idle | loading | saving | saved | error
  const [error, setError] = useState(null);
  const loadedFor = useRef(null);
  const saveTimer = useRef(null);
  const lastSaved = useRef(null);

  /* Load once per signed-in user. */
  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === user.id) return;
    loadedFor.current = user.id;

    let cancelled = false;
    setStatus("loading");

    (async () => {
      const { data, error: err } = await supabase
        .from("builds")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;
      if (err) {
        setError(describeError(err));
        setStatus("error");
        return;
      }
      if (data) {
        applyBuild(deserialiseBuild(data, fallbackBuild));
        lastSaved.current = JSON.stringify(data.state);
      }
      setStatus("idle");
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* Save, debounced. Building a drone fires dozens of state changes a minute;
     writing on every one would hammer the database for no benefit. */
  useEffect(() => {
    if (!isSupabaseConfigured || !user || status === "loading") return;

    const payload = serialiseBuild(build);
    const json = JSON.stringify(payload);
    if (json === lastSaved.current) return;

    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setStatus("saving");
      const { error: err } = await supabase.from("builds").upsert(
        {
          user_id: user.id,
          frame_id: payload.frameId,
          state: payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (err) {
        setError(describeError(err));
        setStatus("error");
        return;
      }
      lastSaved.current = json;
      setError(null);
      setStatus("saved");
    }, 1500);

    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, user?.id]);

  return { status, error };
}

/* -------------------------------------------------------- progress sync */

export function useProgressSync({ user, moduleId, progress }) {
  const lastKey = useRef(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !user || !progress) return;

    const key = `${moduleId}:${progress.doneCount}:${progress.complete}`;
    if (key === lastKey.current) return;
    lastKey.current = key;

    const t = setTimeout(async () => {
      await supabase.from("module_progress").upsert(
        {
          user_id: user.id,
          module_id: moduleId,
          completed: progress.complete,
          tasks_done: progress.doneCount,
          tasks_total: progress.total,
          current_task: progress.current?.label ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,module_id" }
      );
    }, 1200);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, moduleId, progress?.doneCount, progress?.complete]);
}

/** Which modules this student has already finished, to restore the rail state. */
export async function fetchCompletedModules(userId) {
  if (!isSupabaseConfigured || !userId) return new Set();
  const { data } = await supabase
    .from("module_progress")
    .select("module_id")
    .eq("user_id", userId)
    .eq("completed", true);
  return new Set((data ?? []).map((r) => r.module_id));
}

/** Teacher view: the whole class, rolled up. RLS returns only your own row if
    you are not a teacher, so this is safe to call either way. */
export async function fetchRoster() {
  if (!isSupabaseConfigured) return { rows: [], error: null };
  const { data, error } = await supabase
    .from("class_roster")
    .select("*")
    .order("full_name", { nullsFirst: false });
  return { rows: data ?? [], error: describeError(error) };
}
