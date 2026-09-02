import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured, describeError } from "./supabase.js";
import { normalizeVariants } from "../data/parts.js";
import { AIRFRAMES } from "../data/airframes.js";
import { MODULES } from "../data/curriculum.js";
import { coherent, mayRecord, benchRepairs } from "../sim/benchTicks.js";
import {
  serialiseWorkspaces,
  deserialiseWorkspaces,
  migrateLegacySave,
} from "../sim/workspaces.js";

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

/* ------------------------------------------- is the airframe column there? */
/**
 * `supabase/per-airframe-progress.sql` adds `module_progress.frame_id`. Until
 * it has been run, every statement that names that column is rejected by
 * Postgres with 42703 — and the first version of this code swallowed the error,
 * so the moment the airframe-aware build shipped a student's progress silently
 * stopped being recorded at all. Nothing said so. The panels kept showing
 * whatever was written before the deploy, which looks exactly like a student
 * who has stopped working.
 *
 * So the column is discovered rather than assumed. The first rejection — or the
 * first row that comes back without the key — switches this off, and from then
 * on statements leave the column out. Progress keeps being written, pooled
 * across the three copters exactly as it was before the split, and running the
 * migration turns the split on with no further change here.
 *
 * The module rail does not depend on any of this either way. Which modules an
 * aircraft has finished comes from its bench in `builds`, which has been keyed
 * by airframe since the benches existed. This table is the school's record.
 */
let hasFrameColumn = true;

function missingFrameColumn(error) {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  return error.code === "42703" || /column .*frame_id.* does not exist/i.test(text);
}

function noteMissingFrameColumn() {
  if (!hasFrameColumn) return;
  hasFrameColumn = false;
  console.error(
    "[DroneLab] module_progress has no frame_id column, so the school's record " +
      "cannot be kept per airframe. Run supabase/per-airframe-progress.sql. " +
      "Progress is still being saved — pooled across all three copters, as it " +
      "was before — and the module rail is unaffected either way."
  );
}

/** Rows answer the question directly: select("*") returns the key or it does not. */
function probeFrameColumn(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  if (!("frame_id" in rows[0])) noteMissingFrameColumn();
}

/** Test seam. The probe is module state, and a suite that exercises both a
    migrated and an un-migrated database has to be able to put it back. */
export function __resetFrameColumnProbe() {
  hasFrameColumn = true;
}

/* ------------------------------------------------------- serialisation */

export function serialiseBuild(build, earned, extra = {}) {
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
    /* The OTHER airframes' benches: their builds, their completed modules,
       their flights. Progress is per aircraft (see sim/workspaces.js), and a
       separation that only lasted until the next reload would not be one —
       the student would come back to find the octocopter wearing the
       hexacopter's ticks again. Carried in this jsonb column rather than a new
       table so no schema migration is needed to keep it. */
    workspaces: extra.workspaces ? serialiseWorkspaces(extra.workspaces) : undefined,
    completedModules: extra.completedModules ? [...extra.completedModules] : undefined,
    moduleId: extra.moduleId,
  };
}

