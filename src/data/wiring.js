/**
 * WIRING SPECIFICATION — PIN LEVEL
 * ================================
 * Transcribed from "Quadcopter Wiring Diagram — Complete Connection Guide" and the
 * accompanying connection JSON, then generalised so it also produces the correct
 * loom for a hexacopter (6) and octocopter (8).
 *
 * Connections are defined PIN TO PIN, because that is what the student actually
 * makes in the wiring dialog: pick a wire colour, drag from a pin on one component
 * to a pin on another.
 *
 * TWO DELIBERATE CORRECTIONS TO THE SOURCE DIAGRAM
 * ------------------------------------------------
 * The reference image's own verification notes flag two genuine labelling errors,
 * and we teach the correct wiring rather than reproducing the mistake:
 *
 *   1. GPS port. The image shows GPS TX landing on a pin labelled "5V", GPS RX on
 *      "GND" and GPS GND on "RX". A real Pixhawk GPS port is VCC / TX / RX / GND,
 *      and serial links CROSS OVER: GPS TX -> FC RX, GPS RX -> FC TX.
 *   2. TELEM port. The image labels one row "TX" twice; the row carrying the red
 *      power wire should be "5V". Its wire colours also contradict its own legend.
 *
 * Both are explained to the student in the dialog rather than silently changed.
 */

export const WIRE_COLORS = {
  red: { hex: "#e5484d", label: "Red", meaning: "+ (Positive / Power)" },
  black: { hex: "#2b303a", label: "Black", meaning: "- (Ground)" },
  yellow: { hex: "#ffd23b", label: "Yellow", meaning: "Signal / PWM" },
  green: { hex: "#3fbf6f", label: "Green", meaning: "TX (Transmit)" },
  blue: { hex: "#4a8fe7", label: "Blue", meaning: "RX (Receive)" },
  white: { hex: "#e8ecf2", label: "White", meaning: "S.Bus / Signal" },
  gray: { hex: "#9aa3b0", label: "Gray", meaning: "Telemetry" },
};

export const WIRE_COLOR_LIST = Object.entries(WIRE_COLORS).map(([id, v]) => ({
  id,
  ...v,
}));

const card = (id, part, label, sub, pins) => ({ id, part, label, sub, pins });
const pin = (id, label, hint) => ({ id, label, hint });

/**
 * Build every harness for this airframe and this module's component list.
 * A harness is one dialog: a small group of components and the wires between them.
 */
