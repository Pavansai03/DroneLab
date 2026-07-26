import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AIRFRAMES } from "./data/airframes.js";
import { PARTS, requiredQty, defaultVariant } from "./data/parts.js";
import { buildWiringSpec } from "./data/wiring.js";
import {
  MODULES,
  MODULE_BY_ID,
  FAILURES,
  RANDOM_FAILURE_POOL,
} from "./data/curriculum.js";

import { FlightSim } from "./sim/flightSim.js";
import { runDiagnostics, buildCrashReport } from "./sim/diagnostics.js";
import { buildProgressApi, evaluateModule } from "./sim/progress.js";

import Viewport from "./components/Viewport.jsx";
import PartsLibrary from "./components/PartsLibrary.jsx";
import TaskChecklist from "./components/TaskChecklist.jsx";
import WiringBench from "./components/WiringBench.jsx";
import LogicTreeViewer from "./components/LogicTreeViewer.jsx";
import DiagnosticsPanel from "./components/DiagnosticsPanel.jsx";
import EnvironmentPanel from "./components/EnvironmentPanel.jsx";
import FaultPanel from "./components/FaultPanel.jsx";
import SystemFlow from "./components/SystemFlow.jsx";
import FramePicker from "./components/FramePicker.jsx";
import FlightHUD from "./components/FlightHUD.jsx";
import CrashReport from "./components/CrashReport.jsx";
import { Arrow, ArrowLeft, Reset, Bolt, Warn } from "./components/Icons.jsx";

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
  "gps",
  "compass",
  "battery",
  "propeller",
];

const EMPTY_FLAGS = {
  bound: false,
  fcConfigured: false,
  imuCalibrated: false,
  compassCalibrated: false,
  escCalibrated: false,
  powered: false,
  motorTestPassed: false,
  wiringValidated: false,
  preflightPassed: false,
  envConfigured: false,
  payloadConfigured: false,
  frameChosen: false,
  failureExperienced: false,
  faultDiagnosed: false,
  faultRepaired: false,
  crashed: false,
};

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

