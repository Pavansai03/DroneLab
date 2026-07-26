/**
 * WIRING SPECIFICATION
 * ====================
 * Transcribed from the "Quadcopter Wiring Diagram — Complete Connection Guide"
 * in the course notes, generalised so it also produces the correct link list for
 * a hexacopter (6) and octocopter (8).
 *
 * Every link the student must make is listed here with its real port names and
 * wire colour. sim/faults.js checks the student's link set against this spec.
 */

export const WIRE_COLORS = {
  positive: { hex: "#e5484d", label: "Red", meaning: "+ (Positive)" },
  ground: { hex: "#1a1a1a", label: "Black", meaning: "- (Ground)" },
  signal: { hex: "#ffd23b", label: "Yellow", meaning: "Signal / PWM" },
  tx: { hex: "#3fbf6f", label: "Green", meaning: "TX (Transmit)" },
  rx: { hex: "#4a8fe7", label: "Blue", meaning: "RX (Receive)" },
  sbus: { hex: "#e8ecf2", label: "White", meaning: "S.Bus / Signal" },
  telemetry: { hex: "#9aa3b0", label: "Gray", meaning: "Telemetry" },
};

/** Which component a wiring node belongs to. */
export function partOfNode(node) {
  if (node.startsWith("esc")) return "esc";
  if (node.startsWith("motor")) return "motor";
  return node;
}

/**
 * Build the full required-connection list for a given airframe.
 *
 * `options.components` is the module's component list. A link can only be
 * *required* if both of its endpoints exist in that module — otherwise Module 1,
 * which has no receiver yet, could never finish its loom.
 *
 * Modules 1 and 2 also have no PDB: there the battery lead is the distribution
 * point, so a `pdb` endpoint counts as present whenever a battery is.
 *
 * Returns { id, from, to, fromPort, toPort, color, group, required, available, note }
 */
