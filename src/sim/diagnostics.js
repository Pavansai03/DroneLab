/**
 * DIAGNOSTICS
 * ===========
 * The bridge between "what the student built" and "what the logic trees say".
 *
 * Every frame we build a small context object per component, walk that
 * component's decision tree, and report where it landed. That is what lets the
 * simulator answer the question the whole course is really about:
 *
 *     "It won't fly. WHY won't it fly, and which diagram tells me that?"
 */

import { LOGIC_TREES, evaluateTree } from "../data/logicTrees.js";
import { AIRFRAMES, classifyMotorFailure } from "../data/airframes.js";
import { PARTS, requiredQty } from "../data/parts.js";
import { wiringStatus } from "../data/wiring.js";
import { BATTERY_SPEC, ESC_LIMIT_C } from "./physics.js";
import { analyseAuthority } from "./mixer.js";

const TONE_RANK = { ok: 0, info: 1, warn: 2, bad: 3 };

/** Pick the most serious of a list of tree results. */
function worst(results) {
  return results.reduce(
    (acc, r) => (TONE_RANK[r.tone] > TONE_RANK[acc.tone] ? r : acc),
    results[0]
  );
}

/**
 * Build every context, evaluate every tree, and roll it up into a report.
 *
 * @param {object} build   what the student assembled (parts, links, flags, faults)
 * @param {object} runtime live simulator numbers (voltage, soc, ESC temps, sats...)
 */
