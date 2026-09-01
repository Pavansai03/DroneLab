/**
 * COMPONENT CATALOGUE
 * ===================
 * Every part the students can pick up, with the real specifications from the
 * course parts chart (RajUddan Drone Parts Chart, sections 1-8).
 *
 *   qty: "n"      -> exactly one of these
 *        "motors" -> one per motor (so 4 on a quad, 6 on a hexa, 8 on an octo)
 *
 * `variants` are the choices a student must get RIGHT. Picking a 920 KV CW motor
 * for a slot that needs CCW is a real, diagnosable build error — see sim/faults.js.
 */

export const CATEGORIES = [
  { id: "frame", label: "Frame", color: "#8b93a1" },
  { id: "power", label: "Power", color: "#ffab4a" },
  { id: "propulsion", label: "Propulsion", color: "#46e6cf" },
  { id: "avionics", label: "Avionics", color: "#7aa2ff" },
  { id: "sensors", label: "Sensors", color: "#c48bff" },
  { id: "radio", label: "Radio Link", color: "#ff7a90" },
];

export const PARTS = {
  /* ------------------------------------------------ 1. FRAME ---------- */
  frame: {
    id: "frame",
    label: "Frame",
    category: "frame",
    qty: 1,
    spec: "CARBON FIBRE",
    icon: "frame",
    why: "The frame is the skeleton. Its arm length sets how far the propellers sit from the centre of gravity, which is what gives the flight controller leverage to roll and pitch.",
    teaches:
      "Longer arms = more leverage = smoother but slower response. Carbon fibre is used because it is stiff: a flexible frame lets propeller vibration reach the IMU and corrupt its readings.",
    variants: [
      { id: "quad", label: "Quad 450", detail: "4 arms · 225 mm" },
      { id: "hexa", label: "Hexa 550", detail: "6 arms · 275 mm" },
      { id: "octo", label: "Octo 650", detail: "8 arms · 320 mm" },
    ],
  },

  /* ------------------------------------------------ 7. BATTERY -------- */
  battery: {
    id: "battery",
    label: "Battery",
    category: "power",
    qty: 1,
    spec: "LI-PO PACK",
    icon: "battery",
    why: "The LiPo pack is the only energy source on board. Cells in series set the voltage — 3 x 3.7 V = 11.1 V nominal on a 3S, 6 x 3.7 V = 22.2 V on a 6S — while capacity in mAh sets how long it lasts.",
    teaches:
      "Never fly a LiPo below 3.5 V per cell — it permanently damages the pack. Voltage also SAGS under load, and sag is current x internal resistance. That is why more motors need more CELLS, not just more capacity: doubling the voltage halves the current for the same power, so the same pack sags half as far.",
    variants: [
      { id: "3s4200", label: "3S 4200 mAh", detail: "11.1 V · 320 g", cells: 3, capacityMah: 4200 },
      { id: "3s5200", label: "3S 5200 mAh", detail: "11.1 V · 395 g", cells: 3, capacityMah: 5200 },
      { id: "6s5200", label: "6S 5200 mAh", detail: "22.2 V · 785 g", cells: 6, capacityMah: 5200 },
      { id: "6s8000", label: "6S 8000 mAh", detail: "22.2 V · 1205 g", cells: 6, capacityMah: 8000 },
    ],
  },

  /* ------------------------------------------------ 2. PDB ------------ */
  pdb: {
    id: "pdb",
    label: "Power Distribution Board",
    category: "power",
    qty: 1,
    spec: "PDB + BEC 5V",
    icon: "pdb",
    why: "One battery lead has to feed every ESC plus the flight controller. The PDB is the junction box that splits that current into equal paths.",
    teaches:
      "A broken PDB output track kills only the ESC on that track — the motor stops but the rest of the drone stays powered. That asymmetric failure is far more dangerous than the whole drone dying at once.",
    variants: [{ id: "std", label: "PDB 12S 200A", detail: "BEC 5V / 3A" }],
  },

  /* ------------------------------------------------ 3. ESC ------------ */
  esc: {
    id: "esc",
    label: "ESC",
    category: "power",
    qty: "motors",
    spec: "BLHELI_S",
    icon: "esc",
    why: "An Electronic Speed Controller converts the flight controller's PWM command into three-phase power for one brushless motor, updating hundreds of times a second.",
    teaches:
      "ESCs are current-rated. A 30 A ESC on a motor that pulls 34 A will work — until a hard climb, when it overheats past 90 degC, reduces power, and then shuts down mid-air.",
    variants: [
      { id: "30a", label: "30A", detail: "BEC 5V/3A" },
      { id: "35a", label: "35A", detail: "BEC 5V/3A" },
    ],
  },

  /* ------------------------------------------------ 5. MOTOR ---------- */
  motor: {
    id: "motor",
    label: "BLDC Motor",
    category: "propulsion",
    qty: "motors",
    spec: "BRUSHLESS OUTRUNNER",
    icon: "motor",
    why: "Brushless motors spin the propellers. The flight controller steers purely by making some motors spin faster than others.",
    teaches:
      "KV is RPM per volt with no propeller fitted. A 1000 KV motor on 11.1 V tries to reach 11,100 RPM — more thrust, more current, less flight time than the 920 KV. KV must SUIT THE PACK: put a 920 KV motor on a 6S pack and it tries for 20,000 RPM, which no 10-inch propeller survives. Direction matters too: each slot needs the CW or CCW motor the mixer expects.",
    directional: true, // must match the slot's CW/CCW requirement
    variants: [
      { id: "920", label: "920 KV", detail: "3S · efficient · long flight", kv: 920, cells: 3 },
      { id: "1000", label: "1000 KV", detail: "3S · punchy · higher current", kv: 1000, cells: 3 },
      { id: "460", label: "460 KV", detail: "6S · same prop RPM at half the current", kv: 460, cells: 6 },
      { id: "500", label: "500 KV", detail: "6S · punchy · higher current", kv: 500, cells: 6 },
    ],
  },

  /* ------------------------------------------------ 6. PROPELLER ------ */
  propeller: {
    id: "propeller",
    label: "Propeller",
    category: "propulsion",
    qty: "motors",
    spec: "10 x 4.5",
    icon: "propeller",
    why: "Propellers turn shaft rotation into thrust. Thrust rises with the SQUARE of RPM and the FOURTH POWER of diameter, which is why a small diameter change matters so much.",
    teaches:
      "A CW motor needs a CW propeller. Fit the wrong one and the blade's angled face pushes air UPWARDS — the drone flips the instant it leaves the ground. Always fit propellers last, after the battery is disconnected.",
    directional: true,
    variants: [
      { id: "cw", label: "CW Prop", detail: "For clockwise motors" },
      { id: "ccw", label: "CCW Prop", detail: "For anticlockwise motors" },
    ],
  },

  /* ------------------------------------------------ 4. FC ------------- */
  fc: {
    id: "fc",
    label: "Flight Controller",
    category: "avionics",
    qty: 1,
    spec: "PIXHAWK CLASS",
    icon: "fc",
    why: "The flight controller is the brain. It reads the IMU hundreds of times a second, compares the drone's actual attitude to what the pilot asked for, and re-mixes the motor outputs to close the gap.",
    teaches:
      "The FC will refuse to arm if any pre-flight check fails. That is a feature, not a fault — an unarmed drone on the ground is always better than an uncontrollable one in the air.",
    variants: [
      { id: "pixhawk", label: "Pixhawk", detail: "Full autopilot" },
      { id: "apm", label: "APM 2.8", detail: "Classic autopilot" },
      { id: "radiolink", label: "Radio Link", detail: "Budget autopilot" },
    ],
  },

  /* ------------------------------------------------ 10. IMU ----------- */
  imu: {
    id: "imu",
    label: "IMU",
    category: "sensors",
    qty: 1,
    spec: "GYRO + ACCEL",
    icon: "imu",
    why: "The Inertial Measurement Unit combines a gyroscope (rate of rotation) and an accelerometer (which way is down) so the FC always knows the drone's attitude.",
    teaches:
      "An uncalibrated IMU does not fail loudly — it drifts. The drone slowly slides in one direction while the FC insists it is level. Always calibrate on a flat surface before flying.",
    needsCalibration: true,
    variants: [{ id: "std", label: "6-Axis IMU", detail: "On-board FC" }],
  },

  /* ------------------------------------------------ 12. COMPASS ------- */
  compass: {
    id: "compass",
    label: "Compass",
    category: "sensors",
    qty: 1,
    spec: "3-AXIS MAG",
    icon: "compass",
    why: "The magnetometer tells the FC which way is north. Without it the drone can hold position but has no idea which direction 'home' is.",
    teaches:
      "Compasses are wrecked by the magnetic field around the battery's power leads. That is why the compass usually lives up on the GPS mast, far from high-current wiring.",
    needsCalibration: true,
    variants: [{ id: "std", label: "3-Axis Compass", detail: "On GPS mast" }],
  },

  /* ------------------------------------------------ BAROMETER --------- */
  barometer: {
    id: "barometer",
    label: "Barometer",
    category: "sensors",
    qty: 1,
    spec: "MS5611 CLASS",
    icon: "barometer",
    why: "The barometer measures air pressure to estimate altitude, which is what altitude-hold mode locks onto.",
    teaches:
      "Air pressure drops about 12 Pa per metre climbed. A gust of prop-wash over the sensor reads as a sudden altitude change, so the barometer is always covered with foam.",
    variants: [{ id: "std", label: "Barometer", detail: "Altitude hold" }],
  },

  /* ------------------------------------------------ 7. GPS ------------ */
  gps: {
    id: "gps",
    label: "GPS Module",
    category: "sensors",
    qty: 1,
    spec: "M8N GNSS",
    icon: "gps",
    why: "GPS gives absolute position. It is what makes Position Hold, Return-To-Home and autonomous missions possible.",
    teaches:
      "The drone needs at least 8 satellites locked before position modes are trustworthy. Fewer than that and the FC will silently fall back to manual — with no position hold at all.",
    minSatellites: 8,
    variants: [{ id: "std", label: "GPS Module", detail: "Position hold + RTH" }],
  },

  /* ------------------------------------------------ 9. RECEIVER ------- */
  receiver: {
    id: "receiver",
    label: "Receiver",
    category: "radio",
    qty: 1,
    spec: "SBUS RX",
    icon: "receiver",
    why: "The receiver listens for the transmitter's radio packets and forwards the stick positions to the FC over a single SBUS wire.",
    teaches:
      "The receiver must be BOUND to one specific transmitter. An unbound receiver powers up, glows its LED, and still passes nothing through — so the drone simply refuses to arm.",
    variants: [{ id: "std", label: "FS-iA6B", detail: "SBUS · 6+ channels" }],
  },

  /* ------------------------------------------------ 8. TRANSMITTER ---- */
  transmitter: {
    id: "transmitter",
    label: "Transmitter",
    category: "radio",
    qty: 1,
    spec: "2.4 GHz TX",
    icon: "transmitter",
    why: "The transmitter is the pilot's control box. In this simulator its sticks are mapped to W / A / S / D, Q / E, Space and Z.",
    teaches:
      "If the radio link drops, the FC does NOT just stop — it runs the failsafe you configured. A well set-up drone climbs to a safe height and flies home; a badly set-up one falls out of the sky.",
    variants: [{ id: "std", label: "6-Ch TX", detail: "Mode 2" }],
  },

  /* ---------------------------------------------- BUZZER (wiring diagram) */
  buzzer: {
    id: "buzzer",
    label: "Buzzer",
    category: "avionics",
    qty: 1,
    spec: "PIEZO",
    icon: "buzzer",
    optional: true,
    why: "The buzzer is how the drone talks to you without a screen: arming tones, pre-arm failures, low battery, and the lost-model alarm after a crash.",
    teaches:
      "A drone that refuses to arm usually tells you why in beeps before it tells you anything else. Learning the tones is faster than plugging in a laptop.",
    variants: [{ id: "std", label: "Piezo Buzzer", detail: "Alarms + tones" }],
  },
};

