/**
 * AIRFRAME DEFINITIONS
 * ====================
 * Quadcopter / Hexacopter / Octocopter, all in "X" configuration.
 *
 * Angle convention used everywhere in this project:
 *   `angle` is measured in DEGREES CLOCKWISE FROM THE NOSE, viewed from above.
 *     0   = straight ahead (nose)
 *     90  = right
 *     180 = tail
 *     270 = left
 *   So a motor's position in the body frame is:
 *     forward component = cos(angle)
 *     right   component = sin(angle)
 *
 * Spin direction: +1 = CW (clockwise seen from above), -1 = CCW.
 * A motor spinning CW pushes REACTION TORQUE the other way (yaws the airframe CCW),
 * which is exactly why the mixer's yaw factor is `-spin` (see sim/mixer.js).
 *
 * Motor numbering for the quad follows the wiring diagram in the course notes:
 *   M1 FRONT RIGHT (CW) · M2 REAR RIGHT (CCW) · M3 REAR LEFT (CW) · M4 FRONT LEFT (CCW)
 * Note the diagonal pairs share a direction (M1+M3 CW, M2+M4 CCW) — that is what
 * cancels the yaw torque in the hover.
 *
 * Hexa and Octo simply continue the same rule: directions ALTERNATE around the ring,
 * which guarantees an equal number of CW and CCW motors and therefore zero net torque.
 */

const CW = 1;
const CCW = -1;

/** Human labels for the position of a motor, derived from its angle. */
function positionLabel(angle) {
  const a = ((angle % 360) + 360) % 360;
  if (a < 22.5 || a >= 337.5) return "FRONT";
  if (a < 67.5) return "FRONT RIGHT";
  if (a < 112.5) return "RIGHT";
  if (a < 157.5) return "REAR RIGHT";
  if (a < 202.5) return "REAR";
  if (a < 247.5) return "REAR LEFT";
  if (a < 292.5) return "LEFT";
  return "FRONT LEFT";
}

/** Build the motor table for a frame: N arms evenly spread, directions alternating. */
function buildMotors(angles) {
  return angles.map((angle, i) => ({
    index: i,
    id: `M${i + 1}`,
    angle,
    spin: i % 2 === 0 ? CW : CCW,
    spinLabel: i % 2 === 0 ? "CW" : "CCW",
    position: positionLabel(angle),
    // Propeller colour convention: CW props black, CCW props orange, so students
    // can see at a glance whether they fitted the correct prop to the correct motor.
    propColor: i % 2 === 0 ? 0x14161b : 0xff7a33,
  }));
}

export const AIRFRAMES = {
  quad: {
    id: "quad",
    label: "Quadcopter",
    short: "QUAD",
    motorCount: 4,
    armAngles: [45, 135, 225, 315],
    motors: buildMotors([45, 135, 225, 315]),
    // Physical build data (roughly a 450-class airframe, matching the 3S/10-inch BOM)
    armLength: 0.225, // metres, hub centre to motor shaft
    tipRadius: 1.55, // scene units, hub centre to motor mount (visual scale)
    dryMassKg: 0.68, // frame + electronics, WITHOUT battery and payload
    propDiameterIn: 10,
    recommendedKv: 920,
    recommendedEscA: 30,
    maxPayloadKg: 0.5,
    dragArea: 0.055, // m^2 equivalent flat-plate area for wind loading
    // Redundancy: how many motors may fail and still leave 4-axis control authority
    redundantMotors: 0,
    blurb:
      "Four motors, the lightest and cheapest layout. It has zero redundancy — the yaw axis is produced by only two opposing pairs, so losing one motor removes yaw control completely.",
  },
  hexa: {
    id: "hexa",
    label: "Hexacopter",
    short: "HEXA",
    motorCount: 6,
    armAngles: [30, 90, 150, 210, 270, 330],
    motors: buildMotors([30, 90, 150, 210, 270, 330]),
    armLength: 0.275,
    tipRadius: 1.78,
    dryMassKg: 1.05,
    propDiameterIn: 10,
    recommendedKv: 920,
    recommendedEscA: 30,
    maxPayloadKg: 1.2,
    dragArea: 0.078,
    redundantMotors: 1,
    blurb:
      "Six motors give one spare. Lose a single motor and the flight controller can recalculate the mix and fly on with reduced stability — but two adjacent failures leave a hole the mixer cannot fill.",
  },
  octo: {
    id: "octo",
    label: "Octocopter",
    short: "OCTO",
    motorCount: 8,
    armAngles: [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5],
    motors: buildMotors([22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5]),
    armLength: 0.32,
    tipRadius: 2.0,
    dryMassKg: 1.65,
    propDiameterIn: 10,
    recommendedKv: 920,
    recommendedEscA: 35,
    maxPayloadKg: 2.5,
    dragArea: 0.105,
    redundantMotors: 2,
    blurb:
      "Eight motors, the workhorse for cameras and cargo. Thrust is redistributed automatically after a failure and the aircraft keeps flying; it only becomes critical past three dead motors.",
  },
};