export default function App() {
  /* ------------------------------------------------------- curriculum */
  const [moduleId, setModuleId] = useState("m1");
  const module = MODULE_BY_ID[moduleId];
  const [completedModules, setCompletedModules] = useState(() => new Set());
  // Lets a teacher jump straight to any module to demonstrate, without having to
  // work through the earlier ones live in front of a class.
  const [allUnlocked, setAllUnlocked] = useState(false);

  /* ------------------------------------------------------------ build */
  const [frameId, setFrameId] = useState("quad");
  const [placed, setPlaced] = useState({});
  const [links, setLinks] = useState(() => new Set());
  const [flags, setFlags] = useState(EMPTY_FLAGS);
  const [faults, setFaults] = useState([]);
  const [variants, setVariants] = useState({});
  const [env, setEnv] = useState(DEFAULT_ENV);

  /* ---------------------------------------------------------- session */
  const [mode, setMode] = useState("assembly");
  const [sidebarTab, setSidebarTab] = useState("tasks");
  const [inspectorTab, setInspectorTab] = useState("diagnostics");
  const [selectedTree, setSelectedTree] = useState("fc");
  const [telemetry, setTelemetry] = useState(null);
  const [crashReport, setCrashReport] = useState(null);
  const [notice, setNotice] = useState(null);
  const [testing, setTesting] = useState(false);

  const frame = AIRFRAMES[frameId];
  const sceneRef = useRef(null);
  const simRef = useRef(null);
  const keysRef = useRef({});
  const rafRef = useRef(0);

  /* Module 1-2 are locked to a quadcopter, per the course notes. */
  useEffect(() => {
    if (module.frameLocked && frameId !== module.frameLocked) {
      setFrameId(module.frameLocked);
    }
  }, [module, frameId]);

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
  const gpsWired = Boolean(placed.gps?.length) && links.has("gps->fc");
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

  /* --------------------------------------------------------- progress */
  const progressApi = useMemo(
    () =>
      buildProgressApi({
        build,
        frame,
        telemetry,
        diagnostics,
        completedModules,
      }),
    [build, frame, telemetry, diagnostics, completedModules]
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

  /* -------------------------------------------------- the active part */
  const filledSlots = useMemo(() => {
    const s = new Set();
    Object.entries(placed).forEach(([partId, items]) =>
      items.forEach((it) => s.add(`${partId}:${it.slot}`))
    );
    return s;
  }, [placed]);

  const activePart = useMemo(() => {
    for (const id of BUILD_ORDER) {
      if (!componentSet.includes(id)) continue;
      const def = PARTS[id];
      if (!def) continue;
      if ((placed[id]?.length || 0) < requiredQty(def, frame)) return id;
    }
    return null;
  }, [componentSet, placed, frame]);

  /* ------------------------------------------------------ simulator */
  useEffect(() => {
    simRef.current = new FlightSim();
    return () => {
      cancelAnimationFrame(rafRef.current);
      simRef.current = null;
    };
  }, []);

  /** Capabilities the simulator needs, derived from the build and injected faults. */
  const capabilities = useMemo(
    () => ({
      gps: Boolean(placed.gps?.length) && links.has("gps->fc") && faultState.gpsPresent !== false,
      satelliteCap: faultState.satelliteOverride ?? 12,
      positionHold:
        Boolean(placed.gps?.length) &&
        links.has("gps->fc") &&
        faultState.compassWorking !== false,
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
    [placed, links, faultState, flags.imuCalibrated, componentSet]
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
      }
      if (type === "escShutdown") {
        setNotice(
          `ESC ${payload.motor + 1} hit ${payload.temp.toFixed(0)} degC and shut down — see the ESC logic tree.`
        );
      }
      if (type === "propDeparted") {
        setNotice(`Propeller ${payload.motor + 1} departed the aircraft — it was loose.`);
      }
      if (type === "failsafe") setNotice("Radio link lost — FAILSAFE engaged.");
      if (type === "lowBatteryRth") setNotice("Battery below 20% — Return-To-Home triggered.");
      if (type === "missionComplete") setNotice("Mission complete — all gates passed.");
    });
  }, [diagnostics]);

  /* The render/physics loop. Only runs in flight mode. */
  useEffect(() => {
    if (mode !== "flight") {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const sim = simRef.current;
    if (!sim) return;

    let last = performance.now();
    let acc = 0;
    let sinceSnapshot = 0;
    const STEP = 1 / 120; // fixed-step physics keeps the PID stable

    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard++ < 12) {
        sim.step(STEP);
        acc -= STEP;
      }
      sinceSnapshot += dt;
      if (sinceSnapshot > 1 / 20) {
        sinceSnapshot = 0;
        setTelemetry({ ...sim.telemetry(), keys: { ...keysRef.current } });
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mode]);

  /* Keyboard */
  useEffect(() => {
    const down = (e) => {
      if (e.target?.tagName === "INPUT") return;
      keysRef.current[e.code] = true;
      simRef.current?.setKey(e.code, true);
      if (e.code === "Space") e.preventDefault();
    };
    const up = (e) => {
      keysRef.current[e.code] = false;
      simRef.current?.setKey(e.code, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5200);
    return () => clearTimeout(t);
  }, [notice]);

  /* --------------------------------------------------------- actions */

  const handlePlace = useCallback(
    (partId, slot) => {
      const def = PARTS[partId];
      setPlaced((prev) => {
        const list = prev[partId] || [];
        if (list.some((x) => x.slot === slot)) return prev;
        // Propellers and motors inherit the slot's required direction unless the
        // student has deliberately picked a variant.
        const slotSpin = frame.motors[slot]?.spin;
        let variant = variants[partId] || defaultVariant(def, frame);
        if (partId === "propeller" && !variants.propeller) {
          variant = slotSpin === 1 ? "cw" : "ccw";
        }
        return { ...prev, [partId]: [...list, { slot, variant }] };
      });
      if (partId === "frame") setFlags((f) => ({ ...f, frameChosen: true }));
    },
    [frame, variants]
  );

  const toggleLink = useCallback((id) => {
    setLinks((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setFlags((f) => ({ ...f, wiringValidated: false }));
  }, []);

  const connectAll = useCallback(() => {
    const spec = buildWiringSpec(frame, { components: componentSet });
    const canWire = (link) => {
      const partFor = (n) =>
        n.startsWith("esc") ? "esc" : n.startsWith("motor") ? "motor" : n;
      const has = (n) => {
        const p = partFor(n);
        if (p === "pdb" && !placed.pdb?.length) return Boolean(placed.battery?.length);
        return Boolean(placed[p]?.length);
      };
      return link.available !== false && has(link.from) && has(link.to);
    };
    setLinks(new Set(spec.filter(canWire).map((l) => l.id)));
  }, [frame, placed, componentSet]);

  const toggleFault = useCallback((id, motor) => {
    setFaults((prev) => {
      const exists = prev.some((f) => f.id === id && f.motor === motor);
      if (exists) return prev.filter((f) => !(f.id === id && f.motor === motor));
      return [...prev, { id, motor }];
    });
    setFlags((f) => ({ ...f, failureExperienced: true, faultRepaired: false }));
  }, []);

  const clearFaults = useCallback(() => {
    setFaults([]);
    setFlags((f) => ({ ...f, faultRepaired: true, crashed: false }));
    simRef.current?.reset(true);
    setCrashReport(null);
  }, []);

  const injectRandom = useCallback(() => {
    const pool = (module.unlocks?.randomFailures ? RANDOM_FAILURE_POOL : module.failures) || [];
    const usable = pool.filter((id) => FAILURES[id]);
    if (!usable.length) return;
    const id = usable[Math.floor(Math.random() * usable.length)];
    const def = FAILURES[id];
    const motor = def.perMotor ? Math.floor(Math.random() * frame.motorCount) : undefined;
    setFaults((prev) => [...prev, { id, motor }]);
    setFlags((f) => ({ ...f, failureExperienced: true, faultRepaired: false }));
    setNotice("A fault has been injected. Diagnose it using the logic trees.");
  }, [module, frame.motorCount]);

  const resetBuild = useCallback(() => {
    setPlaced({});
    setLinks(new Set());
    setFlags(EMPTY_FLAGS);
    setFaults([]);
    setCrashReport(null);
    setTelemetry(null);
    setMode("assembly");
    simRef.current?.reset();
  }, []);

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
              `${missing.length} required connection(s) missing. Open the Wiring tab.`
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
    if (module.unlocks?.environment) {
      a.push({
        id: "envDone",
        label: "Confirm environment & payload",
        onClick: () => {
          setFlags((f) => ({ ...f, envConfigured: true, payloadConfigured: true }));
          setSidebarTab("environment");
          setNotice("Environment locked in. The flight model is using these numbers.");
        },
      });
    }
    if (module.unlocks?.randomFailures) {
      a.push({
        id: "diagnosed",
        label: "Mark fault as diagnosed",
        disabled: faults.length === 0,
        onClick: () => {
          setFlags((f) => ({ ...f, faultDiagnosed: true }));
          setNotice("Diagnosis recorded. Now repair it.");
        },
      });
      a.push({
        id: "repair",
        label: "Repair the aircraft",
        disabled: faults.length === 0,
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

  const canFly =
    (placed.propeller?.length || 0) >= frame.motorCount &&
    (placed.battery?.length || 0) > 0 &&
    (placed.motor?.length || 0) >= frame.motorCount;

  const sidebarTabs = useMemo(() => {
    const t = [{ id: "tasks", label: "Tasks" }];
    if (module.components?.length) t.push({ id: "parts", label: "Parts" });
    if (module.unlocks?.wiring) t.push({ id: "wiring", label: "Wiring" });
    if (module.unlocks?.environment) t.push({ id: "environment", label: "Environment" });
    t.push({ id: "airframe", label: "Airframe" });
    return t;
  }, [module]);

  useEffect(() => {
    if (!sidebarTabs.some((t) => t.id === sidebarTab)) setSidebarTab("tasks");
  }, [sidebarTabs, sidebarTab]);

  const currentTask = progress.current;

  return (
    <div className="app">
      {/* ============================================= top bar */}
      <header className="topbar">
        <div className="brand">
          <span className="dot">&#9670;</span>
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
              onClick={() => {
                simRef.current?.reset(false);
                syncTelemetry();
              }}
            >
              <Reset /> Reset flight
            </button>
            <button className="btn" onClick={backToHangar}>
              <ArrowLeft /> Hangar
            </button>
          </>
        )}
        <button className="btn" onClick={resetBuild} title="Strip the build">
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
              onRemove={resetBuild}
            />
          )}
          {sidebarTab === "wiring" && (
            <WiringBench
              frame={frame}
              links={links}
              placed={placed}
              componentSet={componentSet}
              onToggle={toggleLink}
              onConnectAll={connectAll}
            />
          )}
          {sidebarTab === "environment" && (
            <EnvironmentPanel
              env={env}
              frame={frame}
              build={build}
              telemetry={telemetry}
              onChange={(k, v) => {
                setEnv((e) => ({ ...e, [k]: v }));
                setFlags((f) => ({
                  ...f,
                  envConfigured: true,
                  payloadConfigured: k === "payload" ? true : f.payloadConfigured,
                }));
              }}
            />
          )}
          {sidebarTab === "airframe" && (
            <FramePicker
              frameId={frameId}
              lockedTo={module.frameLocked}
              onPick={(id) => {
                setFrameId(id);
                setPlaced({});
                setLinks(new Set());
                setFlags((f) => ({ ...EMPTY_FLAGS, frameChosen: true }));
                setFaults([]);
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
