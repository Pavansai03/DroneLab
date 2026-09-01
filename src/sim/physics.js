/**
 * FLIGHT PHYSICS
 * ==============
 * Module 4 asks students to understand how wind, payload, temperature and
 * altitude change the way a drone flies. So none of this is faked — the numbers
 * come from the standard relationships a drone engineer actually uses.
 *
 *   Air density (ISA):   rho = P / (R * T)
 *   Propeller thrust:    T   = Ct * rho * n^2 * D^4      (n in rev/s, D in metres)
 *   Propeller power:     P   = Cp * rho * n^3 * D^5
 *   Battery under load:  V   = V_ocv(soc) - I * R_internal
 *
 * Everything below is in SI units unless the name says otherwise.
 */

export const g = 9.80665;
const R_SPECIFIC = 287.058; // J/(kg*K) for dry air
const P0 = 101325; // Pa at sea level
const T0 = 288.15; // K at sea level
const LAPSE = 0.0065; // K/m

/* Propeller coefficients for a typical 10x4.5 two-blade sport prop.
 * Calibrated against real bench data for a 920 KV motor on a 3S pack:
 *   ~7000 RPM at full throttle -> ~800 g thrust per motor, ~115 W per motor
 *   ~4000 RPM in the hover      -> ~260 g thrust per motor, ~37 W per motor
 * which gives a 450-class quad a thrust-to-weight around 3 and roughly 14 minutes
 * of hover on a 4200 mAh pack — the numbers a student would measure themselves. */
export const PROP = {
  Ct: 0.095, // thrust coefficient
  Cp: 0.1, // power coefficient
};

/* A propeller loads the motor down well below its unloaded KV x volts figure. */
export const PROP_LOAD_FACTOR = 0.68;

/* ------------------------------------------------------------------ */
/* Atmosphere                                                          */
/* ------------------------------------------------------------------ */

/**
 * Air density at a given altitude and air temperature.
 * @param altitudeM  height above mean sea level, metres
 * @param tempC      ambient air temperature at that altitude, degrees C
 */
export function airDensity(altitudeM = 0, tempC = 15) {
  // Pressure from the ISA barometric formula
  const pressure = P0 * Math.pow(1 - (LAPSE * altitudeM) / T0, 5.2559);
  const tempK = tempC + 273.15;
  return Math.max(0.2, pressure / (R_SPECIFIC * tempK));
}

/** Density ratio against sea-level standard — the number pilots quote. */
export function densityRatio(altitudeM = 0, tempC = 15) {
  return airDensity(altitudeM, tempC) / airDensity(0, 15);
}

/* ------------------------------------------------------------------ */
/* Propulsion                                                          */
/* ------------------------------------------------------------------ */

/**
 * Steady-state RPM for a motor at a given throttle.
 * KV is RPM per volt UNLOADED; a propeller loads it down to roughly 70-80%.
 */
export function motorRpm(throttle01, voltage, kv, loadFactor = PROP_LOAD_FACTOR) {
  return Math.max(0, throttle01 * voltage * kv * loadFactor);
}

/** Thrust in newtons from one propeller. */
export function propThrustN(rpm, diameterM, rho) {
  const n = rpm / 60; // rev/s
  return PROP.Ct * rho * n * n * Math.pow(diameterM, 4);
}

/** Shaft power in watts absorbed by one propeller. */
export function propPowerW(rpm, diameterM, rho) {
  const n = rpm / 60;
  return PROP.Cp * rho * n * n * n * Math.pow(diameterM, 5);
}

/** Inches to metres, for the 10-inch props in the parts chart. */
export const inchesToM = (inch) => inch * 0.0254;

/**
 * Maximum thrust one motor can make right now.
 * Used for the hover-throttle readout and the failure margin calculation.
 */
export function maxThrustPerMotorN(cfg) {
  const rpm = motorRpm(1, cfg.voltage, cfg.kv);
  return propThrustN(rpm, inchesToM(cfg.propDiameterIn), cfg.rho);
}

/**
 * Fraction of full throttle needed just to hover.
 * Because thrust goes with RPM squared, hover throttle is roughly sqrt(weight/maxThrust).
 */
export function hoverThrottle(cfg) {
  const tMax = maxThrustPerMotorN(cfg);
  const needPerMotor = (cfg.massKg * g) / cfg.motorCount;
  if (tMax <= 0) return 1;
  return Math.min(1, Math.sqrt(Math.max(0, needPerMotor / tMax)));
}

/* ------------------------------------------------------------------ */
/* Battery — 3S Li-Po                                                  */
/* ------------------------------------------------------------------ */

const CELL = {
  vFull: 4.2,
  vNominal: 3.7,
  vCutoff: 3.5,
  vCritical: 3.3,
};