export const AIRFRAME_LIST = [AIRFRAMES.quad, AIRFRAMES.hexa, AIRFRAMES.octo];

/** Index of the motor diametrically opposite motor `i` (or null if there is none). */
export function oppositeMotor(frame, i) {
  const n = frame.motorCount;
  if (n % 2 !== 0) return null;
  return (i + n / 2) % n;
}

/** Indices of the two motors adjacent to motor `i` around the ring. */
export function adjacentMotors(frame, i) {
  const n = frame.motorCount;
  return [(i - 1 + n) % n, (i + 1) % n];
}

/**
 * MULTI-ROTOR FAILURE MODEL (course notes, section 14).
 * Keyed by frame id, then by a failure descriptor. Each entry is the exact
 * consequence chain the students are taught, shown verbatim in the diagnostics panel.
 */
export const FAILURE_MODEL = {
  quad: [
    {
      key: "1motor",
      title: "1 Motor Failure",
      severity: "fatal",
      chain: [
        "Uncontrollable roll/yaw",
        "Rapid spin",
        "Altitude loss",
        "Crash in 2-5 seconds",
      ],
    },
    {
      key: "2motor",
      title: "2 Motors Failure",
      severity: "fatal",
      chain: ["No stabilization possible", "Immediate crash"],
    },
    {
      key: "esc",
      title: "ESC Failure",
      severity: "fatal",
      chain: ["Same effect as motor failure", "FC logs ESC error"],
    },
  ],
  hexa: [
    {
      key: "1motor",
      title: "1 Motor Failure",
      severity: "degraded",
      chain: [
        "Recalculate motor mixing",
        "Increase opposite motor thrust",
        "Yaw correction",
        "Reduced stability",
        "Emergency landing recommended",
      ],
    },
    {
      key: "2adjacent",
      title: "2 Adjacent Motors Failure",
      severity: "fatal",
      chain: ["Severe instability", "Crash likely"],
    },
    {
      key: "2opposite",
      title: "2 Opposite Motors Failure",
      severity: "critical",
      chain: ["Limited recovery possible", "Forced landing"],
    },
  ],
  octo: [
    {
      key: "1motor",
      title: "1 Motor Failure",
      severity: "nominal",
      chain: [
        "Automatic thrust redistribution",
        "Pilot warning",
        "Stable flight continues",
        "Return-To-Home optional",
      ],
    },
    {
      key: "2motor",
      title: "2 Motor Failure",
      severity: "degraded",
      chain: [
        "Degraded performance",
        "Reduced payload",
        "Controlled landing possible",
      ],
    },
    {
      key: "3motor",
      title: "3 Motor Failure",
      severity: "critical",
      chain: ["Severe instability", "Emergency landing required"],
    },
    {
      key: "4motor",
      title: "4+ Motor Failure",
      severity: "fatal",
      chain: ["Crash"],
    },
  ],
};

/**
 * Given the live set of dead motors, pick the failure-model entry that applies.
 * This is what turns "motor 3 just died" into the lesson text above.
 */
export function classifyMotorFailure(frame, deadIndices) {
  const n = deadIndices.length;
  if (n === 0) return null;
  const table = FAILURE_MODEL[frame.id];

  if (frame.id === "quad") {
    return table.find((e) => e.key === (n === 1 ? "1motor" : "2motor")) || table[1];
  }

  if (frame.id === "hexa") {
    if (n === 1) return table.find((e) => e.key === "1motor");
    if (n === 2) {
      const [a, b] = deadIndices;
      const isOpposite = oppositeMotor(frame, a) === b;
      return table.find((e) => e.key === (isOpposite ? "2opposite" : "2adjacent"));
    }
    return {
      key: "3plus",
      title: `${n} Motors Failure`,
      severity: "fatal",
      chain: ["Beyond recoverable envelope", "Crash"],
    };
  }

  // octo
  if (n === 1) return table.find((e) => e.key === "1motor");
  if (n === 2) return table.find((e) => e.key === "2motor");
  if (n === 3) return table.find((e) => e.key === "3motor");
  return table.find((e) => e.key === "4motor");
}