export function buildHarnesses(frame, components = null) {
  const n = frame.motorCount;
  const has = (id) => !components || components.includes(id);
  const hasPdb = has("pdb");
  const H = [];

  /* Where power is distributed from. Modules without a PDB solder the ESC leads
     straight to the battery lead, which is exactly what a real PDB-less build does. */
  const srcId = hasPdb ? "pdb" : "battery";
  const srcLabel = hasPdb ? "Power Distribution Board" : "Battery lead";
  const srcSub = hasPdb ? "PDB" : "Direct solder joint";

  /* ---------------------------------------------------- 1. Battery -> PDB */
  if (hasPdb) {
    H.push({
      id: "battery-pdb",
      title: "Battery to Power Distribution Board",
      subtitle: "The main power path — every amp the drone uses flows through here",
      group: "power",
      required: true,
      leftCards: [
        card("battery", "battery", "Battery", "3S 11.1V Li-Po · XT60", [
          pin("POS", "+", "Positive, XT60"),
          pin("NEG", "-", "Negative, XT60"),
        ]),
      ],
      rightCards: [
        card("pdb", "pdb", "Power Distribution Board", "Main input pads", [
          pin("BAT_POS", "BAT +", "Main positive pad"),
          pin("BAT_NEG", "BAT -", "Main negative pad"),
        ]),
      ],
      wires: [
        {
          key: "pos",
          from: ["battery", "POS"],
          to: ["pdb", "BAT_POS"],
          color: "red",
          note: "Positive lead through the XT60. This single pair carries the whole aircraft's current — a cold solder joint here will melt.",
        },
        {
          key: "neg",
          from: ["battery", "NEG"],
          to: ["pdb", "BAT_NEG"],
          color: "black",
          note: "Negative lead. Ground must be common to everything on the aircraft.",
        },
      ],
    });
  }

  /* ------------------------------------------- 2. Power distribution -> ESCs */
  {
    const srcPins = [];
    for (let i = 0; i < n; i++) {
      srcPins.push(pin(`OUT${i}_POS`, hasPdb ? `OUT ${i + 1} +` : `+`, `Feeds ESC ${i + 1}`));
      srcPins.push(pin(`OUT${i}_NEG`, hasPdb ? `OUT ${i + 1} -` : `-`, `Return for ESC ${i + 1}`));
    }
    H.push({
      id: "power-escs",
      title: `${hasPdb ? "PDB" : "Battery"} to the ESCs`,
      subtitle: `One power feed per ESC — ${n} of them`,
      group: "power",
      required: true,
      leftCards: [card(srcId, srcId, srcLabel, srcSub, srcPins)],
      rightCards: Array.from({ length: n }, (_, i) =>
        card(`esc${i}`, "esc", `ESC ${i + 1}`, "30A BLHeli_S", [
          pin("POS", "+", "Power in"),
          pin("NEG", "-", "Ground"),
        ])
      ),
      wires: Array.from({ length: n }, (_, i) => [
        {
          key: `esc${i}pos`,
          from: [srcId, `OUT${i}_POS`],
          to: [`esc${i}`, "POS"],
          color: "red",
          motor: i,
          note: `Positive feed for ESC ${i + 1}. If this one track breaks, only motor ${i + 1} dies while the rest of the drone keeps flying — which is far more dangerous than everything failing at once.`,
        },
        {
          key: `esc${i}neg`,
          from: [srcId, `OUT${i}_NEG`],
          to: [`esc${i}`, "NEG"],
          color: "black",
          motor: i,
          note: `Ground return for ESC ${i + 1}.`,
        },
      ]).flat(),
    });
  }

  /* --------------------------------------------- 3. Power -> Flight Controller */
  H.push({
    id: "power-fc",
    title: `${hasPdb ? "PDB BEC" : "Battery"} to the Flight Controller`,
    subtitle: "The regulated 5 V rail that runs the brain",
    group: "power",
    required: true,
    leftCards: [
      card(srcId, srcId, srcLabel, srcSub, [
        pin("BEC_POS", hasPdb ? "BEC 5V" : "+ (via BEC)", "Regulated 5 V"),
        pin("BEC_GND", "GND", "Common ground"),
      ]),
    ],
    rightCards: [
      card("fc", "fc", "Flight Controller", "Pixhawk · POWER port", [
        pin("PWR_POS", "POWER +", "5 V in"),
        pin("PWR_GND", "POWER GND", "Ground"),
      ]),
    ],
    wires: [
      {
        key: "pos",
        from: [srcId, "BEC_POS"],
        to: ["fc", "PWR_POS"],
        color: "red",
        note: "The BEC steps 11.1 V down to a clean 5 V. Feed the FC raw battery voltage and you destroy it instantly.",
      },
      {
        key: "gnd",
        from: [srcId, "BEC_GND"],
        to: ["fc", "PWR_GND"],
        color: "black",
        note: "ALL grounds must be common. Without a shared reference every signal voltage floats and the FC reads garbage.",
      },
    ],
  });

  /* ------------------------------------------ 4. FC MAIN OUT -> ESC signal */
  H.push({
    id: "fc-escs",
    title: "Flight Controller signal wires to the ESCs",
    subtitle: `MAIN OUT 1-${n} carry the PWM throttle commands`,
    group: "control",
    required: true,
    leftCards: [
      card(
        "fc",
        "fc",
        "Flight Controller",
        "MAIN OUT rail",
        Array.from({ length: n }, (_, i) =>
          pin(`MAIN${i}`, `MAIN OUT ${i + 1}`, `Throttle command for motor ${i + 1}`)
        )
      ),
    ],
    rightCards: Array.from({ length: n }, (_, i) =>
      card(`esc${i}`, "esc", `ESC ${i + 1}`, `Drives motor ${i + 1}`, [
        pin("SIG", "SIGNAL", "PWM input"),
      ])
    ),
    wires: Array.from({ length: n }, (_, i) => ({
      key: `sig${i}`,
      from: ["fc", `MAIN${i}`],
      to: [`esc${i}`, "SIG"],
      color: "yellow",
      motor: i,
      note: `MAIN OUT ${i + 1} must go to ESC ${i + 1}. Cross two of these and the mixer fights itself — the drone tips the opposite way to the stick.`,
    })),
  });

  /* --------------------------------------------- 5. ESC -> Motor (3 phase) */
  H.push({
    id: "escs-motors",
    title: "ESCs to the motors",
    subtitle: "Three unlabelled phase wires per motor",
    group: "propulsion",
    required: true,
    leftCards: Array.from({ length: n }, (_, i) =>
      card(`esc${i}`, "esc", `ESC ${i + 1}`, "30A BLHeli_S", [
        pin("PHASE", "A / B / C", "Three-phase output"),
      ])
    ),
    rightCards: Array.from({ length: n }, (_, i) =>
      card(`motor${i}`, "motor", `Motor ${i + 1}`, `${frame.motors[i].position} · ${frame.motors[i].spinLabel}`, [
        pin("PHASE", "A / B / C", "Three-phase input"),
      ])
    ),
    wires: Array.from({ length: n }, (_, i) => ({
      key: `phase${i}`,
      from: [`esc${i}`, "PHASE"],
      to: [`motor${i}`, "PHASE"],
      color: "black",
      motor: i,
      note: `Motor ${i + 1} sits ${frame.motors[i].position.toLowerCase()} and must spin ${frame.motors[i].spinLabel}. The three phases are unlabelled and interchangeable — but swapping ANY TWO of them reverses the direction. That is the standard fix for a backwards motor.`,
    })),
  });

  /* ------------------------------------------------- 6. Receiver -> FC SBUS */
  if (has("receiver")) {
    H.push({
      id: "rx-fc",
      title: "Receiver to the Flight Controller",
      subtitle: "One SBUS wire carries every stick channel",
      group: "control",
      required: true,
      leftCards: [
        card("receiver", "receiver", "Receiver", "FS-iA6B", [
          pin("SBUS", "SBUS OUT", "All channels on one wire"),
          pin("V5", "5V", "Power in"),
          pin("GND", "GND", "Ground"),
        ]),
      ],
      rightCards: [
        card("fc", "fc", "Flight Controller", "SBUS port", [
          pin("SBUS_IN", "SBUS IN", "Signal"),
          pin("SBUS_5V", "5V", "Power out"),
          pin("SBUS_GND", "GND", "Ground"),
        ]),
      ],
      wires: [
        {
          key: "sbus",
          from: ["receiver", "SBUS"],
          to: ["fc", "SBUS_IN"],
          color: "white",
          note: "SBUS packs all the channels into one serial line. Without it the FC sees no pilot and refuses to arm.",
        },
        {
          key: "v5",
          from: ["receiver", "V5"],
          to: ["fc", "SBUS_5V"],
          color: "red",
          note: "The receiver is powered from the FC's 5 V rail.",
        },
        {
          key: "gnd",
          from: ["receiver", "GND"],
          to: ["fc", "SBUS_GND"],
          color: "black",
          note: "Shared ground.",
        },
      ],
    });
  }

  /* ----------------------------------------------------- 7. GPS -> FC (UART) */
  if (has("gps")) {
    H.push({
      id: "gps-fc",
      title: "GPS module to the Flight Controller",
      subtitle: "A serial link — and serial links CROSS OVER",
      group: "navigation",
      required: false,
      correction:
        "The reference diagram labels this port wrongly: it shows GPS TX landing on a pin marked 5V. A real Pixhawk GPS port is VCC / TX / RX / GND, and TX must meet RX. We wire it correctly here.",
      leftCards: [
        card("gps", "gps", "GPS Module", "M8N GNSS", [
          pin("VCC", "VCC", "Power in"),
          pin("TX", "TX", "GPS transmits"),
          pin("RX", "RX", "GPS listens"),
          pin("GND", "GND", "Ground"),
        ]),
      ],
      rightCards: [
        card("fc", "fc", "Flight Controller", "GPS port", [
          pin("GPS_5V", "5V", "Power out"),
          pin("GPS_RX", "RX", "FC listens"),
          pin("GPS_TX", "TX", "FC transmits"),
          pin("GPS_GND", "GND", "Ground"),
        ]),
      ],
      wires: [
        {
          key: "vcc",
          from: ["gps", "VCC"],
          to: ["fc", "GPS_5V"],
          color: "red",
          note: "5 V to run the GPS receiver.",
        },
        {
          key: "tx",
          from: ["gps", "TX"],
          to: ["fc", "GPS_RX"],
          color: "green",
          note: "TX talks, RX listens — so the GPS's TX must reach the FC's RX. Wire TX to TX and both ends shout while neither hears a thing.",
        },
        {
          key: "rx",
          from: ["gps", "RX"],
          to: ["fc", "GPS_TX"],
          color: "blue",
          note: "The other half of the crossover: the FC's TX reaches the GPS's RX so it can send configuration commands.",
        },
        {
          key: "gnd",
          from: ["gps", "GND"],
          to: ["fc", "GPS_GND"],
          color: "black",
          note: "Serial needs a common ground or the voltage levels mean nothing.",
        },
      ],
    });
  }

  /* ------------------------------------------------ 8. Telemetry -> FC TELEM */
  if (has("telemetry")) {
    H.push({
      id: "telem-fc",
      title: "Telemetry radio to the Flight Controller",
      subtitle: "Live data back to the ground station — another crossover link",
      group: "navigation",
      required: false,
      correction:
        "The reference diagram labels this port 'TX' twice; the row carrying the red wire should read 5V. Its wire colours also contradict its own legend. We follow the legend: green TX, blue RX.",
      leftCards: [
        card("telemetry", "telemetry", "Telemetry Module", "433 / 915 MHz", [
          pin("V5", "5V", "Power in"),
          pin("TX", "TX", "Radio transmits"),
          pin("RX", "RX", "Radio listens"),
          pin("GND", "GND", "Ground"),
        ]),
      ],
      rightCards: [
        card("fc", "fc", "Flight Controller", "TELEM port", [
          pin("TEL_5V", "5V", "Power out"),
          pin("TEL_RX", "RX", "FC listens"),
          pin("TEL_TX", "TX", "FC transmits"),
          pin("TEL_GND", "GND", "Ground"),
        ]),
      ],
      wires: [
        { key: "v5", from: ["telemetry", "V5"], to: ["fc", "TEL_5V"], color: "red", note: "5 V for the radio." },
        {
          key: "tx",
          from: ["telemetry", "TX"],
          to: ["fc", "TEL_RX"],
          color: "green",
          note: "Same crossover rule as the GPS: the radio's TX goes to the FC's RX.",
        },
        {
          key: "rx",
          from: ["telemetry", "RX"],
          to: ["fc", "TEL_TX"],
          color: "blue",
          note: "FC TX to radio RX, so the ground station can send commands up to the aircraft.",
        },
        { key: "gnd", from: ["telemetry", "GND"], to: ["fc", "TEL_GND"], color: "black", note: "Common ground." },
      ],
    });
  }

  /* --------------------------------------------------- 9. Buzzer -> FC BUZZER */
  if (has("buzzer")) {
    H.push({
      id: "buzzer-fc",
      title: "Buzzer to the Flight Controller",
      subtitle: "Audible arming tones and the lost-model alarm",
      group: "control",
      required: false,
      leftCards: [
        card("buzzer", "buzzer", "Buzzer", "Piezo", [
          pin("POS", "+", "Positive"),
          pin("NEG", "-", "Negative"),
        ]),
      ],
      rightCards: [
        card("fc", "fc", "Flight Controller", "BUZZER port", [
          pin("BUZ_POS", "+", "Drive"),
          pin("BUZ_NEG", "-", "Ground"),
        ]),
      ],
      wires: [
        {
          key: "pos",
          from: ["buzzer", "POS"],
          to: ["fc", "BUZ_POS"],
          color: "red",
          note: "The buzzer is how the drone tells you it armed, or that a pre-arm check failed, without you looking at a screen.",
        },
        { key: "neg", from: ["buzzer", "NEG"], to: ["fc", "BUZ_NEG"], color: "black", note: "Return." },
      ],
    });
  }

  // Stamp a full id onto every wire: "<harness>:<key>"
  return H.map((h) => ({
    ...h,
    wires: h.wires.map((w) => ({ ...w, id: `${h.id}:${w.key}`, harness: h.id })),
  }));
}