/**
 * Thresholds for a pack of `cells` cells in series.
 *
 * Everything is per-cell and multiplied up, because that is how the chemistry
 * actually works and how a pilot is taught to think: "never below 3.5 volts a
 * cell" is one rule whether the pack is a 3S or a 6S.
 *
 * The reason this is a function rather than the single 3S constant it used to
 * be: eight motors cannot be fed from a 3S pack. At full throttle the octo
 * pulls over 100 A, and 100 A through a 3S pack's internal resistance drops it
 * straight through the cutoff and into a brown-out — the simulator crashed it
 * every single time before the pack was allowed to change. Six cells halve the
 * current for the same power, which is exactly why the course's octo diagram
 * specifies a 6S pack and the quad diagram a 3S one.
 */
export function packSpec(cells = 3) {
  return {
    cells,
    label: `${cells}S`,
    vFullPerCell: CELL.vFull,
    vNominalPerCell: CELL.vNominal,
    vCutoffPerCell: CELL.vCutoff,
    vCriticalPerCell: CELL.vCritical,
    vFull: cells * CELL.vFull,
    vNominal: cells * CELL.vNominal,
    vCutoff: cells * CELL.vCutoff,
    vCritical: cells * CELL.vCritical,
  };
}

/** The 3S pack the quadcopter course is written around. */
export const BATTERY_SPEC = packSpec(3);

/**
 * Open-circuit voltage from state of charge.
 * Li-Po discharge is famously flat in the middle and falls off a cliff at the end,
 * which is why students must learn to watch percentage, not just voltage.
 */
export function ocvFromSoc(soc, cells = BATTERY_SPEC.cells) {
  const s = Math.max(0, Math.min(1, soc));
  // Per-cell curve, piecewise linear through the well-known knee points
  const pts = [
    [0.0, 3.3],
    [0.05, 3.5],
    [0.2, 3.7],
    [0.5, 3.83],
    [0.8, 4.0],
    [1.0, 4.2],
  ];
  let v = pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [s0, v0] = pts[i];
    const [s1, v1] = pts[i + 1];
    if (s >= s0 && s <= s1) {
      v = v0 + ((s - s0) / (s1 - s0)) * (v1 - v0);
      break;
    }
  }
  return v * cells;
}

/**
 * Internal resistance rises sharply in the cold — this is why a pack that flies
 * for 12 minutes in summer manages 7 in winter.
 */
export function internalResistance(capacityMah, tempC, cells = 3) {
  // Per-cell, then multiplied by the number in series — resistance adds along a
  // series string, which is why a 6S pack has twice the resistance of a 3S. It
  // still sags far less in practice, because twice the voltage means half the
  // current for the same power and sag goes as I x R.
  const perCell = 0.012 * (4200 / Math.max(1000, capacityMah)); // ohms
  const base = perCell * cells;
  const coldFactor = tempC < 20 ? 1 + (20 - tempC) * 0.035 : 1;
  const hotFactor = tempC > 40 ? 1 + (tempC - 40) * 0.008 : 1;
  return base * coldFactor * hotFactor;
}

/**
 * Mass of a Li-Po pack, from its two defining numbers.
 * Energy is capacity x cells, and pack mass tracks energy almost linearly. The
 * 25 g per amp-hour per cell below is not a guess: it is the exact slope through
 * the two packs this course already used (3S 4200 at 320 g, 3S 5200 at 395 g),
 * so those two are unchanged to the gram and everything larger extrapolates from
 * real numbers. A 6S 5200 lands at 785 g — which is why picking a bigger battery
 * is never a free upgrade.
 */
export function packMass(capacityMah, cells = 3) {
  return Number(((capacityMah / 1000) * cells * 0.025 + 0.005).toFixed(3));
}

/** Usable capacity shrinks in the cold. */
export function capacityFactor(tempC) {
  if (tempC >= 20) return 1;
  return Math.max(0.55, 1 - (20 - tempC) * 0.012);
}

/** Loaded terminal voltage and how far it sagged. */
export function batteryVoltage(soc, currentA, capacityMah, tempC, cells = 3) {
  const ocv = ocvFromSoc(soc, cells);
  const r = internalResistance(capacityMah, tempC, cells);
  const sag = currentA * r;
  return { voltage: Math.max(0, ocv - sag), ocv, sag, resistance: r };
}

/* ------------------------------------------------------------------ */
/* ESC thermal model                                                   */
/* ------------------------------------------------------------------ */

/* Calibrated so an ESC settles around 45 degC in the hover and reaches its 90 degC
 * limit on sustained full throttle — which is exactly the lesson the ESC decision
 * tree teaches: it is the long hard climb that cooks them, not cruising. */
const ESC_LOSS_FRACTION = 0.05; // fraction of throughput power that becomes heat
const ESC_THERMAL_MASS = 6; // J/K — time constant of roughly a minute
const ESC_COOLING = 0.09; // W/K in still air

