import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AIRFRAMES } from "./data/airframes.js";
import { PARTS, requiredQty, defaultVariant } from "./data/parts.js";
import { allWireIds, wiringStatus, buildHarnesses } from "./data/wiring.js";
import {
  MODULES,
  MODULE_BY_ID,
  FAILURES,
  RANDOM_FAILURE_POOL,
} from "./data/curriculum.js";

import { FlightSim } from "./sim/flightSim.js";
import { runDiagnostics, buildCrashReport } from "./sim/diagnostics.js";
import { buildProgressApi, evaluateModule } from "./sim/progress.js";
import { useBuildHistory, makeInitialBuild } from "./sim/useBuildHistory.js";
import { DEFAULT_FIELD, FLIGHT_FIELDS } from "./three/environments.js";
import {
  useAuthSession,
  useBuildSync,
  useProgressSync,
  fetchCompletedModules,
} from "./lib/useCloudSync.js";

import Viewport from "./components/Viewport.jsx";
import PartsLibrary from "./components/PartsLibrary.jsx";
import TaskChecklist from "./components/TaskChecklist.jsx";
import WiringBench from "./components/WiringBench.jsx";
import LogicTreeViewer from "./components/LogicTreeViewer.jsx";
import DiagnosticsPanel from "./components/DiagnosticsPanel.jsx";
import WiringDialog from "./components/WiringDialog.jsx";
import FaultPanel from "./components/FaultPanel.jsx";
import SystemFlow from "./components/SystemFlow.jsx";
import FramePicker from "./components/FramePicker.jsx";
import FieldPicker from "./components/FieldPicker.jsx";
import FlightHUD from "./components/FlightHUD.jsx";
import CrashReport from "./components/CrashReport.jsx";
import ConfirmDialog from "./components/ConfirmDialog.jsx";
import AccountPanel from "./components/AccountPanel.jsx";
import TeacherDashboard from "./components/TeacherDashboard.jsx";
import { Arrow, ArrowLeft, Reset, Bolt, Warn, Undo, Redo, SpeakerOn, SpeakerOff, Sun, Moon } from "./components/Icons.jsx";
import { initialTheme, applyTheme } from "./lib/theme.js";
import { hasPortal, goToPortal } from "./lib/portal.js";
import { loadEarned, saveEarned } from "./lib/achievements.js";
import {
  setBuzzerEnabled,
  setBuzzerMuted,
  isBuzzerMuted,
  unlockAudio,
  play as playBuzzer,
} from "./sim/buzzer.js";
import { setRotorMuted } from "./sim/rotorAudio.js";

/* Canonical assembly order. Propellers come after the battery deliberately:
   on a real drone you fit props last, and only with the battery disconnected. */
const BUILD_ORDER = [
  "frame",
  "pdb",
  "fc",
  "imu",
  "barometer",
  "esc",
  "motor",
  "receiver",
  "transmitter",
  "buzzer",
  "gps",
  "compass",
  "battery",
  "propeller",
];

const DEFAULT_ENV = { wind: 0, payload: 0, temperature: 25, altitude: 0 };

/* ------------------------------------------------------------------ */
/* Fault state derivation                                              */
/* ------------------------------------------------------------------ */
function deriveFaultState(faults) {
  let s = {
    deadMotor: [],
    deadEsc: [],
    reversedMotor: [],
    wrongProp: [],
    looseProp: [],
    jammedMotor: [],
    brokenPdbOutput: [],
    escTempBoost: {},
    envOverride: {},
  };
  for (const f of faults) {
    const def = FAILURES[f.id];
    if (!def?.apply) continue;
    s = def.apply(s, f.motor ?? 0);
  }
  return s;
}

/**
 * The RajUddan mark in the top bar.
 *
 * Resolved against the app's base so it works whether the simulator is served
 * at the root of its own origin or from /sim inside the portal. Hides itself if
 * the file is not there rather than leaving a broken image.
 */
function BrandMark() {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="dot">&#9670;</span>;
  return (
    <img
      className="brand-mark"
      src={`${import.meta.env.BASE_URL}brand/logo-mark.png`}
      alt="RajUddan"
      onError={() => setBroken(true)}
    />
  );
}