export function runDiagnostics(build, runtime) {
  const frame = AIRFRAMES[build.frameId] || AIRFRAMES.quad;
  const n = frame.motorCount;
  const links = build.links instanceof Set ? build.links : new Set(build.links || []);
  const f = build.flags || {};
  const fault = build.faultState || {};

  /* One authority for every "is it wired?" question, so the checklist, the
     diagnostics panel and the wiring bench can never disagree. */
  const wiring = wiringStatus(frame, build.componentSet, links);

  const has = (partId) => (build.placed?.[partId]?.length || 0) > 0;
  const countOf = (partId) => build.placed?.[partId]?.length || 0;
  const allOf = (partId) =>
    countOf(partId) >= requiredQty(PARTS[partId], frame);
  const slot = (partId, i) => build.placed?.[partId]?.find((p) => p.slot === i);

  const dead = new Set([...(fault.deadMotor || []), ...(fault.deadEsc || [])]);
  const reversed = new Set(fault.reversedMotor || []);
  const wrongProp = new Set(fault.wrongProp || []);
  const loose = new Set(fault.looseProp || []);
  const jammed = new Set(fault.jammedMotor || []);
  const brokenPdb = new Set(fault.brokenPdbOutput || []);

  /* ---------------------------------------------------------- BATTERY */
  const batteryConnected =
    has("battery") && wiring.batteryToPower && fault.batteryConnected !== false;
  const soc = fault.socOverride ?? runtime.soc ?? 1;
  const voltage = fault.overVoltage ? 16.8 : (runtime.voltage ?? BATTERY_SPEC.vNominal);

  const ctxBattery = {
    connected: batteryConnected,
    voltage: batteryConnected ? voltage : 0,
    soc,
    sag: runtime.sag ?? 0,
  };

  /* -------------------------------------------------------------- PDB */
  // In Module 1 there is no PDB yet, so the battery lead feeds the ESCs directly.
  const pdbPresent = has("pdb") || !build.requiresPdb;
  const ctxPdb = {
    connected: batteryConnected && pdbPresent,
    brokenOutputs: brokenPdb.size,
  };

  /* --------------------------------------------------------- RECEIVER */
  const receiverPowered =
    has("receiver") && batteryConnected && fault.receiverPowered !== false;
  const receiverLinked =
    wiring.receiverToFc && fault.receiverLinked !== false;
  const ctxReceiver = {
    powered: receiverPowered,
    fcConnected: receiverLinked && has("fc"),
  };

  /* ------------------------------------------------------ TRANSMITTER */
  const txOn = has("transmitter") && fault.rcLink !== false;
  const ctxTransmitter = {
    on: txOn,
    bound: Boolean(f.bound) && fault.bound !== false,
  };

  /* -------------------------------------------------------------- GPS */
  const gpsPresent = has("gps") && fault.gpsPresent !== false;
  const satellites = gpsPresent
    ? (fault.satelliteOverride ?? runtime.satellites ?? 0)
    : 0;
  const ctxGps = {
    connected: gpsPresent && wiring.gpsToFc,
    satellites,
  };

  /* -------------------------------------------------------------- IMU */
  const ctxImu = {
    working: has("imu") && fault.imuWorking !== false,
    calibrated: Boolean(f.imuCalibrated) && fault.imuCalibrated !== false,
  };

  /* ---------------------------------------------------------- COMPASS */
  const ctxCompass = {
    working: has("compass") && fault.compassWorking !== false,
  };

  /* -------------------------------------------------------- BAROMETER */
  const ctxBarometer = {
    working: has("barometer") && fault.baroWorking !== false,
    stable: (runtime.propWash ?? 0) < 0.6,
  };

  /* ------------------------------------------------- FLIGHT CONTROLLER */
  const resReceiver = evaluateTree(LOGIC_TREES.receiver, ctxReceiver);
  const resTransmitter = evaluateTree(LOGIC_TREES.transmitter, ctxTransmitter);
  const resGps = evaluateTree(LOGIC_TREES.gps, ctxGps);
  const resImu = evaluateTree(LOGIC_TREES.imu, ctxImu);
  const resCompass = evaluateTree(LOGIC_TREES.compass, ctxCompass);
  const resBarometer = evaluateTree(LOGIC_TREES.barometer, ctxBarometer);

  const sensorsInitialized =
    has("fc") &&
    Boolean(f.fcConfigured) &&
    fault.fcConfigured !== false &&
    (!has("imu") || (ctxImu.working && ctxImu.calibrated)) &&
    (!has("compass") || ctxCompass.working);

  /* Module 1 has no radio yet — it is a bench hover test, and the flight
     controller is fed a simulated throttle. From Module 2 onward a real radio
     link is mandatory, exactly as the FC decision tree demands. */
  const benchMode = !(build.componentSet || []).includes("receiver");

  const ctxFc = {
    powered: has("fc") && batteryConnected && wiring.fcPowered,
    sensorsInitialized,
    receiverConnected:
      benchMode ||
      (ctxReceiver.powered && ctxReceiver.fcConnected && ctxTransmitter.bound && txOn),
    gpsAvailable: ctxGps.connected && satellites >= 8,
    benchMode,
  };

  /* ------------------------------------------------- PER-MOTOR CHAINS */
  const escResults = [];
  const motorResults = [];
  const propResults = [];
  const escContexts = [];
  const motorContexts = [];
  const propContexts = [];

  for (let i = 0; i < n; i++) {
    const escPlaced = Boolean(slot("esc", i));
    const motorPlaced = Boolean(slot("motor", i));
    const propPlaced = Boolean(slot("propeller", i));

    /* ESC */
    const cEsc = {
      motor: i,
      powered:
        escPlaced &&
        batteryConnected &&
        !brokenPdb.has(i) &&
        !dead.has(i) &&
        wiring.escPowered(i),
      signalConnected: wiring.escSignal(i) && has("fc"),
      pwmReceived: Boolean(runtime.armed) && ctxFc.powered,
      temperature: (runtime.escTemps?.[i] ?? 25) + (fault.escTempBoost?.[i] ?? 0),
    };
    escContexts.push(cEsc);
    escResults.push({ motor: i, ...evaluateTree(LOGIC_TREES.esc, cEsc) });

    /* MOTOR */
    const declaredSpin = frame.motors[i].spin;
    const motorVariant = slot("motor", i);
    const fittedReversed = reversed.has(i) || motorVariant?.reversed === true;
    const cMotor = {
      motor: i,
      connected: motorPlaced && wiring.motorPhases(i) && !dead.has(i),
      correctDirection: !fittedReversed && !fault.crossedOutputs,
      rpmResponding: !jammed.has(i),
      declaredSpin,
    };
    motorContexts.push(cMotor);
    motorResults.push({ motor: i, ...evaluateTree(LOGIC_TREES.motor, cMotor) });

    /* PROPELLER */
    const propVariant = slot("propeller", i);
    const requiredProp = declaredSpin === 1 ? "cw" : "ccw";
    const cProp = {
      motor: i,
      installed: propPlaced,
      correctProp:
        !wrongProp.has(i) && (!propVariant || propVariant.variant === requiredProp),
      tight: !loose.has(i),
      requiredProp,
    };
    propContexts.push(cProp);
    propResults.push({ motor: i, ...evaluateTree(LOGIC_TREES.propeller, cProp) });
  }

  /* --------------------------------------------------- ROLL EVERYTHING UP */
  const results = {
    battery: evaluateTree(LOGIC_TREES.battery, ctxBattery),
    pdb: evaluateTree(LOGIC_TREES.pdb, ctxPdb),
    fc: evaluateTree(LOGIC_TREES.fc, ctxFc),
    esc: worst(escResults),
    motor: worst(motorResults),
    propeller: worst(propResults),
    gps: resGps,
    transmitter: resTransmitter,
    receiver: resReceiver,
    imu: resImu,
    compass: resCompass,
    barometer: resBarometer,
  };

  const contexts = {
    battery: ctxBattery,
    pdb: ctxPdb,
    fc: ctxFc,
    esc: escContexts,
    motor: motorContexts,
    propeller: propContexts,
    gps: ctxGps,
    transmitter: ctxTransmitter,
    receiver: ctxReceiver,
    imu: ctxImu,
    compass: ctxCompass,
    barometer: ctxBarometer,
  };

  /* ------------------------------------------------------- PRE-FLIGHT */
  const missingRequiredLinks = wiring.missingRequired;

  const missingParts = (build.componentSet || [])
    .filter((id) => PARTS[id])
    .filter((id) => countOf(id) < requiredQty(PARTS[id], frame))
    .map((id) => ({
      id,
      label: PARTS[id].label,
      have: countOf(id),
      need: requiredQty(PARTS[id], frame),
    }));

  const preflight = [
    {
      id: "parts",
      label: "All components fitted",
      pass: missingParts.length === 0,
      detail:
        missingParts.length === 0
          ? "Complete bill of materials present."
          : missingParts
              .map((m) => `${m.label} ${m.have}/${m.need}`)
              .join(" · "),
    },
    {
      id: "wiring",
      label: "Required wiring complete",
      pass: wiring.allRequiredDone,
      detail:
        wiring.allRequiredDone
          ? `Every mandatory connection made (${wiring.requiredDone}).`
          : `${wiring.requiredTotal - wiring.requiredDone} wire(s) still missing in: ${missingRequiredLinks
              .slice(0, 2)
              .map((h) => h.title)
              .join(", ")}`,
    },
    {
      id: "battery",
      label: "Battery voltage in range",
      pass: results.battery.tone === "ok" || results.battery.tone === "warn",
      detail: `${ctxBattery.voltage.toFixed(2)} V · ${(soc * 100).toFixed(0)}% · ${results.battery.text}`,
    },
    {
      id: "power",
      label: "Power distribution healthy",
      pass: results.pdb.tone === "ok",
      detail: results.pdb.text,
    },
    {
      id: "escs",
      label: "All ESCs operational",
      pass: escResults.every((r) => r.tone === "ok"),
      detail: escResults.every((r) => r.tone === "ok")
        ? "All ESCs report normal operation."
        : escResults
            .filter((r) => r.tone !== "ok")
            .map((r) => `ESC ${r.motor + 1}: ${r.text}`)
            .join(" · "),
    },
    {
      id: "motors",
      label: "Motor directions correct",
      pass: motorResults.every((r) => r.tone === "ok"),
      detail: motorResults.every((r) => r.tone === "ok")
        ? "Every motor generates lift in the correct sense."
        : motorResults
            .filter((r) => r.tone !== "ok")
            .map((r) => `M${r.motor + 1}: ${r.text}`)
            .join(" · "),
    },
    {
      id: "props",
      label: "Propellers correct and tight",
      pass: propResults.every((r) => r.tone === "ok"),
      detail: propResults.every((r) => r.tone === "ok")
        ? "CW props on CW motors, all torqued."
        : propResults
            .filter((r) => r.tone !== "ok")
            .map((r) => `P${r.motor + 1}: ${r.text}`)
            .join(" · "),
    },
    {
      id: "sensors",
      label: "Sensors initialised & calibrated",
      pass: sensorsInitialized,
      detail: sensorsInitialized
        ? "IMU, compass and barometer report healthy."
        : !has("fc")
          ? "No flight controller fitted."
          : !f.fcConfigured
            ? "Flight controller not configured."
            : !ctxImu.working
              ? "IMU not working — attitude unknown."
              : !ctxImu.calibrated
                ? "IMU not calibrated — the drone will drift."
                : "Compass error — heading unreliable.",
    },
    {
      id: "rc",
      label: benchMode ? "Bench hover test (no radio fitted)" : "Radio link established",
      pass: ctxFc.receiverConnected,
      detail: benchMode
        ? "This module has no transmitter or receiver yet, so throttle is simulated on the bench. Module 2 adds the real radio link."
        : ctxFc.receiverConnected
          ? "Transmitter bound, receiver forwarding stick data."
          : resTransmitter.tone !== "ok"
            ? resTransmitter.text
            : resReceiver.text,
    },
    {
      id: "gps",
      label: "GPS lock (needed for position modes)",
      pass: ctxFc.gpsAvailable,
      required: false,
      detail: `${satellites} satellite(s) · ${resGps.text}`,
    },
  ];

  const blocking = preflight.filter((c) => c.required !== false && !c.pass);
  const readyToFly = blocking.length === 0 && results.fc.terminalId === "readyToFly";

  /* -------------------------------------------- MULTI-ROTOR FAILURE MODEL */
  const deadList = [...dead].sort((a, b) => a - b);
  const failureClass = classifyMotorFailure(frame, deadList);
  const authority = analyseAuthority(
    frame,
    dead,
    runtime.thrustPerMotorN ?? 0,
    runtime.weightN ?? 0
  );

  return {
    frame,
    contexts,
    results,
    perMotor: { esc: escResults, motor: motorResults, propeller: propResults },
    preflight,
    blocking,
    readyToFly,
    missingParts,
    missingRequiredLinks,
    wiring,
    failureClass,
    authority,
    deadMotors: deadList,
    flightMode: pickFlightMode(ctxFc, results),
  };
}