/**
 * Step one ESC's temperature. Airflow from forward flight cools it noticeably,
 * which is why a drone that overheats in a hover is often fine cruising.
 */
export function stepEscTemp(tempC, currentA, voltage, ambientC, airspeed, dt) {
  const heatW = currentA * voltage * ESC_LOSS_FRACTION;
  const cooling = ESC_COOLING * (1 + 0.06 * airspeed);
  const dT = (heatW - cooling * (tempC - ambientC)) / ESC_THERMAL_MASS;
  return tempC + dT * dt;
}

export const ESC_LIMIT_C = 90; // the threshold in the ESC logic tree

/* ------------------------------------------------------------------ */
/* Aerodynamics of the airframe itself                                 */
/* ------------------------------------------------------------------ */

const DRAG_CD = 1.1; // a multirotor is essentially a bluff body

/** Aerodynamic drag force in newtons for a relative airspeed. */
export function dragForceN(relSpeed, dragArea, rho) {
  return 0.5 * rho * relSpeed * relSpeed * DRAG_CD * dragArea;
}

/**
 * The lean angle needed to hold position against a steady wind.
 * tan(theta) = drag / weight. Past about 35 degrees the drone simply cannot keep up
 * and starts drifting downwind — a lesson students feel immediately.
 */
export function windHoldAngleRad(windSpeed, dragArea, rho, massKg) {
  const drag = dragForceN(windSpeed, dragArea, rho);
  const weight = massKg * g;
  return Math.atan2(drag, weight);
}

/** Thrust wasted on leaning: only cos(theta) of it fights gravity. */
export function verticalThrustFraction(tiltRad) {
  return Math.cos(tiltRad);
}

/* ------------------------------------------------------------------ */
/* Whole-aircraft performance summary — powers the readouts in the UI  */
/* ------------------------------------------------------------------ */

/**
 * @param {object} p
 *   frame, kv, capacityMah, payloadKg, soc, env {wind, temperature, altitude}
 */
export function performanceSummary(p) {
  const {
    frame,
    kv = frame.recommendedKv ?? 920,
    capacityMah = frame.recommendedPack?.capacityMah ?? 4200,
    cells = frame.recommendedPack?.cells ?? 3,
    packMassKg,
    payloadKg = 0,
    soc = 1,
    env,
  } = p;
  const tempC = env?.temperature ?? 25;
  const altM = env?.altitude ?? 0;
  const wind = env?.wind ?? 0;

  const rho = airDensity(altM, tempC);
  const batteryMassKg = packMassKg ?? packMass(capacityMah, cells);
  const massKg = frame.dryMassKg + batteryMassKg + payloadKg;

  const { voltage } = batteryVoltage(soc, 0, capacityMah, tempC, cells);

  const cfg = {
    voltage,
    kv,
    rho,
    propDiameterIn: frame.propDiameterIn,
    massKg,
    motorCount: frame.motorCount,
  };

  const tMaxPerMotor = maxThrustPerMotorN(cfg);
  const totalMaxThrustN = tMaxPerMotor * frame.motorCount;
  const weightN = massKg * g;
  const thrustToWeight = totalMaxThrustN / weightN;

  const tilt = windHoldAngleRad(wind, frame.dragArea, rho, massKg);
  // Leaning costs vertical thrust, so effective hover throttle rises
  const hoverT = Math.min(
    1,
    hoverThrottle(cfg) / Math.max(0.35, verticalThrustFraction(tilt))
  );

  const hoverRpm = motorRpm(hoverT, voltage, kv);
  const hoverPowerPerMotor = propPowerW(hoverRpm, inchesToM(frame.propDiameterIn), rho);
  const totalPowerW = hoverPowerPerMotor * frame.motorCount + 4; // +4 W avionics
  const hoverCurrentA = totalPowerW / Math.max(1, voltage);

  const usableMah = capacityMah * capacityFactor(tempC) * 0.8; // never fly a pack flat
  const flightMinutes = hoverCurrentA > 0 ? (usableMah / 1000 / hoverCurrentA) * 60 : 0;

  return {
    rho,
    densityPct: (rho / airDensity(0, 15)) * 100,
    massKg,
    weightN,
    voltage,
    tMaxPerMotor,
    totalMaxThrustN,
    thrustToWeight,
    hoverThrottle: hoverT,
    hoverCurrentA,
    totalPowerW,
    flightMinutes,
    windTiltDeg: (tilt * 180) / Math.PI,
    canHover: thrustToWeight > 1.05,
    // Rules of thumb students should internalise
    verdict:
      thrustToWeight > 2.2
        ? "Sporty — plenty of headroom for control."
        : thrustToWeight > 1.6
          ? "Healthy — the usual target for a stable camera platform."
          : thrustToWeight > 1.15
            ? "Marginal — sluggish, little headroom to correct a gust."
            : "Cannot fly — thrust barely exceeds weight.",
  };
}