export function deserialiseBuild(row, fallback) {
  if (!row?.state) return fallback;
  const s = row.state;
  const frameId = s.frameId ?? fallback.frameId;
  return {
    frameId,
    placed: s.placed ?? {},
    links: new Set(Array.isArray(s.links) ? s.links : []),
    /* Builds saved before the hexa and octo existed name their battery by bare
       capacity ("4200"), an id that no longer exists. Translate rather than let
       the parts library show no pack fitted on a finished aircraft. */
    variants: normalizeVariants(s.variants ?? {}, AIRFRAMES[frameId] ?? AIRFRAMES.quad),
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

export function useBuildSync({
  user,
  build,
  earned,
  workspaces,
  completedModules,
  moduleId,
  applyBuild,
  applyEarned,
  applyWorkspaces,
  fallbackBuild,
  resetKey,
}) {
  const [status, setStatus] = useState("idle"); // idle | loading | saving | saved | error
  const [error, setError] = useState(null);
  const loadedFor = useRef(null);
  const saveTimer = useRef(null);
  const lastSaved = useRef(null);
  /* The write the debounce is currently sitting on, so something other than the
     timer can send it — see the page-hide listener below. */
  const pending = useRef(null);
  /**
   * THE LOAD WINS, ALWAYS.
   *
   * This app starts on a default quadcopter with an empty bench, because it has
   * to render something before it knows who is looking at it. That opening
   * state is not a draft of the student's work — it is a placeholder — and it
   * must never reach the database. It used to: the save effect ran the moment a
   * user appeared, parked the placeholder in `pending`, and the very next state
   * change flushed it. The state change that came next was the load landing.
   *
   * So writing does not begin until the row has been read. Set to the user id
   * rather than a boolean so signing in as somebody else cannot inherit it.
   *
   * Mirrored into state as well as a ref, because the ref is invisible to
   * anything outside this hook. The progress table needs the same protection
   * and could not have it: a ref changing does not re-render, so a caller
   * cannot wait on one. See `hydrated` in the return value.
   */
  const hydrated = useRef(null);
  const [hydratedUser, setHydratedUser] = useState(null);
  const seenResetKey = useRef(resetKey);
  /* Every write goes through here, one after another.
     A reset produces two writes in quick succession — the flush of whatever was
     mid-debounce, then the empty set — and fired concurrently there is nothing
     deciding which reaches Postgres last. Losing that race restores the build
     the student just stripped. A chain costs one await and removes the question
     entirely. */
  const chain = useRef(Promise.resolve());
  const enqueue = (fn) => {
    chain.current = chain.current.then(fn, fn);
    return chain.current;
  };

  /* Load once per signed-in user. */
  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      loadedFor.current = null;
      setHydratedUser(null);
      return;
    }
    if (loadedFor.current === user.id) return;
    loadedFor.current = user.id;

    let cancelled = false;
    setStatus("loading");

    (async () => {
      /* RETRIED, BECAUSE A FAILED READ NOW COSTS THE WHOLE SESSION.
         Saving is held back until this answers, so one cold-start blip would
         mean a lesson's work never leaves the tab rather than one request being
         lost. Three attempts; after that the error stands and the account panel
         says so. */
      let data = null;
      let err = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, attempt * 1200));
        if (cancelled) return;
        ({ data, error: err } = await supabase
          .from("builds")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle());
        if (!err) break;
      }

      if (cancelled) return;
      if (err) {
        /* Deliberately left un-hydrated. We do not know what that row holds,
           and overwriting it with whatever happens to be on screen is worse
           than not saving. Cleared so a later render can try again. */
        loadedFor.current = null;
        setHydratedUser(null);
        setError(describeError(err));
        setStatus("error");
        return;
      }
      if (data) {
        const loadedBuild = deserialiseBuild(data, fallbackBuild);
        applyBuild(loadedBuild);
        /* Merged, never replaced: a student may have flown on this machine
           while signed out, and that work counts too. */
        if (Array.isArray(data.state?.earned) && data.state.earned.length) {
          applyEarned?.(data.state.earned);
        }

        /* The other airframes' benches. An account saved before these existed
           has none, and its single record of progress belongs to whatever
           aircraft its build names — filing it anywhere else would hand a
           student ticks on an airframe they have never touched. The completed
           modules for the legacy case come from module_progress, which the
           caller fetches; here we can only recover what the blob holds. */
        if (data.state?.workspaces) {
          applyWorkspaces?.({
            workspaces: deserialiseWorkspaces(data.state.workspaces),
            completedModules: data.state.completedModules ?? [],
            moduleId: data.state.moduleId ?? null,
            frameId: loadedBuild.frameId,
            legacy: false,
          });
        } else {
          applyWorkspaces?.({
            workspaces: migrateLegacySave({
              build: loadedBuild,
              completedModules: data.state?.completedModules ?? [],
              earned: data.state?.earned ?? [],
            }),
            completedModules: data.state?.completedModules ?? [],
            moduleId: data.state?.moduleId ?? null,
            frameId: loadedBuild.frameId,
            legacy: true,
          });
        }
        lastSaved.current = JSON.stringify(data.state);
      }
      /* Anything composed before this instant describes the placeholder bench,
         not the student's. Dropped rather than flushed. */
      pending.current = null;
      hydrated.current = user.id;
      setHydratedUser(user.id);
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
    /* `status` was checked here once, and could not work: an effect sees the
       status from the render it was scheduled in, and the load sets "loading"
       from inside that same render. It was always reading "idle". */
    if (!isSupabaseConfigured || !user || hydrated.current !== user.id) return;

    const payload = serialiseBuild(build, earned, { workspaces, completedModules, moduleId });
    const json = JSON.stringify(payload);
    if (json === lastSaved.current) return;

    const row = {
      user_id: user.id,
      frame_id: payload.frameId,
      state: payload,
      updated_at: new Date().toISOString(),
    };
    pending.current = { json, row };

    const send = () => {
      const held = pending.current;
      if (!held || held.json === lastSaved.current) return chain.current;
      lastSaved.current = held.json;
      pending.current = null;
      setStatus("saving");
      return enqueue(async () => {
        const { error: err } = await supabase
          .from("builds")
          .upsert(held.row, { onConflict: "user_id" });
        if (err) {
          /* Let the next change try again rather than pretending this landed. */
          lastSaved.current = null;
          setError(describeError(err));
          setStatus("error");
          return;
        }
        setError(null);
        setStatus("saved");
      });
    };

    clearTimeout(saveTimer.current);

    /* A RESET IS NOT DEBOUNCED.
       Stripping the build is deliberate, rare, and destructive, and the write
       it produces is the empty achievement set. Debouncing that meant the one
       write that most needed to land was the one most likely to be abandoned:
       "Portal" is a link to a different application, so leaving the page is a
       real navigation — and React does not run effect cleanups on unload. The
       flush below never fired on that path, the cloud kept the old set, and it
       was merged straight back on return with Hover still ticked.

       Nothing is gained by making the student wait 1500 ms for a button they
       had to confirm in a dialogue. */
    if (resetKey !== seenResetKey.current) {
      seenResetKey.current = resetKey;
      void send();
      return;
    }

    saveTimer.current = setTimeout(send, 1500);

    return () => {
      clearTimeout(saveTimer.current);
      /* FLUSH, do not drop. An in-app teardown — the effect re-running, the
         component going away — must not discard the last thing that happened.
         The debounce exists so that dragging a part does not hammer the
         database, not so that work is lost. */
      void send();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, earned, workspaces, completedModules, moduleId, user?.id, resetKey, status]);

  /* LEAVING THE PAGE IS NOT AN UNMOUNT.
     Clicking "Portal" navigates to a different application, and a browser does
     not run React's cleanup on the way out — so up to 1500 ms of work sat in a
     timer that was simply thrown away with the page. `visibilitychange` fires
     before the navigation commits, while the tab can still make a request, so
     the pending write goes now. It is also the right moment on mobile, where a
     backgrounded tab may never be resumed. */
  useEffect(() => {
    if (!isSupabaseConfigured || !user) return;
    const flush = () => {
      const held = pending.current;
      if (!held || held.json === lastSaved.current) return;
      lastSaved.current = held.json;
      pending.current = null;
      clearTimeout(saveTimer.current);
      void enqueue(() => supabase.from("builds").upsert(held.row, { onConflict: "user_id" }));
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flush);
    };
  }, [user?.id]);

  return { status, error, hydrated: Boolean(user) && hydratedUser === user.id };
}