/**
 * Which flight mode the FC would actually give the pilot right now.
 * This mirrors the bottom row of the Flight Controller logic tree.
 */
function pickFlightMode(ctxFc, results) {
  if (!ctxFc.powered) return { id: "dead", label: "DRONE DEAD", tone: "bad" };
  if (!ctxFc.sensorsInitialized)
    return { id: "denied", label: "ARMING DENIED", tone: "bad" };
  if (!ctxFc.receiverConnected)
    return { id: "failsafe", label: "FAILSAFE", tone: "bad" };
  if (ctxFc.benchMode)
    return { id: "manual", label: "BENCH MODE — no radio fitted", tone: "warn" };
  if (!ctxFc.gpsAvailable)
    return { id: "manual", label: "MANUAL (no position hold)", tone: "warn" };
  return { id: "ready", label: "READY TO FLY — GPS", tone: "ok" };
}

/** Human-readable crash report, used by the CrashReport panel in Module 5. */
export function buildCrashReport(diag, runtime, cause) {
  const lines = [];
  lines.push({ k: "Airframe", v: `${diag.frame.label} (${diag.frame.motorCount} motors)` });
  lines.push({ k: "Primary cause", v: cause || "Loss of control" });
  lines.push({
    k: "Altitude at loss",
    v: `${(runtime.altitude ?? 0).toFixed(1)} m`,
  });
  lines.push({
    k: "Ground speed",
    v: `${(runtime.groundSpeed ?? 0).toFixed(1)} m/s`,
  });
  lines.push({
    k: "Battery",
    v: `${(runtime.voltage ?? 0).toFixed(2)} V · ${((runtime.soc ?? 0) * 100).toFixed(0)}%`,
  });

  if (diag.deadMotors.length) {
    lines.push({
      k: "Motors lost",
      v: diag.deadMotors.map((i) => `M${i + 1}`).join(", "),
    });
  }
  if (diag.authority && !diag.authority.fullAuthority) {
    lines.push({
      k: "Control axes lost",
      v: diag.authority.lostAxes.join(", ").toUpperCase() || "none",
    });
  }

  const failing = Object.entries(diag.results)
    .filter(([, r]) => r.tone === "bad")
    .map(([id, r]) => `${id.toUpperCase()}: ${r.text}`);

  return {
    lines,
    failingTrees: failing,
    failureModel: diag.failureClass,
  };
}
