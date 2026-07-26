/**
 * COMPONENT DECISION LOGIC
 * ========================
 * These are the decision trees from the course notes (sections 1-13), encoded so
 * they can do two jobs at once:
 *
 *   1. Be DRAWN as the flowchart the students study, and
 *   2. Be WALKED at 30 Hz against live simulator state, lighting up the exact
 *      branch the aircraft is actually taking right now.
 *
 * Node shapes:
 *   decision -> has `test(ctx)`, plus `yes` and `no` successors
 *   outcome  -> a terminal or pass-through result, optional `next`
 *
 * `tone` drives the colour: ok (green) | warn (amber) | bad (red) | info (blue)
 *
 * `ctx` is built per component by sim/diagnostics.js.
 */

export const LOGIC_TREES = {
  /* ================================================================ 1. BATTERY */
  battery: {
    id: "battery",
    title: "Battery Logic",
    subtitle: "3S Li-Po · 11.1 V nominal · 12.6 V full · 10.5 V cutoff",
    root: "connected",
    nodes: {
      connected: {
        type: "decision",
        text: "Battery Connected?",
        test: (c) => c.connected,
        no: "noPower",
        yes: "voltageOk",
      },
      noPower: { type: "outcome", text: "No Power", tone: "bad", next: "droneDead" },
      droneDead: { type: "outcome", text: "Drone Dead", tone: "bad" },

      voltageOk: {
        type: "decision",
        text: "Voltage In Range? (10.5 - 12.6 V)",
        test: (c) => c.voltage >= 10.5 && c.voltage <= 12.7,
        no: "voltageFault",
        yes: "capacityOk",
      },
      voltageFault: {
        type: "decision",
        text: "Over-Voltage?",
        test: (c) => c.voltage > 12.7,
        yes: "overVoltage",
        no: "underVoltage",
      },
      overVoltage: {
        type: "outcome",
        text: "Over-Voltage — Wrong Cell Count",
        tone: "bad",
        next: "escDamage",
      },
      escDamage: { type: "outcome", text: "ESC / FC Damage Risk", tone: "bad" },
      underVoltage: {
        type: "outcome",
        text: "Under-Voltage",
        tone: "bad",
        next: "forcedLanding",
      },
      forcedLanding: {
        type: "outcome",
        text: "Failsafe Land Now",
        tone: "bad",
        next: "cellDamage",
      },
      cellDamage: { type: "outcome", text: "Permanent Cell Damage", tone: "bad" },

      capacityOk: {
        type: "decision",
        text: "Remaining Capacity > 20%?",
        test: (c) => c.soc > 0.2,
        no: "lowBattery",
        yes: "sagOk",
      },
      lowBattery: {
        type: "outcome",
        text: "Low Battery Warning",
        tone: "warn",
        next: "rthTriggered",
      },
      rthTriggered: { type: "outcome", text: "Return To Home Triggered", tone: "warn" },

      sagOk: {
        type: "decision",
        text: "Voltage Sag Under Load OK?",
        test: (c) => c.sag < 1.2,
        no: "brownout",
        yes: "normalPower",
      },
      brownout: {
        type: "outcome",
        text: "Brown-Out Risk",
        tone: "warn",
        next: "fcReboot",
      },
      fcReboot: { type: "outcome", text: "FC May Reboot In Flight", tone: "bad" },
      normalPower: { type: "outcome", text: "Normal Power Delivery", tone: "ok" },
    },
  },

  /* ==================================================================== 2. PDB */
  pdb: {
    id: "pdb",
    title: "Power Distribution Board Logic",
    subtitle: "Splits one battery lead into one feed per ESC",
    root: "connected",
    nodes: {
      connected: {
        type: "decision",
        text: "PDB Connected?",
        test: (c) => c.connected,
        no: "escOff",
        yes: "wireBroken",
      },
      escOff: { type: "outcome", text: "ESC OFF", tone: "bad", next: "droneOff" },
      droneOff: { type: "outcome", text: "Drone OFF", tone: "bad" },

      wireBroken: {
        type: "decision",
        text: "Output Wire Broken?",
        test: (c) => c.brokenOutputs > 0,
        yes: "escLosesPower",
        no: "normalDistribution",
      },
      escLosesPower: {
        type: "outcome",
        text: "Connected ESC Loses Power",
        tone: "bad",
        next: "motorStops",
      },
      motorStops: {
        type: "outcome",
        text: "Motor Stops",
        tone: "bad",
        next: "fcReportsPowerFailure",
      },
      fcReportsPowerFailure: {
        type: "outcome",
        text: "FC Reports Power Failure",
        tone: "bad",
      },
      normalDistribution: {
        type: "outcome",
        text: "Normal Power Distribution",
        tone: "ok",
      },
    },
  },

  /* ======================================================= 3. FLIGHT CONTROLLER */
  fc: {
    id: "fc",
    title: "Flight Controller Logic",
    subtitle: "The arming chain — every check must pass before the motors will spin",
    root: "powered",
    nodes: {
      powered: {
        type: "decision",
        text: "FC Powered?",
        test: (c) => c.powered,
        no: "cannotArm",
        yes: "sensorsInit",
      },
      cannotArm: {
        type: "outcome",
        text: "Cannot Arm",
        tone: "bad",
        next: "motorsDisabled",
      },
      motorsDisabled: {
        type: "outcome",
        text: "Motors Disabled",
        tone: "bad",
        next: "droneDead",
      },
      droneDead: { type: "outcome", text: "Drone Dead", tone: "bad" },

      sensorsInit: {
        type: "decision",
        text: "Sensors Initialized?",
        test: (c) => c.sensorsInitialized,
        no: "calibrationError",
        yes: "receiverConnected",
      },
      calibrationError: {
        type: "outcome",
        text: "Calibration Error",
        tone: "bad",
        next: "redLed",
      },
      redLed: { type: "outcome", text: "Red LED", tone: "bad", next: "armingDenied" },
      armingDenied: { type: "outcome", text: "Arming Denied", tone: "bad" },

      receiverConnected: {
        type: "decision",
        text: "Receiver Connected?",
        test: (c) => c.receiverConnected,
        no: "noRcSignal",
        yes: "gpsAvailable",
      },
      noRcSignal: {
        type: "outcome",
        text: "No RC Signal",
        tone: "bad",
        next: "failsafe",
      },
      failsafe: { type: "outcome", text: "Failsafe", tone: "bad", next: "cannotFly" },
      cannotFly: { type: "outcome", text: "Cannot Fly", tone: "bad" },

      gpsAvailable: {
        type: "decision",
        text: "GPS Available?",
        test: (c) => c.gpsAvailable,
        no: "manualMode",
        yes: "readyToFly",
      },
      manualMode: {
        type: "outcome",
        text: "Manual Mode",
        tone: "warn",
        next: "noPositionHold",
      },
      noPositionHold: { type: "outcome", text: "No Position Hold", tone: "warn" },
      readyToFly: { type: "outcome", text: "Ready to Fly", tone: "ok" },
    },
  },

  /* ==================================================================== 4. ESC */
  esc: {
    id: "esc",
    title: "ESC Logic",
    subtitle: "Per-motor speed controller — thermal limit 90 degC",
    root: "powered",
    nodes: {
      powered: {
        type: "decision",
        text: "ESC Powered?",
        test: (c) => c.powered,
        no: "motorOff",
        yes: "signalWire",
      },
      motorOff: {
        type: "outcome",
        text: "Motor OFF",
        tone: "bad",
        next: "fcMotorError",
      },
      fcMotorError: { type: "outcome", text: "FC Motor Error", tone: "bad" },

      signalWire: {
        type: "decision",
        text: "Signal Wire Connected?",
        test: (c) => c.signalConnected,
        no: "motorIdle",
        yes: "pwmReceived",
      },
      motorIdle: {
        type: "outcome",
        text: "Motor Idle",
        tone: "warn",
        next: "escWaiting",
      },
      escWaiting: { type: "outcome", text: "ESC Waiting", tone: "warn" },

      pwmReceived: {
        type: "decision",
        text: "PWM Received?",
        test: (c) => c.pwmReceived,
        no: "motorOff2",
        yes: "overTemp",
      },
      motorOff2: { type: "outcome", text: "Motor OFF", tone: "bad" },

      overTemp: {
        type: "decision",
        text: "Temperature > 90 degC?",
        test: (c) => c.temperature > 90,
        yes: "overheat",
        no: "normalOperation",
      },
      overheat: {
        type: "outcome",
        text: "Overheat",
        tone: "bad",
        next: "reducePower",
      },
      reducePower: {
        type: "outcome",
        text: "Reduce Power",
        tone: "bad",
        next: "shutdown",
      },
      shutdown: { type: "outcome", text: "Shutdown", tone: "bad" },
      normalOperation: { type: "outcome", text: "Normal Operation", tone: "ok" },
    },
  },

  /* ================================================================== 5. MOTOR */
  motor: {
    id: "motor",
    title: "Motor Logic",
    subtitle: "Brushless outrunner — direction and RPM",
    root: "connected",
    nodes: {
      connected: {
        type: "decision",
        text: "Motor Connected?",
        test: (c) => c.connected,
        no: "noRpm",
        yes: "correctDirection",
      },
      noRpm: { type: "outcome", text: "No RPM", tone: "bad", next: "fcMotorError" },
      fcMotorError: { type: "outcome", text: "FC Motor Error", tone: "bad" },

      correctDirection: {
        type: "decision",
        text: "Correct Direction?",
        test: (c) => c.correctDirection,
        no: "reverseRotation",
        yes: "rpmIncreasing",
      },
      reverseRotation: {
        type: "outcome",
        text: "Reverse Rotation",
        tone: "bad",
        next: "wrongThrust",
      },
      wrongThrust: {
        type: "outcome",
        text: "Wrong Thrust",
        tone: "bad",
        next: "droneFlips",
      },
      droneFlips: { type: "outcome", text: "Drone Flips", tone: "bad" },

      rpmIncreasing: {
        type: "decision",
        text: "RPM Increasing?",
        test: (c) => c.rpmResponding,
        no: "motorJam",
        yes: "generateLift",
      },
      motorJam: { type: "outcome", text: "Motor Jam", tone: "bad", next: "stall" },
      stall: { type: "outcome", text: "Stall", tone: "bad", next: "escOvercurrent" },
      escOvercurrent: { type: "outcome", text: "ESC Overcurrent", tone: "bad" },
      generateLift: { type: "outcome", text: "Generate Lift", tone: "ok" },
    },
  },

  /* ============================================================== 6. PROPELLER */
  propeller: {
    id: "propeller",
    title: "Propeller Logic",
    subtitle: "Converts shaft RPM into thrust — fit LAST, always",
    root: "installed",
    nodes: {
      installed: {
        type: "decision",
        text: "Propeller Installed?",
        test: (c) => c.installed,
        no: "motorSpins",
        yes: "correctProp",
      },
      motorSpins: { type: "outcome", text: "Motor Spins", tone: "warn", next: "noLift" },
      noLift: { type: "outcome", text: "No Lift", tone: "bad" },

      correctProp: {
        type: "decision",
        text: "Correct Prop?",
        test: (c) => c.correctProp,
        no: "wrongAirflow",
        yes: "tight",
      },
      wrongAirflow: {
        type: "outcome",
        text: "Wrong Airflow",
        tone: "bad",
        next: "droneFlips",
      },
      droneFlips: { type: "outcome", text: "Drone Flips", tone: "bad", next: "crash1" },
      crash1: { type: "outcome", text: "Crash", tone: "bad" },

      tight: {
        type: "decision",
        text: "Tight?",
        test: (c) => c.tight,
        no: "vibration",
        yes: "liftGenerated",
      },
      vibration: {
        type: "outcome",
        text: "Vibration",
        tone: "warn",
        next: "propFalls",
      },
      propFalls: { type: "outcome", text: "Prop Falls", tone: "bad", next: "crash2" },
      crash2: { type: "outcome", text: "Crash", tone: "bad" },
      liftGenerated: { type: "outcome", text: "Lift Generated", tone: "ok" },
    },
  },

  /* ==================================================================== 7. GPS */
  gps: {
    id: "gps",
    title: "GPS Logic",
    subtitle: "Needs 8+ satellites before position modes are trusted",
    root: "connected",
    nodes: {
      connected: {
        type: "decision",
        text: "GPS Connected?",
        test: (c) => c.connected,
        no: "manualOnly",
        yes: "satellites",
      },
      manualOnly: {
        type: "outcome",
        text: "Manual Flight Only",
        tone: "warn",
        next: "noNavigation",
      },
      noNavigation: { type: "outcome", text: "No Navigation", tone: "warn" },

      satellites: {
        type: "decision",
        text: "Satellites >= 8?",
        test: (c) => c.satellites >= 8,
        no: "searching",
        yes: "positionHold",
      },
      searching: {
        type: "outcome",
        text: "Searching",
        tone: "warn",
        next: "positionHoldDisabled",
      },
      positionHoldDisabled: {
        type: "outcome",
        text: "Position Hold Disabled",
        tone: "warn",
      },

      positionHold: {
        type: "outcome",
        text: "Position Hold",
        tone: "ok",
        next: "returnHome",
      },
      returnHome: {
        type: "outcome",
        text: "Return Home",
        tone: "ok",
        next: "autoMission",
      },
      autoMission: { type: "outcome", text: "Auto Mission", tone: "ok" },
    },
  },

  /* ============================================================ 8. TRANSMITTER */
  transmitter: {
    id: "transmitter",
    title: "Transmitter Logic",
    subtitle: "Pilot's radio — must be ON and BOUND",
    root: "on",
    nodes: {
      on: {
        type: "decision",
        text: "Transmitter ON?",
        test: (c) => c.on,
        no: "receiverNoSignal",
        yes: "bound",
      },
      receiverNoSignal: {
        type: "outcome",
        text: "Receiver No Signal",
        tone: "bad",
        next: "failsafe",
      },
      failsafe: { type: "outcome", text: "Failsafe", tone: "bad" },

      bound: {
        type: "decision",
        text: "Bound?",
        test: (c) => c.bound,
        no: "noCommunication",
        yes: "sendCommands",
      },
      noCommunication: {
        type: "outcome",
        text: "No Communication",
        tone: "bad",
        next: "cannotArm",
      },
      cannotArm: { type: "outcome", text: "Cannot Arm", tone: "bad" },
      sendCommands: { type: "outcome", text: "Send Control Commands", tone: "ok" },
    },
  },

  /* =============================================================== 9. RECEIVER */
  receiver: {
    id: "receiver",
    title: "Receiver Logic",
    subtitle: "Turns radio packets into stick data on the SBUS wire",
    root: "powered",
    nodes: {
      powered: {
        type: "decision",
        text: "Receiver Powered?",
        test: (c) => c.powered,
        no: "noRcSignal",
        yes: "fcConnected",
      },
      noRcSignal: { type: "outcome", text: "No RC Signal", tone: "bad" },

      fcConnected: {
        type: "decision",
        text: "FC Connected?",
        test: (c) => c.fcConnected,
        no: "commandsLost",
        yes: "forwardStickData",
      },
      commandsLost: { type: "outcome", text: "Commands Lost", tone: "bad" },
      forwardStickData: { type: "outcome", text: "Forward Stick Data", tone: "ok" },
    },
  },

  /* =================================================================== 10. IMU */
  imu: {
    id: "imu",
    title: "IMU Logic",
    subtitle: "Gyroscope + accelerometer — the drone's sense of balance",
    root: "working",
    nodes: {
      working: {
        type: "decision",
        text: "IMU Working?",
        test: (c) => c.working,
        no: "attitudeUnknown",
        yes: "calibrationOk",
      },
      attitudeUnknown: {
        type: "outcome",
        text: "Attitude Unknown",
        tone: "bad",
        next: "cannotStabilize",
      },
      cannotStabilize: {
        type: "outcome",
        text: "FC Cannot Stabilize",
        tone: "bad",
        next: "crash",
      },
      crash: { type: "outcome", text: "Crash", tone: "bad" },

      calibrationOk: {
        type: "decision",
        text: "Calibration OK?",
        test: (c) => c.calibrated,
        no: "drift",
        yes: "stableFlight",
      },
      drift: { type: "outcome", text: "Drift", tone: "warn", next: "badFlight" },
      badFlight: { type: "outcome", text: "Bad Flight", tone: "warn" },
      stableFlight: { type: "outcome", text: "Stable Flight", tone: "ok" },
    },
  },

  /* =============================================================== 11. COMPASS */
  compass: {
    id: "compass",
    title: "Compass Logic",
    subtitle: "Magnetometer — supplies heading for navigation and RTH",
    root: "working",
    nodes: {
      working: {
        type: "decision",
        text: "Compass Working?",
        test: (c) => c.working,
        no: "wrongHeading",
        yes: "correctHeading",
      },
      wrongHeading: {
        type: "outcome",
        text: "Wrong Heading",
        tone: "bad",
        next: "rthError",
      },
      rthError: {
        type: "outcome",
        text: "RTH Error",
        tone: "bad",
        next: "navigationFailure",
      },
      navigationFailure: { type: "outcome", text: "Navigation Failure", tone: "bad" },
      correctHeading: { type: "outcome", text: "Correct Heading", tone: "ok" },
    },
  },

  /* ============================================================= 12. BAROMETER */
  barometer: {
    id: "barometer",
    title: "Barometer Logic",
    subtitle: "Pressure altitude — the reference for altitude hold",
    root: "working",
    nodes: {
      working: {
        type: "decision",
        text: "Barometer Working?",
        test: (c) => c.working,
        no: "noAltitudeRef",
        yes: "stableReading",
      },
      noAltitudeRef: {
        type: "outcome",
        text: "No Altitude Reference",
        tone: "bad",
        next: "altHoldDisabled",
      },
      altHoldDisabled: {
        type: "outcome",
        text: "Altitude Hold Disabled",
        tone: "bad",
        next: "manualThrottle",
      },
      manualThrottle: { type: "outcome", text: "Manual Throttle Only", tone: "warn" },

      stableReading: {
        type: "decision",
        text: "Reading Stable? (no prop wash)",
        test: (c) => c.stable,
        no: "altitudeDrift",
        yes: "altitudeHold",
      },
      altitudeDrift: {
        type: "outcome",
        text: "Altitude Drift",
        tone: "warn",
        next: "bobbing",
      },
      bobbing: { type: "outcome", text: "Drone Bobs Up And Down", tone: "warn" },
      altitudeHold: { type: "outcome", text: "Altitude Hold Active", tone: "ok" },
    },
  },
};

