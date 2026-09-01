import { useEffect, useRef } from "react";
import { supabase, isSupabaseConfigured } from "./supabase.js";

/**
 * RECORDING THAT SOMEONE FLEW
 * ===========================
 * The student panel shows "Flights flown" and "Day streak"; the teacher
 * dashboard and every exported report show flights and crashes per student.
 * All of them read `activity_log`, and until now nothing wrote to it — so every
 * one of those numbers was zero on every account, which read as "this student
 * has done nothing" rather than "nobody is counting".
 *
 * WHAT COUNTS AS A FLIGHT
 * -----------------------
 * The simulator's own `takeoff` event: armed, and above two metres. That is
 * already the threshold the curriculum uses for the Take Off task, so the
 * number a student sees here agrees with the tick they earned — which matters
 * more than any more clever definition would. It fires once per sortie and
 * re-arms on reset, so a student who lands and takes off again counts twice.
 *
 * A crash counts as a crash whether or not it counts as a flight. Hitting the
 * ground from one metre is a crash and is worth recording; it was not a flight.
 *
 * Seconds are airborne seconds — armed and off the ground — not time spent in
 * the flight view. A tab left open over lunch is not practice.
 *
 * WHY IT BUFFERS
 * --------------
 * Writing on every takeoff would be one request per event, and the interesting
 * failure is not cost but loss: a student flies, closes the tab, and the write
 * was in flight. So counts accumulate here and are sent on a slow timer, when
 * the flight ends, and when the page is hidden — the last of which is the one
 * that actually catches "clicked Portal", because leaving for another
 * application is a navigation and React never runs a cleanup for it.
 *
 * Nothing here is load-bearing. Every failure is swallowed: a lost count is a
 * slightly low number on a dashboard, and it must never interrupt a flight or
 * surface an error to a child at the controls.
 */

const FLUSH_EVERY_MS = 30000;

export function useFlightLog({ user, frameId, simRef, mode }) {
  /* What has happened since the last successful write. */
  const buffer = useRef({ flights: 0, crashes: 0, seconds: 0 });
  const userId = user?.id ?? null;

  /* Read through a ref so the listeners below never need re-attaching when the
     signed-in user resolves a moment after mount. */
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  /* WHICH AIRCRAFT FLEW.
     A flight belongs to a copter, and the panels now report per copter. Held in
     a ref for the same reason as the user: the listeners below must not be
     re-attached every time a student switches airframe, and a switch is only
     possible on the ground — so anything still in the buffer was flown by the
     airframe that is about to be replaced. Hence the flush on change. */
  const frameRef = useRef(frameId);

  const flush = useRef(() => {});
  flush.current = () => {
    const b = buffer.current;
    if (!isSupabaseConfigured || !userIdRef.current) return;
    if (!b.flights && !b.crashes && !b.seconds) return;
    /* Cleared BEFORE the request, not after. If it fails we lose these counts
       rather than sending them twice — and a double-counted flight is a wrong
       number a teacher might act on, where a missing one is only a low one. */
    buffer.current = { flights: 0, crashes: 0, seconds: 0 };
    void supabase
      .rpc("record_activity", {
        p_flights: b.flights,
        p_crashes: b.crashes,
        p_seconds: Math.round(b.seconds),
        p_frame_id: frameRef.current ?? "quad",
      })
      .then(({ error }) => {
        /* Most likely cause by far: supabase/activity-log.sql has not been run
           on this instance. Say so once, in the console, and carry on flying. */
        if (error) console.warn("[DroneLab] could not record activity:", error.message);
      });
  };

  /* Count takeoffs and crashes. */
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    return sim.on((type) => {
      if (type === "takeoff") buffer.current.flights += 1;
      if (type === "crash") buffer.current.crashes += 1;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simRef.current]);

  /* Airborne seconds, sampled once a second while the flight view is open.
     Sampling rather than integrating in the physics step keeps this out of the
     hot loop entirely, and one second of resolution is more than a dashboard
     that reports whole minutes can use. */
  useEffect(() => {
    if (mode !== "flight") return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      const sim = simRef.current;
      /* A backgrounded tab throttles this interval, so an elapsed gap of
         minutes means the browser stopped calling us — not that the student
         hovered through it. Anything beyond a couple of ticks is discarded. */
      if (sim && sim.armed && !sim.onGround && !sim.crashed && dt < 3) {
        buffer.current.seconds += dt;
      }
    }, 1000);
    return () => {
      clearInterval(id);
      /* Leaving the flight view is the natural end of a sortie. */
      flush.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /* The slow timer, and the two moments a page can disappear. */
  useEffect(() => {
    const id = setInterval(() => flush.current(), FLUSH_EVERY_MS);
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush.current();
    };
    const onLeave = () => flush.current();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onLeave);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onLeave);
      flush.current();
    };
  }, []);

  /* Signing in mid-session: whatever was flown a moment ago belongs to the
     account that has just appeared, not to nobody. */
  useEffect(() => {
    if (userId) flush.current();
  }, [userId]);

  /* Switching airframe: send what the OLD one flew before the ref moves on, or
     a hexacopter's flights are filed against the octocopter that replaced it. */
  useEffect(() => {
    if (frameRef.current === frameId) return;
    flush.current();
    frameRef.current = frameId;
  }, [frameId]);
}