/** Flat list of every wire for this build. */
export function allWires(frame, components) {
  return buildHarnesses(frame, components).flatMap((h) =>
    h.wires.map((w) => ({ ...w, required: h.required, group: h.group }))
  );
}

/**
 * One place that answers every "is X wired?" question, so the checklist, the
 * diagnostics and the bench can never disagree with each other.
 */
export function wiringStatus(frame, components, linkSet) {
  const links = linkSet instanceof Set ? linkSet : new Set(linkSet || []);
  const harnesses = buildHarnesses(frame, components).map((h) => {
    const done = h.wires.filter((w) => links.has(w.id)).length;
    return { ...h, done, total: h.wires.length, complete: done === h.wires.length };
  });

  const byId = Object.fromEntries(harnesses.map((h) => [h.id, h]));
  const isDone = (id) => Boolean(byId[id]?.complete);
  const wired = (id) => links.has(id);

  const requiredHarnesses = harnesses.filter((h) => h.required);
  const requiredTotal = requiredHarnesses.reduce((s, h) => s + h.total, 0);
  const requiredDone = requiredHarnesses.reduce((s, h) => s + h.done, 0);

  const src = components && !components.includes("pdb") ? "battery" : "pdb";

  return {
    harnesses,
    byId,
    isDone,
    wired,
    requiredTotal,
    requiredDone,
    allRequiredDone: requiredHarnesses.every((h) => h.complete),
    missingRequired: requiredHarnesses.filter((h) => !h.complete),

    // Per-component queries used by the diagnostics engine
    batteryToPower: src === "battery" ? true : isDone("battery-pdb"),
    fcPowered: isDone("power-fc"),
    escPowered: (i) =>
      wired(`power-escs:esc${i}pos`) && wired(`power-escs:esc${i}neg`),
    escSignal: (i) => wired(`fc-escs:sig${i}`),
    motorPhases: (i) => wired(`escs-motors:phase${i}`),
    receiverToFc: isDone("rx-fc"),
    gpsToFc: isDone("gps-fc"),
    telemToFc: isDone("telem-fc"),
    buzzerToFc: isDone("buzzer-fc"),
  };
}

/** Every wire id that can legally be made for this build — the teacher shortcut. */
export function allWireIds(frame, components) {
  return allWires(frame, components).map((w) => w.id);
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
  "Telemetry -> FC (TELEM Port)",
  "All Grounds (GND) must be Common",
];
