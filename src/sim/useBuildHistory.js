import { useCallback, useMemo, useState } from "react";

/**
 * UNDO / REDO
 * ===========
 * Everything the student can *change about the aircraft* lives in one object, so
 * undo is simply stepping back through snapshots of it.
 *
 * Deliberately NOT in here: the camera, which panel is open, telemetry, or whether
 * we are in the flight field. Undo should reverse a decision about the build, not
 * rewind the user interface out from under the student.
 *
 * Every entry carries a label so the buttons can say what they will undo.
 */

const LIMIT = 80;

export function makeInitialBuild(frameId = "quad") {
  return {
    frameId,
    placed: {},
    links: new Set(),
    variants: {},
    faults: [],
    flags: {
      bound: false,
      fcConfigured: false,
      imuCalibrated: false,
      compassCalibrated: false,
      escCalibrated: false,
      powered: false,
      motorTestPassed: false,
      wiringValidated: false,
      preflightPassed: false,
      frameChosen: false,
      failureExperienced: false,
      faultDiagnosed: false,
      faultRepaired: false,
      crashed: false,
    },
  };
}

export function useBuildHistory(initial) {
  const [hist, setHist] = useState(() => ({
    past: [],
    present: initial,
    future: [],
    label: null,
  }));

  /**
   * Apply a change.
   * @param updater  next state, or (prev) => next
   * @param label    what this change was, e.g. "fit Motor 2"
   * @param opts     { transient: true } to change state WITHOUT a history entry
   */
  const commit = useCallback((updater, label, opts = {}) => {
    setHist((h) => {
      const next = typeof updater === "function" ? updater(h.present) : updater;
      if (!next || next === h.present) return h;

      // Transient changes (an auto-tick, a derived flag) should not become their
      // own undo step, or the student would have to press undo five times to
      // reverse one action.
      if (opts.transient) return { ...h, present: next };

      return {
        past: [...h.past, { state: h.present, label: h.label }].slice(-LIMIT),
        present: next,
        future: [],
        label,
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHist((h) => {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      return {
        past: h.past.slice(0, -1),
        present: prev.state,
        future: [{ state: h.present, label: h.label }, ...h.future].slice(0, LIMIT),
        label: prev.label,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHist((h) => {
      if (!h.future.length) return h;
      const next = h.future[0];
      return {
        past: [...h.past, { state: h.present, label: h.label }].slice(-LIMIT),
        present: next.state,
        future: h.future.slice(1),
        label: next.label,
      };
    });
  }, []);

  /** Wipe the build and the history together. */
  const reset = useCallback((state) => {
    setHist({ past: [], present: state, future: [], label: null });
  }, []);

  return useMemo(
    () => ({
      build: hist.present,
      commit,
      undo,
      redo,
      reset,
      canUndo: hist.past.length > 0,
      canRedo: hist.future.length > 0,
      // What each button would do, for the tooltips
      undoLabel: hist.label,
      redoLabel: hist.future[0]?.label ?? null,
      depth: hist.past.length,
    }),
    [hist, commit, undo, redo, reset]
  );
}