export const PART_LIST = Object.values(PARTS);

/** How many of `part` does this airframe need? */
export function requiredQty(part, frame) {
  return part.qty === "motors" ? frame.motorCount : part.qty;
}

/**
 * Which variants of `part` make sense on this airframe.
 *
 * Only the pack and the motors are filtered, and only by cell count. A student
 * choosing between a 4200 and a 5200 mAh pack is making a real trade — weight
 * against endurance — and should see both. A student offered a 3S pack for an
 * octocopter is being invited to build something that browns out on take-off,
 * and a 920 KV motor beside a 6S pack is an invitation to over-rev a propeller
 * until it comes apart. Those are not trades; they are traps.
 */
export function variantsFor(part, frame) {
  const cells = frame?.recommendedPack?.cells;
  if (!cells) return part.variants;
  if (part.id !== "battery" && part.id !== "motor") return part.variants;
  const suited = part.variants.filter((v) => v.cells === cells);
  return suited.length ? suited : part.variants;
}

/** Default variant chosen when a student drops a part without picking one. */
export function defaultVariant(part, frame) {
  if (part.id === "frame") return frame.id;
  const options = variantsFor(part, frame);

  if (part.id === "battery" && frame?.recommendedPack) {
    const { cells, capacityMah } = frame.recommendedPack;
    const exact = options.find((v) => v.cells === cells && v.capacityMah === capacityMah);
    if (exact) return exact.id;
  }
  if (part.id === "motor" && frame?.recommendedKv) {
    const exact = options.find((v) => v.kv === frame.recommendedKv);
    if (exact) return exact.id;
  }
  return options[0].id;
}