export function buildWiringSpec(frame, options = {}) {
  const links = [];
  const n = frame.motorCount;
  const components = options.components || null;

  const inModule = (node) => {
    if (!components) return true;
    const part = partOfNode(node);
    if (part === "pdb" && !components.includes("pdb")) {
      return components.includes("battery");
    }
    return components.includes(part);
  };

  /* ---- 1. Main power path: Battery -> PDB -------------------------------- */
  links.push({
    id: "battery->pdb",
    from: "battery",
    to: "pdb",
    fromPort: "XT60",
    toPort: "MAIN IN",
    color: "positive",
    group: "power",
    required: true,
    note: "The whole aircraft's current flows through this one pair of wires. Solder it well.",
  });

  /* ---- 2. PDB -> each ESC (power) ---------------------------------------- */
  for (let i = 0; i < n; i++) {
    links.push({
      id: `pdb->esc${i}`,
      from: "pdb",
      to: `esc${i}`,
      fromPort: `OUT ${i + 1}`,
      toPort: "PWR IN",
      color: "positive",
      group: "power",
      required: true,
      motor: i,
      note: `Feeds ESC ${i + 1}. If this track breaks, only motor ${i + 1} dies — the rest of the drone stays alive.`,
    });
  }

  /* ---- 3. PDB -> FC (5 V BEC) -------------------------------------------- */
  links.push({
    id: "pdb->fc",
    from: "pdb",
    to: "fc",
    fromPort: "BEC 5V",
    toPort: "POWER",
    color: "positive",
    group: "power",
    required: true,
    note: "The BEC steps 11.1 V down to a clean 5 V for the flight controller.",
  });

  /* ---- 4. Each ESC -> its Motor (3-phase) -------------------------------- */
  for (let i = 0; i < n; i++) {
    const m = frame.motors[i];
    links.push({
      id: `esc${i}->motor${i}`,
      from: `esc${i}`,
      to: `motor${i}`,
      fromPort: "PHASE A/B/C",
      toPort: "3-PHASE",
      color: "ground",
      group: "propulsion",
      required: true,
      motor: i,
      note: `Motor ${i + 1} (${m.position}) must spin ${m.spinLabel}. Swapping ANY two of these three wires reverses the direction — that is the standard fix for a backwards motor.`,
    });
  }

  /* ---- 5. FC MAIN OUT -> each ESC signal --------------------------------- */
  for (let i = 0; i < n; i++) {
    links.push({
      id: `fc->esc${i}`,
      from: "fc",
      to: `esc${i}`,
      fromPort: `MAIN OUT ${i + 1}`,
      toPort: "SIGNAL",
      color: "signal",
      group: "control",
      required: true,
      motor: i,
      note: `Carries the PWM throttle command for motor ${i + 1}. Output number MUST match motor number or the mixer will fight itself.`,
    });
  }

  /* ---- 6. Receiver -> FC (SBUS) ------------------------------------------ */
  links.push({
    id: "receiver->fc",
    from: "receiver",
    to: "fc",
    fromPort: "SBUS OUT",
    toPort: "SBUS IN",
    color: "sbus",
    group: "control",
    required: true,
    note: "One wire carries all the stick channels. Without it the FC sees no pilot and refuses to arm.",
  });

  /* ---- 7. GPS -> FC ------------------------------------------------------ */
  links.push({
    id: "gps->fc",
    from: "gps",
    to: "fc",
    fromPort: "VCC/TX/RX/GND",
    toPort: "GPS PORT",
    color: "tx",
    group: "navigation",
    required: false,
    note: "Optional for manual flight, mandatory for Position Hold, Return-To-Home and missions.",
  });

  /* ---- 8. Compass -> FC (I2C, lives on the GPS mast) --------------------- */
  links.push({
    id: "compass->fc",
    from: "compass",
    to: "fc",
    fromPort: "I2C",
    toPort: "I2C",
    color: "rx",
    group: "navigation",
    required: false,
    note: "Mounted high on the GPS mast, away from the battery leads whose magnetic field would corrupt the heading.",
  });

  /* ---- 9. Common ground -------------------------------------------------- */
  links.push({
    id: "common-ground",
    from: "pdb",
    to: "fc",
    fromPort: "GND",
    toPort: "GND",
    color: "ground",
    group: "power",
    required: true,
    note: "ALL grounds must be common. Without a shared reference, signal voltages float and the FC reads garbage.",
  });

  // A link is only mandatory if the module actually includes both endpoints.
  return links.map((l) => {
    const available = inModule(l.from) && inModule(l.to);
    return { ...l, available, required: l.required && available };
  });
}

/** Pre-flight notes, straight from the wiring diagram's NOTES box. */
export const PREFLIGHT_NOTES = [
  "Always check battery voltage before flight.",
  "Calibrate ESCs before first use.",
  "Ensure correct motor direction as per diagram.",
  "Secure all connections properly.",
  "Use proper props (CW / CCW) on correct motors.",
];

/** Connection summary, as printed on the wiring diagram. */
export const CONNECTION_SUMMARY = [
  "Battery -> PDB -> ESCs -> Motors (Power)",
  "FC Main Out 1-N -> ESC Signal Wires",
  "Receiver -> FC (SBUS)",
  "GPS -> FC (GPS Port)",
  "Compass -> FC (I2C)",
  "All Grounds (GND) must be Common",
];

/** Which component each wiring node belongs to, for the bench layout. */
export function wiringNodes(frame) {
  const nodes = [
    { id: "battery", label: "Battery", col: 0, part: "battery" },
    { id: "pdb", label: "PDB", col: 1, part: "pdb" },
    { id: "fc", label: "Flight Controller", col: 1, part: "fc" },
    { id: "receiver", label: "Receiver", col: 0, part: "receiver" },
    { id: "gps", label: "GPS", col: 0, part: "gps" },
    { id: "compass", label: "Compass", col: 0, part: "compass" },
  ];
  for (let i = 0; i < frame.motorCount; i++) {
    nodes.push({ id: `esc${i}`, label: `ESC ${i + 1}`, col: 2, part: "esc", motor: i });
    nodes.push({
      id: `motor${i}`,
      label: `Motor ${i + 1}`,
      col: 3,
      part: "motor",
      motor: i,
    });
  }
  return nodes;
}