export const LOGIC_TREE_LIST = Object.values(LOGIC_TREES);

/**
 * COMPLETE FLIGHT LOGIC (course notes, section 13)
 * The end-to-end signal + power chain. Rendered as a block diagram, and each block
 * is tinted live by whether that stage is currently healthy.
 */
export const SYSTEM_FLOW = {
  title: "Complete Flight Logic",
  subtitle: "How energy and commands travel from the battery to actual flight",
  rows: [
    { id: "battery", label: "Battery", kind: "power" },
    { id: "pdb", label: "Power Distribution", kind: "power" },
    { id: "fc", label: "Flight Controller", kind: "brain" },
    {
      id: "sensors",
      kind: "fanout",
      children: [
        { id: "imu", label: "IMU" },
        { id: "compass", label: "Compass" },
        { id: "gps", label: "GPS" },
        { id: "receiver", label: "Receiver" },
        { id: "mixer", label: "Motor Mixing Algorithm" },
      ],
    },
    { id: "esc", label: "ESC 1 . . . N", kind: "power" },
    { id: "motor", label: "Motors", kind: "propulsion" },
    { id: "propeller", label: "Propellers", kind: "propulsion" },
    { id: "lift", label: "Lift", kind: "result" },
    { id: "flight", label: "Flight", kind: "result" },
  ],
};

/**
 * Walk a tree against a context object, returning the ordered list of node ids
 * that were visited plus the terminal node. This is the highlighted path.
 */
export function evaluateTree(tree, ctx) {
  const path = [];
  const branches = {}; // nodeId -> 'yes' | 'no' taken
  let id = tree.root;
  let guard = 0;

  while (id && guard++ < 64) {
    const node = tree.nodes[id];
    if (!node) break;
    path.push(id);

    if (node.type === "decision") {
      let result = false;
      try {
        result = Boolean(node.test(ctx));
      } catch {
        result = false;
      }
      branches[id] = result ? "yes" : "no";
      id = result ? node.yes : node.no;
    } else {
      id = node.next;
    }
  }

  const terminalId = path[path.length - 1];
  const terminal = tree.nodes[terminalId];
  return {
    path,
    pathSet: new Set(path),
    branches,
    terminalId,
    terminal,
    tone: terminal?.tone || "info",
    text: terminal?.text || "Unknown",
  };
}