/* -------------------------------------------------------- progress sync */

/** How many tasks a module has, from the curriculum rather than from whatever
    happens to be recorded. A module the bench says is finished has all of them
    done, by definition — there is no such thing as a finished module with one
    task ticked. */
const TASK_TOTAL = new Map(MODULES.map((m) => [m.id, m.tasks.length]));

export function useProgressSync({
  user,
  frameId,
  moduleId,
  progress,
  completedModules,
  hydrated,
  resetKey,
}) {
  /* Surfaced rather than swallowed. A write that is being rejected every time
     — the airframe column missing is the case that actually happened — used to
     look identical to a student who had simply stopped working. */
  const [error, setError] = useState(null);
  const lastKey = useRef(null);
  /* The most recent snapshot, kept in a ref so the cleanup can flush it without
     re-subscribing the effect on every keystroke of progress. */
  const pendingRef = useRef(null);
  /* Per-module high-water mark: the best this student has ever reached.
     Seeded from the database so it survives a reload, not just a tab. */
  const best = useRef(new Map());
  const seededFor = useRef(null);
  /* State, not a ref: writing waits on this, and an effect cannot wait on
     something that does not re-render. */
  const [seededUser, setSeededUser] = useState(null);

  useEffect(() => {
    if (resetKey == null) return;
    best.current = new Map();
    seededFor.current = null;
    setSeededUser(null);
    lastKey.current = null;
    pendingRef.current = null;
  }, [resetKey]);

  /* Read the existing marks once per signed-in user. Until this resolves the
     map is empty, which only ever means "no floor yet" — never a false floor. */
  useEffect(() => {
    if (!isSupabaseConfigured || !user) {
      seededFor.current = null;
      setSeededUser(null);
      best.current = new Map();
      return;
    }
    if (seededFor.current === user.id) return;
    seededFor.current = user.id;

    let cancelled = false;
    (async () => {
      /* select("*") rather than naming the columns: on an instance where the
         migration has not been run, naming frame_id makes the whole statement
         fail and no high-water mark is seeded at all. The row shape is also the
         cheapest possible answer to whether that column exists. */
      const { data } = await supabase
        .from("module_progress")
        .select("*")
        .eq("user_id", user.id);
      if (cancelled) return;
      probeFrameColumn(data);
      for (const r of data ?? []) {
        best.current.set(markKey(r.frame_id, r.module_id), {
          done: r.tasks_done ?? 0,
          complete: Boolean(r.completed),
        });
      }
      setSeededUser(user.id);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const write = useCallback(async (input) => {
    if (!isSupabaseConfigured || !input) return;
    let row = input;

    /* PROGRESS ONLY EVER GOES UP.
       A module's task list is re-evaluated continuously against live state, so
       any state a finished module depended on going away — a part unfitted to
       try something, a flight ended, the aircraft reset — briefly drops the
       count. Writing that would tell the school a student had un-learnt
       something, which is not a thing that happens. Record the high-water mark
       and let the checklist be the live view. */
    /* Complete means every task, whatever composed this. See sim/benchTicks.js. */
    row = coherent(row);

    const key = markKey(row.frame_id, row.module_id);
    const prior = best.current.get(key);
    if (prior && (row.tasks_done < prior.done || (prior.complete && !row.completed))) {
      return;
    }
    best.current.set(key, { done: row.tasks_done, complete: row.completed });

    const send = (withFrame) => {
      const { frame_id, ...pooled } = row;
      return supabase.from("module_progress").upsert(withFrame ? row : pooled, {
        onConflict: withFrame ? "user_id,frame_id,module_id" : "user_id,module_id",
      });
    };

    let { error: err } = await send(hasFrameColumn);
    /* The migration has not been run here. Say so once, then carry on recording
       pooled, exactly as this did before the airframe split. Refusing to write
       at all would punish the student for a database that is one SQL file
       behind, and silence is what made that look like an idle account. */
    if (err && hasFrameColumn && missingFrameColumn(err)) {
      noteMissingFrameColumn();
      ({ error: err } = await send(false));
    }

    if (err) {
      /* Put the mark back. Left raised, it suppresses every retry of the very
         write that just failed. */
      if (prior) best.current.set(key, prior);
      else best.current.delete(key);
      setError(describeError(err));
      return;
    }
    setError(null);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !user || !progress) return;
    /* THE PLACEHOLDER MUST NOT REACH THE SCHOOL'S RECORD.
       The same fault the build save had, in the other table, and what put
       "complete · 1 of 11 tasks" under a finished quadcopter: the opening
       bench is empty, Module 1 measured against it scores 1 of 11, and the
       cleanup below faithfully flushed that on its way out — every sign-in,
       over the top of work done last week. Nothing is written until both loads
       are in. The rule, and why, is in sim/benchTicks.js. */
    if (!mayRecord({ userId: user.id, hydrated, seededUser })) return;

    const key = `${frameId}:${moduleId}:${progress.doneCount}:${progress.complete}`;
    if (key === lastKey.current) return;
    lastKey.current = key;

    const row = {
      user_id: user.id,
      /* WHICH AIRCRAFT THIS IS PROGRESS ON.
         Without it there was one course pooled across all three copters, so
         finishing a quadcopter unlocked Modules 2 and 3 on a hexacopter that
         had not been started — the simulator kept the benches apart and the
         database handed the ticks straight back on the next sign-in. */
      frame_id: frameId,
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
  }, [
    user?.id,
    hydrated,
    seededUser,
    frameId,
    moduleId,
    progress?.doneCount,
    progress?.complete,
    progress?.total,
  ]);

  /* REPAIR WHAT THE PLACEHOLDER ALREADY DAMAGED.
     The guard above stops it happening again and does nothing for the rows it
     already wrote. Those cannot heal on their own: only the module a student
     currently has open is ever written, so a quadcopter's Module 1 stays wrong
     until they reopen a module they finished weeks ago. See benchRepairs. */
  useEffect(() => {
    if (!isSupabaseConfigured || !user) return;
    if (!mayRecord({ userId: user.id, hydrated, seededUser })) return;

    const marks = new Map();
    for (const id of completedModules ?? []) {
      const mark = best.current.get(markKey(frameId, id));
      if (mark) marks.set(id, mark);
    }
    const owed = benchRepairs({ completedModules, marks, totals: TASK_TOTAL });
    if (!owed.length) return;

    let cancelled = false;
    (async () => {
      for (const { moduleId: id, total } of owed) {
        if (cancelled) return;
        await write({
          user_id: user.id,
          frame_id: frameId,
          module_id: id,
          completed: true,
          tasks_done: total,
          tasks_total: total,
          current_task: null,
          updated_at: new Date().toISOString(),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, hydrated, seededUser, frameId, completedModules]);

  return { error };
}

/** The high-water mark is per aircraft, so two copters cannot hold each other
    back. Where the column does not exist there is only one pooled course to
    hold a mark for, and the key says so rather than filing everything under a
    quadcopter that may not be what the student is flying. */
function markKey(frameId, moduleId) {
  if (!hasFrameColumn) return `*:${moduleId}`;
  return `${frameId ?? "quad"}:${moduleId}`;
}

/**
 * Everything this account has finished, FILED UNDER THE AIRCRAFT IT WAS
 * FINISHED ON.
 *
 * Returned as a map rather than a list, and that is the whole point. Two
 * independent requests populate the bench when a student signs in — this one
 * and the saved build — and they can land in either order. A bare list has to
 * be merged into whichever copter happens to be on the bench at that instant,
 * which on a cold load is the default quadcopter and not the hexacopter the
 * student actually left out. That is how a fresh hexacopter arrived wearing a
 * finished quadcopter's ticks, and guarding the merge never fixed it, because
 * the guard was racing the same two requests. A map keyed by airframe cannot be
 * misfiled however the race falls.
 *
 * `unkeyed` holds rows that name no airframe — an instance where the migration
 * has not been run, or a row written before it was. They are handed back
 * separately rather than guessed at: the only account they can honestly be
 * attributed to is one that has ever had a single aircraft, and only the caller
 * knows whether that is the case.
 */
export async function fetchProgressByFrame(userId) {
  const empty = { byFrame: {}, unkeyed: [] };
  if (!isSupabaseConfigured || !userId) return empty;

  /* select("*"), so this behaves identically before and after the migration. */
  const { data, error } = await supabase
    .from("module_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("completed", true);
  if (error || !data) return empty;
  probeFrameColumn(data);

  const byFrame = {};
  const unkeyed = [];
  for (const r of data) {
    const frame = typeof r.frame_id === "string" ? r.frame_id : null;
    /* An airframe this build cannot make is not an airframe. The migration's
       '~legacy' sentinel lands here too, which is exactly right. */
    if (!frame || !AIRFRAMES[frame]) {
      unkeyed.push(r.module_id);
      continue;
    }
    (byFrame[frame] ??= []).push(r.module_id);
  }
  return { byFrame, unkeyed };
}

/** One aircraft's finished modules. Kept as a name of its own because that is
    what most callers want, and because it reads at the call site. */
export async function fetchCompletedModules(userId, frameId) {
  if (!frameId) return new Set();
  const { byFrame } = await fetchProgressByFrame(userId);
  return new Set(byFrame[frameId] ?? []);
}

/**
 * Forget one aircraft's recorded progress.
 *
 * Scoped to the airframe, because "strip the build" strips one aircraft. A
 * student scrapping a half-built octocopter has not scrapped the hexacopter
 * they finished last week, and deleting the teacher's record of it would be a
 * lie told on their behalf.
 */
export async function clearRemoteProgress(userId, frameId) {
  if (!isSupabaseConfigured || !userId) return null;

  const scoped = frameId && hasFrameColumn;
  let q = supabase.from("module_progress").delete().eq("user_id", userId);
  if (scoped) q = q.eq("frame_id", frameId);
  let { error } = await q;

  /* Without the column there is nothing to scope by, so this falls back to what
     the code did before the split: clear the lot. That is the truthful reading
     of a pooled table — one course, and the student has just scrapped it — and
     it is only the school's record either way. The other aircraft keep their
     benches regardless, because those live in `builds`. */
  if (error && missingFrameColumn(error)) {
    noteMissingFrameColumn();
    ({ error } = await supabase.from("module_progress").delete().eq("user_id", userId));
  }
  return error ? describeError(error) : null;
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