export default function App() {
  /* ------------------------------------------------------- curriculum */
  const [moduleId, setModuleId] = useState("m1");
  const module = MODULE_BY_ID[moduleId];
  const [completedModules, setCompletedModules] = useState(() => new Set());
  // Lets a teacher jump straight to any module to demonstrate, without having to
  // work through the earlier ones live in front of a class.
  const [allUnlocked, setAllUnlocked] = useState(false);

  /* ------------------------------------------------------------ build */
  /* Everything about the aircraft lives in one undoable object. The UI state
     below it (which tab is open, telemetry, the camera) deliberately does not —
     undo should reverse a build decision, not rewind the interface. */
  const {
    build: bs,
    commit,
    undo,
    redo,
    reset: resetHistory,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
  } = useBuildHistory(makeInitialBuild("quad"));

  const { frameId, placed, links, flags, faults, variants } = bs;
  const [env] = useState(DEFAULT_ENV);

  /* ------------------------------------------------------ cloud (optional) */
  /* All of this is inert when Supabase is not configured, so the simulator is
     unchanged offline — no feature is locked behind an account. */
  const auth = useAuthSession();

  const applyCloudBuild = useCallback(
    (loaded) => resetHistory(loaded),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /* Flight achievements, accumulated and never reduced. Telemetry is null in
     the assembly bay, so a set read straight off it loses everything the moment
     a student stops flying — see flightAchieved() in progress.js. Seeded from
     this machine, merged with whatever the account already had. */
  const [earned, setEarned] = useState(() => loadEarned(null));

  const applyCloudEarned = useCallback((list) => {
    setEarned((prev) => {
      const next = new Set(prev);
      let novel = false;
      for (const k of list) {
        if (!next.has(k)) {
          next.add(k);
          novel = true;
        }
      }
      return novel ? next : prev;
    });
  }, []);

  const { status: syncStatus, error: syncError } = useBuildSync({
    user: auth.user,
    build: bs,
    earned,
    applyBuild: applyCloudBuild,
    applyEarned: applyCloudEarned,
    fallbackBuild: makeInitialBuild(frameId),
  });

  /* Thin wrappers so each slice reads naturally at the call sites.
     `label` is what the undo button will offer to reverse. */
  const setPlaced = useCallback(
    (u, label = "fit a part", o) =>
      commit((p) => ({ ...p, placed: typeof u === "function" ? u(p.placed) : u }), label, o),
    [commit]
  );
  const setLinks = useCallback(
    (u, label = "change wiring", o) =>
      commit((p) => ({ ...p, links: typeof u === "function" ? u(p.links) : u }), label, o),
    [commit]
  );
  const setFlags = useCallback(
    (u, label = "change a setting", o) =>
      commit((p) => ({ ...p, flags: typeof u === "function" ? u(p.flags) : u }), label, o),
    [commit]
  );
  const setFaults = useCallback(
    (u, label = "change faults", o) =>
      commit((p) => ({ ...p, faults: typeof u === "function" ? u(p.faults) : u }), label, o),
    [commit]
  );
  const setVariants = useCallback(
    (u, label = "choose a variant", o) =>
      commit((p) => ({ ...p, variants: typeof u === "function" ? u(p.variants) : u }), label, o),
    [commit]
  );

  /* ---------------------------------------------------------- session */
  const [mode, setMode] = useState("assembly");
  const [sidebarTab, setSidebarTab] = useState("tasks");
  const [inspectorTab, setInspectorTab] = useState("diagnostics");
  const [selectedTree, setSelectedTree] = useState("fc");
  const [telemetry, setTelemetry] = useState(null);
  const [crashReport, setCrashReport] = useState(null);
  const [notice, setNotice] = useState(null);
  const [testing, setTesting] = useState(false);
  /* Which destructive action is awaiting confirmation, if any. */
  const [confirm, setConfirm] = useState(null);
  /* Master mute — a listening preference, not part of the build, so it lives
     outside the undo history. It covers the motors as well as the buzzer, which
     is why it is never disabled: rotor noise exists from the first flight,
     long before Module 3 adds anything that can beep. */
  const [muted, setMutedState] = useState(() => isBuzzerMuted());
  /* Which world to fly in. Not part of the build, so it stays out of the undo
     history — changing scenery is not a design decision about the aircraft. */
  const [fieldId, setFieldId] = useState(DEFAULT_FIELD);
  const [theme, setTheme] = useState(initialTheme);

  /* Applied in a layout effect so the repaint happens before the browser paints
     — otherwise the first frame flashes the wrong palette. */
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const frame = AIRFRAMES[frameId];
  const sceneRef = useRef(null);
  const simRef = useRef(null);
  const keysRef = useRef({});

  const faultState = useMemo(() => deriveFaultState(faults), [faults]);

  const componentSet = useMemo(
    () => (module.components?.length ? module.components : BUILD_ORDER),
    [module]
  );

  const build = useMemo(
    () => ({
      frameId,
      placed,
      links,
      flags,
      faultState,
      componentSet,
      requiresPdb: componentSet.includes("pdb"),
      motorKv: variants.motor === "1000" ? 1000 : 920,
      capacityMah: variants.battery === "5200" ? 5200 : 4200,
    }),
    [frameId, placed, links, flags, faultState, componentSet, variants]
  );

  /* ---------------------------------------------- GPS acquisition (bay) */
  /* A real GPS takes the best part of a minute to find enough satellites, and
     "Wait for GPS Lock" is a task in Module 2. The flight loop counts satellites
     for us, but it only runs in the flight field — so on the bench we run the same
     acquisition here. Without this the instruction tells students to wait for
     something that would never arrive. */
  const wiring = useMemo(
    () => wiringStatus(frame, componentSet, links),
    [frame, componentSet, links]
  );
  const gpsWired = Boolean(placed.gps?.length) && wiring.gpsToFc;
  const [baySatellites, setBaySatellites] = useState(0);

  useEffect(() => {
    if (!gpsWired || faultState.gpsPresent === false) {
      setBaySatellites(0);
      return;
    }
    const cap = faultState.satelliteOverride ?? 12;
    if (baySatellites >= cap) return;
    const id = setInterval(() => {
      setBaySatellites((s) => Math.min(cap, s + 1));
    }, 700);
    return () => clearInterval(id);
  }, [gpsWired, faultState.gpsPresent, faultState.satelliteOverride, baySatellites]);

  /* ------------------------------------------------------ diagnostics */
  const runtime = useMemo(
    () => ({
      soc: telemetry?.soc ?? 1,
      voltage: telemetry?.voltage ?? 12.6,
      sag: telemetry?.sag ?? 0,
      escTemps: telemetry?.escTemps ?? new Array(frame.motorCount).fill(env.temperature),
      armed: telemetry?.armed ?? flags.powered,
      satellites: mode === "flight" ? (telemetry?.satellites ?? 0) : baySatellites,
      thrustPerMotorN: telemetry?.thrustPerMotorN ?? 0,
      weightN: telemetry?.weightN ?? 0,
      propWash: telemetry?.propWash ?? 0,
      altitude: telemetry?.altitude ?? 0,
      groundSpeed: telemetry?.groundSpeed ?? 0,
    }),
    [telemetry, frame.motorCount, env.temperature, flags.powered, mode, baySatellites]
  );

  const diagnostics = useMemo(() => runDiagnostics(build, runtime), [build, runtime]);

  /* The buzzer is silent until it is actually fitted and wired — see
     sim/buzzer.js. This is the one place that switch gets flipped. */
  useEffect(() => {
    setBuzzerEnabled(diagnostics.buzzerFitted);
  }, [diagnostics.buzzerFitted]);

  /* --------------------------------------------------------- progress */
  /* Fold whatever the current flight has demonstrated into the permanent
     record. Flights end; the fact that you flew does not. */
  useEffect(() => {
    const live = telemetry?.achievements;
    if (!live || live.size === 0) return;
    setEarned((prev) => {
      let novel = false;
      for (const k of live) {
        if (!prev.has(k)) {
          novel = true;
          break;
        }
      }
      if (!novel) return prev;
      const next = new Set(prev);
      for (const k of live) next.add(k);
      saveEarned(auth.user?.id, next);
      return next;
    });
  }, [telemetry, auth.user?.id]);

  /* Signing in adopts this machine's signed-out work and adds whatever the
     account already had, so a student who practised before logging in does not
     lose the flight — and one who logs in on a fresh machine keeps their ticks. */
  useEffect(() => {
    const stored = loadEarned(auth.user?.id);
    setEarned((prev) => {
      const next = new Set(prev);
      let novel = false;
      for (const k of stored) {
        if (!next.has(k)) {
          next.add(k);
          novel = true;
        }
      }
      if (next.size > stored.size || novel) saveEarned(auth.user?.id, next);
      return novel ? next : prev;
    });
  }, [auth.user?.id]);

  const progressApi = useMemo(
    () =>
      buildProgressApi({
        earned,
        build,
        frame,
        telemetry,
        diagnostics,
        completedModules,
      }),
    [build, frame, telemetry, diagnostics, completedModules, earned]
  );

  const progress = useMemo(
    () => evaluateModule(module, progressApi),
    [module, progressApi]
  );

  useEffect(() => {
    if (progress.complete && !completedModules.has(moduleId)) {
      setCompletedModules((prev) => new Set(prev).add(moduleId));
    }
  }, [progress.complete, moduleId, completedModules]);

  /* Mirror progress into Supabase, and restore it on sign-in so the module rail
     reflects work done on another machine. Both are no-ops when offline. */
  useProgressSync({ user: auth.user, moduleId, progress });

  useEffect(() => {
    if (!auth.user) return;
    let cancelled = false;
    fetchCompletedModules(auth.user.id).then((set) => {
      if (cancelled || set.size === 0) return;
      setCompletedModules((prev) => new Set([...prev, ...set]));
    });
    return () => {
      cancelled = true;
    };
  }, [auth.user?.id]);

  /* -------------------------------------------------- the active part */
  const filledSlots = useMemo(() => {
    const s = new Set();
    Object.entries(placed).forEach(([partId, items]) =>
      items.forEach((it) => s.add(`${partId}:${it.slot}`))
    );
    return s;
  }, [placed]);

  /**
   * The one part the build order currently calls for. Optional extras (telemetry,
   * buzzer) are skipped here so they never block the chain — the parts tray lets
   * them be fitted at any time instead.
   */
  const activePart = useMemo(() => {
    for (const id of BUILD_ORDER) {
      if (!componentSet.includes(id)) continue;
      const def = PARTS[id];
      if (!def || def.optional) continue;
      if ((placed[id]?.length || 0) < requiredQty(def, frame)) return id;
    }
    return null;
  }, [componentSet, placed, frame]);

  /* ------------------------------------------------------ simulator */
  useEffect(() => {
    simRef.current = new FlightSim();
    return () => {
      simRef.current = null;
    };
  }, []);

  /** Capabilities the simulator needs, derived from the build and injected faults. */
  const capabilities = useMemo(
    () => ({
      gps: gpsWired && faultState.gpsPresent !== false,
      satelliteCap: faultState.satelliteOverride ?? 12,
      positionHold: gpsWired && faultState.compassWorking !== false,
      imuWorking: faultState.imuWorking !== false && Boolean(placed.imu?.length || !componentSet.includes("imu")),
      imuCalibrated:
        faultState.imuCalibrated !== false &&
        (flags.imuCalibrated || !componentSet.includes("imu")),
      baroWorking:
        faultState.baroWorking !== false &&
        Boolean(placed.barometer?.length || !componentSet.includes("barometer")),
      rcLink: faultState.rcLink !== false && faultState.receiverPowered !== false,
      overVoltage: Boolean(faultState.overVoltage),
      socOverride: faultState.socOverride ?? null,
    }),
    [placed, gpsWired, faultState, flags.imuCalibrated, componentSet]
  );

  /* Push configuration into the sim whenever the build changes. */
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.configure({
      build: { ...build, faultState },
      env: { ...env, payload: env.payload },
      capabilities,
    });
  }, [build, env, capabilities, faultState]);

  /* Sim event handling — crashes, gates, failsafes. */
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    return sim.on((type, payload) => {
      if (type === "crash") {
        setFlags((f) => ({ ...f, crashed: true }));
        setCrashReport(
          buildCrashReport(diagnostics, sim.telemetry(), payload.cause)
        );
        // The lost-model alarm: the one tune a real buzzer plays with no pilot
        // input at all, which is the whole point of fitting one.
        playBuzzer("lostModel");
      }
      if (type === "escShutdown") {
        setNotice(
          `ESC ${payload.motor + 1} hit ${payload.temp.toFixed(0)} degC and shut down — see the ESC logic tree.`
        );
        playBuzzer("warning");
      }
      if (type === "propDeparted") {
        setNotice(`Propeller ${payload.motor + 1} departed the aircraft — it was loose.`);
        playBuzzer("warning");
      }
      if (type === "failsafe") {
        setNotice("Radio link lost — FAILSAFE engaged.");
        playBuzzer("failsafe");
      }
      if (type === "lowBatteryRth") {
        setNotice("Battery below 20% — Return-To-Home triggered.");
        playBuzzer("lowBattery");
      }
      /* Arm and disarm are announced by the SIMULATOR, not by the button that
         happens to have caused them. Disarming now has a second path — a mid-air
         disarm goes on to crash the aircraft — and a button that plays its own
         tune would fall out of step with that the moment anything else disarms. */
      if (type === "armed") playBuzzer("armed");
      if (type === "disarmed") playBuzzer("disarmed");
      if (type === "altitudeLimit") {
        setNotice(
          `Above ${payload.limit} m — the legal ceiling for an uncrewed aircraft in most of the world. Nothing stops you climbing; the rules do.`
        );
        playBuzzer("altitudeLimit");
      }
      if (type === "takeoff") playBuzzer("takeoff");
      if (type === "landed") playBuzzer("landed");
      if (type === "rth") playBuzzer("rth");
      if (type === "gate") playBuzzer("gate");
      if (type === "missionComplete") {
        setNotice("Mission complete — all gates passed.");
        playBuzzer("missionComplete");
      }
    });
  }, [diagnostics]);

  /**
   * Flight loop.
   *
   * The PHYSICS is stepped inside the three.js render loop (see
   * DroneScene.attachSim) so the aircraft's pose is read on the very frame it is
   * drawn. React only samples telemetry on a timer to refresh the HUD.
   *
   * Doing it the other way round — physics in a React rAF, pose delivered through
   * React state — meant the drone's position only updated 20 times a second while
   * the world around it rendered at 60, which is what made the flight look laggy.
   */
  useEffect(() => {
    const sim = simRef.current;
    const scene = sceneRef.current;
    if (!sim || !scene) return;

    if (mode !== "flight") {
      scene.attachSim(null);
      return;
    }
    scene.attachSim(sim);

    const id = setInterval(() => {
      setTelemetry({ ...sim.telemetry(), keys: { ...keysRef.current } });
    }, 100); // 10 Hz is plenty for numeric readouts

    return () => {
      clearInterval(id);
      scene.attachSim(null);
    };
  }, [mode]);

  /* Keyboard */
  useEffect(() => {
    const down = (e) => {
      if (e.target?.tagName === "INPUT") return;

      // Undo / redo. Ctrl+Z, and either Ctrl+Y or Ctrl+Shift+Z for redo.
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if (k === "y" || (k === "z" && e.shiftKey)) {
          e.preventDefault();
          redo();
          return;
        }
      }

      keysRef.current[e.code] = true;
      simRef.current?.setKey(e.code, true);
      if (e.code === "Space") e.preventDefault();
    };
    const up = (e) => {
      keysRef.current[e.code] = false;
      simRef.current?.setKey(e.code, false);
    };

    /**
     * Release every key when the window loses focus.
     *
     * If anything steals focus mid-flight — an OS dialog, alt-tab, a
     * notification — the browser never delivers the keyup, so the control stays
     * jammed on and the drone flies away on its own while the student watches.
     * Treat losing focus as letting go of the sticks, which is also what a real
     * failsafe does when it stops hearing the transmitter.
     */
    const releaseAll = () => {
      for (const code of Object.keys(keysRef.current)) {
        if (!keysRef.current[code]) continue;
        keysRef.current[code] = false;
        simRef.current?.setKey(code, false);
      }
    };
    const onVisibility = () => {
      if (document.hidden) releaseAll();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [undo, redo]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5200);
    return () => clearTimeout(t);
  }, [notice]);

  /* --------------------------------------------------------- actions */

  /* Each of these makes exactly ONE history entry, so a single undo reverses a
     single student action rather than half of one. */

  const handlePlace = useCallback(
    (partId, slot) => {
      const def = PARTS[partId];
      commit((p) => {
        const list = p.placed[partId] || [];
        if (list.some((x) => x.slot === slot)) return p;
        // Propellers and motors inherit the slot's required direction unless the
        // student has deliberately picked a variant.
        const slotSpin = frame.motors[slot]?.spin;
        let variant = p.variants[partId] || defaultVariant(def, frame);
        if (partId === "propeller" && !p.variants.propeller) {
          variant = slotSpin === 1 ? "cw" : "ccw";
        }
        return {
          ...p,
          placed: { ...p.placed, [partId]: [...list, { slot, variant }] },
          flags: partId === "frame" ? { ...p.flags, frameChosen: true } : p.flags,
        };
      }, `fit ${def.label}${def.qty === "motors" ? ` ${slot + 1}` : ""}`);
    },
    [frame, commit]
  );

  const connectWire = useCallback(
    (id) => {
      commit(
        (p) => ({
          ...p,
          links: new Set(p.links).add(id),
          flags: { ...p.flags, wiringValidated: false },
        }),
        "connect a wire"
      );
    },
    [commit]
  );

  const disconnectWire = useCallback(
    (id) => {
      commit((p) => {
        const next = new Set(p.links);
        next.delete(id);
        return { ...p, links: next, flags: { ...p.flags, wiringValidated: false } };
      }, "remove a wire");
    },
    [commit]
  );

  /** Teacher shortcut: make every wire this build could legally have. */
  const connectAll = useCallback(() => {
    const ids = allWireIds(frame, componentSet);
    commit(
      (p) => ({ ...p, links: new Set(ids), flags: { ...p.flags, wiringValidated: false } }),
      "auto-wire the whole loom"
    );
    setNotice("Every loom wired. Open one to see how the connections were made.");
  }, [frame, componentSet, commit]);

  /* The loom currently open in the wiring dialog. */
  const [openHarnessId, setOpenHarnessId] = useState(null);
  const openHarness = useMemo(() => {
    if (!openHarnessId) return null;
    return (
      buildHarnesses(frame, componentSet).find((h) => h.id === openHarnessId) || null
    );
  }, [openHarnessId, frame, componentSet]);

  const toggleFault = useCallback(
    (id, motor) => {
      commit((p) => {
        const exists = p.faults.some((f) => f.id === id && f.motor === motor);
        const faults = exists
          ? p.faults.filter((f) => !(f.id === id && f.motor === motor))
          : [...p.faults, { id, motor }];
        return {
          ...p,
          faults,
          flags: { ...p.flags, failureExperienced: true, faultRepaired: false },
        };
      }, `${FAILURES[id]?.label ?? "fault"}`);
    },
    [commit]
  );

  const clearFaults = useCallback(() => {
    commit(
      (p) => ({
        ...p,
        faults: [],
        flags: { ...p.flags, faultRepaired: true, crashed: false },
      }),
      "repair the aircraft"
    );
    simRef.current?.reset(true);
    setCrashReport(null);
  }, [commit]);

  const injectRandom = useCallback(() => {
    // Prefer this module's own failure list; fall back to the general pool so the
    // teacher's random-fault button always has something to throw.
    const pool = module.failures?.length ? module.failures : RANDOM_FAILURE_POOL;
    const usable = pool.filter((id) => FAILURES[id]);
    if (!usable.length) return;
    const id = usable[Math.floor(Math.random() * usable.length)];
    const def = FAILURES[id];
    const motor = def.perMotor ? Math.floor(Math.random() * frame.motorCount) : undefined;
    commit(
      (p) => ({
        ...p,
        faults: [...p.faults, { id, motor }],
        flags: { ...p.flags, failureExperienced: true, faultRepaired: false },
      }),
      `inject ${def.label}`
    );
    setNotice("A fault has been injected. Diagnose it using the logic trees.");
  }, [module, frame.motorCount, commit]);

  /**
   * Strip the build back to nothing.
   *
   * This also clears the curriculum progress, because the modules were only ever
   * marked complete BY that build. Leaving the ticks and unlocks behind would say
   * a student had finished work that no longer exists — and would strand them in a
   * module that has just re-locked. So we return to Module 1 as well.
   *
   * Teacher mode is left alone: it is a deliberate override, not progress.
   *
   * The undo history goes too — steps leading back into a build that no longer
   * exists are worse than no history at all.
   */
  const resetBuild = useCallback(() => {
    resetHistory(makeInitialBuild(frameId));
    setCompletedModules(new Set());
    setModuleId("m1");
    setCrashReport(null);
    setTelemetry(null);
    setMode("assembly");
    setSidebarTab("tasks");
    simRef.current?.reset();
    setNotice("Build stripped and module progress cleared. Start again at Module 1.");
  }, [resetHistory, frameId]);

  /** The motor test from the task chain: spin each motor and verify direction. */
  const runMotorTest = useCallback(() => {
    const escOk = diagnostics.perMotor.esc.every((r) => r.tone === "ok");
    const motorOk = diagnostics.perMotor.motor.every((r) => r.tone === "ok");
    const propOk = diagnostics.perMotor.propeller.every((r) => r.tone === "ok");

    setTesting(true);
    // Spin the props visually for a moment so the student can see direction
    const fake = {
      motorRpm: new Array(frame.motorCount).fill(2600),
      motorOut: new Array(frame.motorCount).fill(0.3),
      escTemps: runtime.escTemps,
      satellites: runtime.satellites,
    };
    sceneRef.current?.setTelemetry(fake);

    setTimeout(() => {
      setTesting(false);
      sceneRef.current?.setTelemetry(telemetry);
      if (escOk && motorOk && propOk) {
        setFlags((f) => ({ ...f, motorTestPassed: true }));
        setNotice("Motor test passed — every motor spins the correct way.");
      } else {
        setFlags((f) => ({ ...f, motorTestPassed: false }));
        const bad = [
          ...diagnostics.perMotor.esc.filter((r) => r.tone !== "ok").map((r) => `ESC ${r.motor + 1}: ${r.text}`),
          ...diagnostics.perMotor.motor.filter((r) => r.tone !== "ok").map((r) => `M${r.motor + 1}: ${r.text}`),
          ...diagnostics.perMotor.propeller.filter((r) => r.tone !== "ok").map((r) => `Prop ${r.motor + 1}: ${r.text}`),
        ];
        setNotice(`Motor test FAILED — ${bad.slice(0, 2).join(" · ")}`);
        setInspectorTab("diagnostics");
      }
    }, 2200);
  }, [diagnostics, frame.motorCount, runtime, telemetry]);

  const powerOn = useCallback(() => {
    if (!diagnostics.contexts.fc.powered) {
      setNotice("The flight controller has no power. Check Battery -> PDB -> FC.");
      setSelectedTree("fc");
      setInspectorTab("tree");
      return;
    }
    setFlags((f) => ({ ...f, powered: true }));
    setNotice("Power on. Flight controller booting, sensors initialising.");
    playBuzzer("powerOn");
  }, [diagnostics]);

  /** Pull one telemetry snapshot immediately, so the HUD never renders blank. */
  const syncTelemetry = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    setTelemetry({ ...sim.telemetry(), keys: { ...keysRef.current } });
  }, []);

  const enterFlight = useCallback(() => {
    const sim = simRef.current;
    sim?.reset();
    // Carry the bench GPS lock into the flight field — a receiver that has already
    // found its satellites does not lose them just because the drone took off.
    if (sim && baySatellites > 0) {
      sim.satTimer = baySatellites / 1.6;
      sim.satellites = baySatellites;
    }
    setCrashReport(null);
    setFlags((f) => ({ ...f, crashed: false }));
    setMode("flight");
    setInspectorTab("diagnostics");
    syncTelemetry();
  }, [syncTelemetry, baySatellites]);

  const backToHangar = useCallback(() => {
    setMode("assembly");
    simRef.current?.disarm();
  }, []);

  const armDrone = useCallback(() => {
    // Browsers only allow audio to start from within a user gesture — this
    // click is that gesture, so unlock the context before anything tries to
    // play through it.
    unlockAudio();
    const modeId = diagnostics.flightMode.id;
    if (modeId === "ready" || modeId === "manual") {
      simRef.current?.arm();
      setFlags((f) => ({ ...f, powered: true, preflightPassed: true }));
      syncTelemetry();
      // A real flight controller cannot detect a dead motor or a backwards
      // propeller until the aircraft leaves the ground — which is exactly why the
      // pre-flight list exists. So we arm anyway, but say what is about to happen.
      const failing = diagnostics.blocking.filter((c) => c.id !== "gps");
      if (failing.length) {
        setNotice(
          `ARMED with ${failing.length} failed pre-flight check(s): ${failing
            .map((c) => c.label)
            .join(", ")}. The FC cannot detect these on the ground — expect trouble.`
        );
      }
    } else {
      playBuzzer("armingDenied");
      setNotice(
        `Arming denied — ${diagnostics.results.fc.text}. Open the Flight Controller logic tree to see which check failed.`
      );
      setSelectedTree("fc");
      setInspectorTab("tree");
    }
  }, [diagnostics, syncTelemetry]);

  /* -------------------------------------------------- derived display */
  const openTree = useCallback((id) => {
    setSelectedTree(id);
    setInspectorTab("tree");
  }, []);

  const benchActions = useMemo(() => {
    const a = [];
    const has = (id) => Boolean(placed[id]?.length);

    if (componentSet.includes("imu") && has("imu")) {
      a.push({
        id: "calImu",
        label: flags.imuCalibrated ? "IMU calibrated" : "Calibrate IMU",
        disabled: flags.imuCalibrated || faultState.imuWorking === false,
        onClick: () => {
          setFlags((f) => ({ ...f, imuCalibrated: true }));
          setNotice("IMU calibrated on a level surface. Gyro and accel bias zeroed.");
        },
        title: "Accelerometer and gyro bias calibration",
      });
    }
    if (componentSet.includes("compass") && has("compass")) {
      a.push({
        id: "calCompass",
        label: flags.compassCalibrated ? "Compass calibrated" : "Calibrate Compass",
        disabled: flags.compassCalibrated || faultState.compassWorking === false,
        onClick: () => {
          setFlags((f) => ({ ...f, compassCalibrated: true }));
          setNotice("Compass calibrated. Heading now trustworthy for RTH.");
        },
      });
    }
    if (componentSet.includes("transmitter") && has("transmitter") && has("receiver")) {
      a.push({
        id: "bind",
        label: flags.bound ? "Radio bound" : "Bind Transmitter to Receiver",
        disabled: flags.bound || faultState.bound === false,
        onClick: () => {
          setFlags((f) => ({ ...f, bound: true }));
          setNotice("Bind complete. The receiver LED is now solid.");
        },
      });
    }
    if (has("fc")) {
      a.push({
        id: "configFc",
        label: flags.fcConfigured
          ? `FC configured for ${frame.label}`
          : `Configure FC for ${frame.label}`,
        disabled: flags.fcConfigured || faultState.fcConfigured === false,
        onClick: () => {
          setFlags((f) => ({ ...f, fcConfigured: true, escCalibrated: true }));
          setNotice(
            `Airframe profile loaded: ${frame.label}, ${frame.motorCount} motors. ESC endpoints calibrated.`
          );
        },
      });
    }
    if (module.unlocks?.wiring) {
      a.push({
        id: "validate",
        label: "Validate connections",
        onClick: () => {
          const missing = diagnostics.missingRequiredLinks;
          if (missing.length === 0) {
            setFlags((f) => ({ ...f, wiringValidated: true }));
            setNotice("All required connections match the wiring diagram.");
          } else {
            setNotice(
              `Still incomplete: ${missing.map((h) => h.title).join(", ")}.`
            );
            setSidebarTab("wiring");
          }
        },
      });
    }
    a.push({
      id: "power",
      label: flags.powered ? "Powered on" : "Power ON",
      disabled: flags.powered,
      onClick: powerOn,
    });
    a.push({
      id: "motorTest",
      label: testing
        ? "Testing motors..."
        : flags.motorTestPassed
          ? "Motor test passed"
          : "Run motor test",
      disabled: testing || !flags.powered,
      onClick: runMotorTest,
    });
    if (faults.length > 0) {
      a.push({
        id: "repair",
        label: "Repair the aircraft",
        tone: "primary",
        onClick: clearFaults,
      });
    }
    return a;
  }, [
    componentSet,
    placed,
    flags,
    faultState,
    frame,
    module,
    diagnostics,
    testing,
    faults.length,
    powerOn,
    runMotorTest,
    clearFaults,
  ]);

  /* In the bay there is no telemetry, but the model's status LEDs should still be
     live — the GPS LED going amber then green is how a student sees lock happen. */
  const viewTelemetry = useMemo(() => {
    if (mode === "flight") return telemetry;
    return {
      satellites: baySatellites,
      escTemps: runtime.escTemps,
      motorRpm: [],
      motorOut: [],
    };
  }, [mode, telemetry, baySatellites, runtime.escTemps]);

  const totalPlaced = useMemo(
    () => Object.values(placed).reduce((s, a) => s + (a?.length || 0), 0),
    [placed]
  );

  const canFly =
    (placed.propeller?.length || 0) >= frame.motorCount &&
    (placed.battery?.length || 0) > 0 &&
    (placed.motor?.length || 0) >= frame.motorCount;

  /* Off the ground far enough that cutting the motors is a crash rather than a
     shutdown. Matches DISARM_SAFE_ALT in the simulator. */
  const airborne = Boolean(telemetry?.armed) && (telemetry?.altitude ?? 0) > 0.6;

  const sidebarTabs = useMemo(() => {
    const t = [{ id: "tasks", label: "Tasks" }];
    if (module.components?.length) t.push({ id: "parts", label: "Parts" });
    if (module.unlocks?.wiring) t.push({ id: "wiring", label: "Wiring" });
    t.push({ id: "airframe", label: "Airframe" });
    t.push({ id: "field", label: "Field" });
    /* Always "Account": the panel's own tabs are labelled "Sign in" and "Create
       account", and having two different controls both read "Sign in" is a
       genuine source of mis-clicks. */
    t.push({ id: "account", label: "Account" });
    if (auth.isTeacher) t.push({ id: "class", label: "Class" });
    return t;
  }, [module, auth.user, auth.isTeacher]);

  useEffect(() => {
    if (!sidebarTabs.some((t) => t.id === sidebarTab)) setSidebarTab("tasks");
  }, [sidebarTabs, sidebarTab]);

  const currentTask = progress.current;

  return (
    <div className="app">
      {/* ============================================= top bar */}
      <header className="topbar">
        {/* Only rendered when a portal is configured — the simulator is a
            complete product on its own and must not show a dead control when
            deployed without one. */}
        {hasPortal() && (
          <button
            className="btn back-to-portal"
            onClick={goToPortal}
            title="Back to the portal — your progress, class and profile"
          >
            <ArrowLeft />
            <span>Portal</span>
          </button>
        )}
        <div className="brand">
          {/* The company's mark, then the product's name. Falls back to the
              diamond if the asset is missing, so a top bar is never left with a
              broken-image glyph in it. */}
          <BrandMark />
          <b>DRONELAB</b>
          <span className="mono">
            / {mode === "assembly" ? "ASSEMBLY BAY" : "FLIGHT TEST FIELD"} /{" "}
            {frame.label.toUpperCase()}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <div className="mono" style={{ fontSize: 10.5, color: "var(--dim)" }}>
          MODULE {module.number} &mdash; {module.title.toUpperCase()}
        </div>
        <div className="progress-track" style={{ maxWidth: 170 }}>
          <div
            className={`progress-fill ${progress.complete ? "done" : ""}`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>

        {mode === "assembly" ? (
          <button
            className="btn primary"
            disabled={!canFly}
            onClick={enterFlight}
            title={canFly ? "Go to the flight test field" : "Finish the build first"}
          >
            To the flight field <Arrow />
          </button>
        ) : (
          <>
            <button
              className={`btn ${telemetry?.armed ? "danger" : "go"}`}
              onClick={() => {
                if (telemetry?.armed) {
                  simRef.current?.disarm();
                  syncTelemetry();
                } else armDrone();
              }}
              title={
                !telemetry?.armed
                  ? "Arm the aircraft — motors go live"
                  : airborne
                    ? "DISARM IN FLIGHT: this cuts the motors and the aircraft will fall. Land first."
                    : "Cut the motors — the safe way to end a flight, once you are down"
              }
            >
              <Bolt /> {telemetry?.armed ? "DISARM" : "ARM"}
            </button>
            <button
              className="btn"
              onClick={() => simRef.current?.triggerRth()}
              disabled={!telemetry?.armed}
            >
              RTH
            </button>
            <button
              className="btn"
              onClick={() => setConfirm("resetFlight")}
              title="Put the aircraft back on the pad"
            >
              <Reset /> Reset flight
            </button>
            <button className="btn" onClick={backToHangar}>
              <ArrowLeft /> Hangar
            </button>
          </>
        )}

        {/* A named choice, not a nameless switch.
            This was a 50x26 toggle with two 11px glyphs inside it, and the one
            thing it never made clear was which end meant what: a knob sitting
            over a sun could equally mean "light is on" or "press for light".
            Two labelled segments cannot be misread — the lit one is the theme
            you are in, and the other one is what you would get. The labels
            collapse to icons on a narrow window, where the pair of icons is
            still unambiguous because both are on screen at once. */}
        <div className="theme-switch" role="radiogroup" aria-label="Colour theme">
          <span className="ts-glider" data-active={theme} aria-hidden="true" />
          {[
            { id: "light", label: "Light", Glyph: Sun },
            { id: "dark", label: "Dark", Glyph: Moon },
          ].map(({ id, label, Glyph }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              className={`ts-opt ${theme === id ? "on" : ""}`}
              onClick={() => setTheme(id)}
              title={`${label} mode`}
            >
              <Glyph size={13} />
              <span className="ts-label">{label}</span>
            </button>
          ))}
        </div>

        {/* Master audio, not just the buzzer. The motors make noise whether or not
            a buzzer was ever fitted, so this can no longer be disabled along with
            it — a student on Module 1 still needs to be able to silence a room of
            twenty quadcopters. */}
        <button
          className={`btn icon ${muted ? "" : "go"}`}
          onClick={() => {
            const next = !muted;
            setMutedState(next);
            setBuzzerMuted(next);
            setRotorMuted(next);
          }}
          title={
            muted
              ? "Sound off. Click to turn it back on."
              : diagnostics.buzzerFitted
                ? "Sound on: motors and buzzer. Click to mute everything."
                : "Sound on: motors only — no buzzer is fitted yet, so the aircraft cannot beep. Click to mute."
          }
          aria-label={muted ? "Turn sound on" : "Mute all sound"}
        >
          {muted ? <SpeakerOff /> : <SpeakerOn />}
        </button>

        <button
          className={`cloud-chip ${
            !auth.enabled
              ? ""
              : syncStatus === "error"
                ? "bad"
                : syncStatus === "saving" || syncStatus === "loading"
                  ? "busy"
                  : auth.user
                    ? "on"
                    : ""
          }`}
          onClick={() => setSidebarTab("account")}
          title={
            !auth.enabled
              ? "Supabase is not configured — progress is kept in this browser only. Click for details."
              : auth.user
                ? `Signed in as ${auth.user.email}. Click to manage your account.`
                : "Not signed in — progress is not being saved. Click to sign in."
          }
        >
          <i />
          {!auth.enabled
            ? "LOCAL ONLY"
            : syncStatus === "error"
              ? "SYNC FAILED"
              : syncStatus === "saving"
                ? "SAVING"
                : syncStatus === "loading"
                  ? "LOADING"
                  : auth.user
                    ? "SYNCED"
                    : "SIGN IN"}
        </button>

        <div className="topbar-sep" />

        <button
          className="btn icon"
          onClick={undo}
          disabled={!canUndo}
          title={canUndo ? `Undo: ${undoLabel ?? "last change"}  (Ctrl+Z)` : "Nothing to undo"}
          aria-label="Undo"
        >
          <Undo />
        </button>
        <button
          className="btn icon"
          onClick={redo}
          disabled={!canRedo}
          title={canRedo ? `Redo: ${redoLabel ?? "next change"}  (Ctrl+Y)` : "Nothing to redo"}
          aria-label="Redo"
        >
          <Redo />
        </button>
        <button
          className="btn icon"
          onClick={() => setConfirm("resetBuild")}
          title="Strip the build and start again"
          aria-label="Strip the build"
        >
          <Reset />
        </button>
      </header>

      {/* ============================================= module rail */}
      <nav className="rail">
        {MODULES.map((m, i) => {
          const unlocked =
            allUnlocked ||
            i === 0 ||
            completedModules.has(MODULES[i - 1].id) ||
            completedModules.has(m.id);
          return (
            <button
              key={m.id}
              className={`rail-btn ${moduleId === m.id ? "active" : ""}`}
              disabled={!unlocked}
              onClick={() => {
                setModuleId(m.id);
                setMode("assembly");
              }}
              title={`Module ${m.number} — ${m.title}${unlocked ? "" : " (complete the previous module first)"}`}
            >
              {m.number}
              {completedModules.has(m.id) && <span className="badge">&#10003;</span>}
            </button>
          );
        })}
        <div className="rail-sep" />
        <button
          className={`rail-btn ${allUnlocked ? "active" : ""}`}
          onClick={() => setAllUnlocked((v) => !v)}
          title={
            allUnlocked
              ? "Teacher mode ON — every module is reachable. Click to restore the normal progression."
              : "Teacher mode — unlock every module so you can demonstrate out of order."
          }
        >
          &#9919;
        </button>
        <button
          className={`rail-btn ${inspectorTab === "flow" ? "active" : ""}`}
          onClick={() => setInspectorTab("flow")}
          title="Complete Flight Logic diagram"
        >
          &#8623;
        </button>
        <button
          className={`rail-btn ${inspectorTab === "faults" ? "active" : ""}`}
          onClick={() => setInspectorTab("faults")}
          title="Failure simulation"
        >
          <Warn size={17} />
        </button>
      </nav>

      {/* ============================================= left panel */}
      <aside className="panel">
        <div className="tabs">
          {sidebarTabs.map((t) => (
            <button
              key={t.id}
              className={`tab ${sidebarTab === t.id ? "active" : ""}`}
              onClick={() => setSidebarTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="panel-body">
          {sidebarTab === "tasks" && (
            <TaskChecklist module={module} progress={progress} actions={benchActions} />
          )}
          {sidebarTab === "parts" && (
            <PartsLibrary
              frame={frame}
              module={module}
              placed={placed}
              activePart={activePart}
              variants={variants}
              onVariant={(id, v) => setVariants((p) => ({ ...p, [id]: v }))}
              onStartDrag={(id, e) =>
                sceneRef.current?.startDrag(id, e.clientX, e.clientY, {
                  variant: variants[id],
                })
              }
              onRemove={() => setConfirm("resetBuild")}
            />
          )}
          {sidebarTab === "wiring" && (
            <WiringBench
              frame={frame}
              links={links}
              placed={placed}
              componentSet={componentSet}
              onOpenHarness={setOpenHarnessId}
              onConnectAll={connectAll}
            />
          )}
          {sidebarTab === "field" && (
            <FieldPicker
              fieldId={fieldId}
              disabled={mode === "flight"}
              onPick={(id) => {
                setFieldId(id);
                const f = FLIGHT_FIELDS.find((x) => x.id === id);
                setNotice(`Flight field set to ${f?.label ?? id}.`);
              }}
            />
          )}
          {sidebarTab === "account" && (
            <AccountPanel
              auth={auth}
              syncStatus={syncStatus}
              syncError={syncError}
              onSignedIn={() => setNotice("Signed in. Your build and progress will now be saved.")}
            />
          )}
          {sidebarTab === "class" && <TeacherDashboard auth={auth} />}
          {sidebarTab === "airframe" && (
            <FramePicker
              frameId={frameId}
              onPick={(id) => {
                if (id === frameId) return;
                resetHistory({ ...makeInitialBuild(id), flags: { ...makeInitialBuild(id).flags, frameChosen: true } });
                setTelemetry(null);
                setMode("assembly");
                simRef.current?.reset();
              }}
            />
          )}
        </div>
      </aside>

      {/* ============================================= viewport */}
      <Viewport
        mode={mode}
        frameId={frameId}
        placed={placed}
        activePart={mode === "assembly" ? activePart : null}
        filledSlots={filledSlots}
        telemetry={viewTelemetry}
        env={env}
        fieldId={fieldId}
        theme={theme}
        fcTone={diagnostics.results.fc.tone}
        onPlace={handlePlace}
        onSceneReady={(s) => (sceneRef.current = s)}
      >
        {mode === "assembly" ? (
          <div className="vp-overlay">
            <div />
            <div className="instruction-bar">
              <span className="step">
                {progress.complete
                  ? "MODULE COMPLETE"
                  : `STEP ${progress.currentIndex + 1}/${progress.total}`}
              </span>
              <div>
                <div className="txt">
                  {progress.complete
                    ? `Module ${module.number} finished — ${module.objective}`
                    : currentTask?.label}
                </div>
                {!progress.complete && <div className="hint">{currentTask?.hint}</div>}
              </div>
            </div>
          </div>
        ) : (
          <FlightHUD
            telemetry={telemetry}
            diagnostics={diagnostics}
            frame={frame}
            keys={telemetry?.keys || {}}
          />
        )}

        {notice && (
          <div
            className="instruction-bar"
            style={{
              position: "absolute",
              top: 14,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 30,
              borderColor: "var(--amber)",
              maxWidth: 520,
            }}
          >
            <Warn size={16} />
            <div className="txt" style={{ fontSize: 12 }}>
              {notice}
            </div>
          </div>
        )}

        {crashReport && (
          <CrashReport
            report={crashReport}
            onRepair={() => {
              clearFaults();
              simRef.current?.reset();
              setCrashReport(null);
            }}
            onDismiss={() => setCrashReport(null)}
          />
        )}

        {openHarness && (
          <WiringDialog
            harness={openHarness}
            links={links}
            onConnect={connectWire}
            onDisconnect={disconnectWire}
            onClose={() => setOpenHarnessId(null)}
          />
        )}

        {confirm === "resetBuild" && (
          <ConfirmDialog
            title="Strip the whole build?"
            message="Every part you have fitted and every wire you have made will be removed, along with the undo history and your module progress."
            detail={
              `You currently have ${totalPlaced} part${totalPlaced === 1 ? "" : "s"} fitted ` +
              `and ${links.size} wire${links.size === 1 ? "" : "s"} connected` +
              (completedModules.size
                ? `, with ${completedModules.size} module${
                    completedModules.size === 1 ? "" : "s"
                  } marked complete.`
                : ".") +
              ` You will start again at Module 1${
                allUnlocked ? " (teacher mode stays on, so all modules remain reachable)." : ", and Modules 2 and 3 will re-lock."
              }`
            }
            confirmLabel="Yes, strip it"
            cancelLabel="Keep my build"
            onConfirm={() => {
              setConfirm(null);
              resetBuild();
            }}
            onCancel={() => setConfirm(null)}
          />
        )}

        {confirm === "resetFlight" && (
          <ConfirmDialog
            title="Reset the flight?"
            message="The aircraft goes back to the launch pad with a full battery. Your build and wiring are untouched."
            detail="Mission gates and the current flight log will be cleared."
            confirmLabel="Reset flight"
            cancelLabel="Keep flying"
            tone="primary"
            onConfirm={() => {
              setConfirm(null);
              simRef.current?.reset(false);
              syncTelemetry();
            }}
            onCancel={() => setConfirm(null)}
          />
        )}
      </Viewport>

      {/* ============================================= right panel */}
      <aside className="panel right">
        <div className="tabs">
          {[
            { id: "diagnostics", label: "Health" },
            { id: "tree", label: "Logic tree" },
            { id: "flow", label: "Flight logic" },
            { id: "faults", label: "Failures" },
          ].map((t) => (
            <button
              key={t.id}
              className={`tab ${inspectorTab === t.id ? "active" : ""}`}
              onClick={() => setInspectorTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="panel-body">
          {inspectorTab === "diagnostics" && (
            <DiagnosticsPanel
              diagnostics={diagnostics}
              telemetry={telemetry}
              frame={frame}
              onOpenTree={openTree}
            />
          )}
          {inspectorTab === "tree" && (
            <>
              <div className="tabs" style={{ flexWrap: "wrap" }}>
                {[
                  "battery",
                  "pdb",
                  "fc",
                  "esc",
                  "motor",
                  "propeller",
                  "gps",
                  "transmitter",
                  "receiver",
                  "imu",
                  "compass",
                  "barometer",
                ].map((id) => (
                  <button
                    key={id}
                    className={`tab ${selectedTree === id ? "active" : ""}`}
                    onClick={() => setSelectedTree(id)}
                  >
                    {id.toUpperCase()}
                  </button>
                ))}
              </div>
              <LogicTreeViewer
                treeId={selectedTree}
                diagnostics={diagnostics}
                frame={frame}
              />
            </>
          )}
          {inspectorTab === "flow" && (
            <SystemFlow diagnostics={diagnostics} telemetry={telemetry} frame={frame} />
          )}
          {inspectorTab === "faults" && (
            <FaultPanel
              module={module}
              frame={frame}
              faults={faults}
              onToggle={toggleFault}
              onClear={clearFaults}
              onRandom={injectRandom}
              onOpenTree={openTree}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
