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

export function serialiseBuild(build, earned) {
  return {
    frameId: build.frameId,
    placed: build.placed,
    links: [...build.links], // Set -> array
    variants: build.variants,
    faults: build.faults,
    flags: build.flags,
    /* Flight achievements ride along with the build.
       They are not part of the aircraft, and this is not where they belong on
       principle — but `state` is a jsonb column that already syncs per user, so
       putting them here works today without a migration. Kept local only, they
       were lost by every reload on a new machine, every cleared browser, and by
       the move to a new origin, which is what took a completed module back to
       ten of eleven for someone who had certainly flown it. */
    earned: earned ? [...earned] : [],
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

export function useBuildSync({ user, build, earned, applyBuild, applyEarned, fallbackBuild }) {
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
        /* Merged, never replaced: a student may have flown on this machine
           while signed out, and that work counts too. */
        if (Array.isArray(data.state?.earned) && data.state.earned.length) {
          applyEarned?.(data.state.earned);
        }
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

    const payload = serialiseBuild(build, earned);
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
  }, [build, earned, user?.id]);

  return { status, error };
}

/* -------------------------------------------------------- progress sync */

export function useProgressSync({ user, moduleId, progress }) {
  const lastKey = useRef(null);
  /* The most recent snapshot, kept in a ref so the cleanup can flush it without
     re-subscribing the effect on every keystroke of progress. */
  const pendingRef = useRef(null);
  /* Per-module high-water mark: the best this student has ever reached.
     Seeded from the database so it survives a reload, not just a tab. */
  const best = useRef(new Map());
  const seededFor = useRef(null);

  /* Read the existing marks once per signed-in user. Until this resolves the
     map is empty, which only ever means "no floor yet" — never a false floor. */
  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      seededFor.current = null;
      best.current = new Map();
      return;
    }
    if (seededFor.current === user.id) return;
    seededFor.current = user.id;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("module_progress")
        .select("module_id, tasks_done, completed")
        .eq("user_id", user.id);
      if (cancelled) return;
      for (const r of data ?? []) {
        best.current.set(r.module_id, {
          done: r.tasks_done ?? 0,
          complete: Boolean(r.completed),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const write = useCallback(async (row) => {
    if (!isSupabaseConfigured || !row) return;

    /* PROGRESS ONLY EVER GOES UP.
       A module's task list is re-evaluated continuously against live state, so
       any state a finished module depended on going away — a part unfitted to
       try something, a flight ended, the aircraft reset — briefly drops the
       count. Writing that would tell the school a student had un-learnt
       something, which is not a thing that happens. Record the high-water mark
       and let the checklist be the live view. */
    const prior = best.current.get(row.module_id);
    if (prior && (row.tasks_done < prior.done || (prior.complete && !row.completed))) {
      return;
    }
    best.current.set(row.module_id, { done: row.tasks_done, complete: row.completed });

    await supabase.from("module_progress").upsert(row, { onConflict: "user_id,module_id" });
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !user || !progress) return;

    const key = `${moduleId}:${progress.doneCount}:${progress.complete}`;
    if (key === lastKey.current) return;
    lastKey.current = key;

    const row = {
      user_id: user.id,
      module_id: moduleId,
      completed: progress.complete,
      tasks_done: progress.doneCount,
      tasks_total: progress.total,
      current_task: progress.current?.label ?? null,
      updated_at: new Date().toISOString(),
    };
    pendingRef.current = row;

    const t = setTimeout(() => {
      write(row);
      pendingRef.current = null;
    }, 1200);

    return () => {
      clearTimeout(t);
      /* FLUSH, do not drop.
         Finishing a module auto-advances to the next one, which changes
         `moduleId` and tears this effect down — inside the 1200 ms debounce. The
         old cleanup simply cancelled the timer, so the write that marked the
         module COMPLETE never happened and it sat for ever one task short of
         done. The debounce exists to avoid writing on every keystroke, not to
         discard the last thing that happened. */
      if (pendingRef.current) {
        write(pendingRef.current);
        pendingRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, moduleId, progress?.doneCount, progress?.complete, progress?.total]);
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