/**
 * Battery variant ids used before packs carried a cell count.
 *
 * They were bare capacities, because there was only ever one cell count. Any
 * build saved to the cloud before the hexa and octo existed still names them,
 * and an unrecognised id would leave the parts library showing no pack selected
 * on a build that plainly has one fitted — so they are translated, not dropped.
 */
const LEGACY_BATTERY_IDS = { 4200: "3s4200", 5200: "3s5200" };

/**
 * Bring a saved build's variant choices up to date.
 * Also drops any pack or motor that does not suit the airframe — which only
 * happens if a build was saved mid-edit or hand-tampered, but a 3S pack quietly
 * left on an octocopter is a brown-out on the next take-off.
 */
export function normalizeVariants(variants, frame) {
  const out = { ...(variants || {}) };

  if (out.battery && LEGACY_BATTERY_IDS[out.battery]) {
    out.battery = LEGACY_BATTERY_IDS[out.battery];
  }
  for (const partId of ["battery", "motor"]) {
    const part = PARTS[partId];
    if (!out[partId] || !part) continue;
    const allowed = variantsFor(part, frame);
    if (!allowed.some((v) => v.id === out[partId])) {
      out[partId] = defaultVariant(part, frame);
    }
  }
  return out;
}

/** The pack a build is actually carrying, resolved from the chosen variant. */
export function packOf(variantId, frame) {
  const v = PARTS.battery.variants.find((x) => x.id === variantId);
  if (v) return { cells: v.cells, capacityMah: v.capacityMah };
  return frame?.recommendedPack ?? { cells: 3, capacityMah: 4200 };
}

/** The KV a build is actually turning, resolved from the chosen variant. */
export function kvOf(variantId, frame) {
  const v = PARTS.motor.variants.find((x) => x.id === variantId);
  return v?.kv ?? frame?.recommendedKv ?? 920;
}
