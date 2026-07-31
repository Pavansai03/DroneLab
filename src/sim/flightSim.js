/**
 * FLIGHT SIMULATOR
 * ================
 * A genuine (if simplified) multirotor simulation, not an animation.
 *
 * The loop follows the Complete Flight Logic diagram exactly:
 *
 *   Receiver sticks
 *        |
 *        v
 *   Flight Controller  --(attitude PID)-->  roll / pitch / yaw demands
 *        |
 *        v
 *   Motor Mixing Algorithm  ->  per-motor throttle 0..1
 *        |
 *        v
 *   ESCs  ->  Motors  ->  RPM  ->  Propellers  ->  thrust + reaction torque
 *        |
 *        v
 *   Rigid body:  forces -> linear acceleration,  torques -> angular acceleration
 *
 * Because the torques are computed from the ACTUAL thrust each propeller makes,
 * the failure behaviour is emergent rather than scripted:
 *   - a reversed motor produces negative thrust, so the aircraft really does flip;
 *   - a quadcopter that loses a motor really does lose yaw authority and spin up,
 *     while a hexacopter's mixer really can redistribute and keep flying.
 *
 * Axis convention (matches three.js): X = right, Y = up, Z = forward.
 * Euler order YXZ:  yaw about Y, pitch about X, roll about Z.
 *   + roll  = roll right     + pitch = nose up     + yaw = nose right
 */

import { AIRFRAMES } from "../data/airframes.js";
import { getMixer, mix } from "./mixer.js";
import { ObstacleField, WARN_DISTANCE } from "./obstacles.js";
import {
  g,
  airDensity,
  motorRpm,
  propThrustN,
  propPowerW,
  inchesToM,
  batteryVoltage,
  capacityFactor,
  stepEscTemp,
  ESC_LIMIT_C,
  dragForceN,
  BATTERY_SPEC,
} from "./physics.js";

const KAPPA = 0.016; // prop reaction-torque arm, metres (torque = KAPPA * thrust)

/* Below this height, cutting the motors is landing. Above it, it is a crash.
   Set just above the skid height so setting down on the pad and then disarming —
   the correct way to end a flight — is never punished. */
const DISARM_SAFE_ALT = 0.6;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* Mission gates — the course flown in Modules 2, 4 and 5. */
export const GATES = [
  { x: 6, y: 4, z: 14 },
  { x: -8, y: 6, z: 26 },
  { x: 0, y: 8, z: 38 },
  { x: 11, y: 5, z: 50 },
  { x: -6, y: 4, z: 61 },
  { x: 0, y: 6, z: 72 },
];

export class FlightSim {
  constructor() {
    this.reset();
    this.sticks = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    this.keys = {};
    this.listeners = new Set();
  }

  /* --------------------------------------------------------------- setup */

  configure({ build, env, capabilities }) {
    this.build = build;
    this.frame = AIRFRAMES[build.frameId] || AIRFRAMES.quad;
    this.env = env;
    this.capabilities = capabilities || {};
    this.mixTable = getMixer(this.frame);

    const fault = build.faultState || {};
    // Motors killed at runtime (ESC thermal shutdown, a prop departing) must survive
    // a re-configure, otherwise editing the build mid-flight would "heal" them.
    this.runtimeDead = this.runtimeDead || new Set();
    this.dead = new Set([
      ...(fault.deadMotor || []),
      ...(fault.deadEsc || []),
      ...(fault.brokenPdbOutput || []),
      ...this.runtimeDead,
    ]);
    this.reversed = new Set(fault.reversedMotor || []);
    this.wrongProp = new Set(fault.wrongProp || []);
    this.jammed = new Set(fault.jammedMotor || []);
    this.loose = new Set(fault.looseProp || []);
    this.escTempBoost = fault.escTempBoost || {};

    this.kv = build.motorKv || this.frame.recommendedKv;
    this.capacityMah = build.capacityMah || 4200;
    this.batteryMassKg = this.capacityMah === 5200 ? 0.395 : 0.32;
    this.payloadKg = env?.payload || 0;
    this.massKg = this.frame.dryMassKg + this.batteryMassKg + this.payloadKg;

    /* The aircraft is treated as a sphere for collisions: arm length out to the
       motor, plus a propeller radius. It is the propeller tips that hit things
       first, and it is the propeller tips that end the flight when they do. */
    this.collisionRadius =
      this.frame.armLength + inchesToM(this.frame.propDiameterIn) / 2;

    // Inertia: mass distributed between a central hub and the motor pods
    const L = this.frame.armLength;
    this.Ixx = Math.max(0.004, 0.25 * this.massKg * L * L);
    this.Izz = this.Ixx * 1.9;

    if (this.escTemps.length !== this.frame.motorCount) {
      this.escTemps = new Array(this.frame.motorCount).fill(env?.temperature ?? 25);
      this.motorThrust = new Array(this.frame.motorCount).fill(0);
      this.motorRpmArr = new Array(this.frame.motorCount).fill(0);
      this.motorOut = new Array(this.frame.motorCount).fill(0);
    }
  }

  reset(keepBattery = false) {
    this.pos = { x: 0, y: 0.12, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.p = 0; // roll rate
    this.q = 0; // pitch rate
    this.r = 0; // yaw rate

    this.armed = false;
    this.crashed = false;
    this.crashCause = null;
    this.onGround = true;
    this.flightMode = "disarmed";

    if (!keepBattery) {
      this.soc = 1;
      this.mahUsed = 0;
    }
    this.voltage = BATTERY_SPEC.vFull;
    this.sag = 0;
    this.currentA = 0;

    this.escTemps = this.escTemps || [];
    this.escTemps = this.escTemps.map(() => this.env?.temperature ?? 25);
    this.motorThrust = (this.motorThrust || []).map(() => 0);
    this.motorRpmArr = (this.motorRpmArr || []).map(() => 0);
    this.motorOut = (this.motorOut || []).map(() => 0);
    this.escShutdown = new Set();
    this.runtimeDead = new Set();
    if (this.dead) {
      // Drop runtime kills but keep the faults the teacher injected.
      const fault = this.build?.faultState || {};
      this.dead = new Set([
        ...(fault.deadMotor || []),
        ...(fault.deadEsc || []),
        ...(fault.brokenPdbOutput || []),
      ]);
    }
    this._emitted = new Set();

    this.satellites = 0;
    this.satTimer = 0;

    this.hoverTimer = 0;
    this.windTestTimer = 0;
    this.payloadTestTimer = 0;
    this.posHoldTimer = 0;
    this.distanceFlown = 0;
    this.maxAltitude = 0;
    this.announcedTakeoff = false;
    this.achievements = new Set();
    this.gatesPassed = new Set();
    this.rthActive = false;
    this.obstacleDistance = Infinity;
    this.obstacleLabel = null;
    this.events = [];

    // PID integrators
    this.iRoll = 0;
    this.iPitch = 0;
    this.iYaw = 0;
    this.iAlt = 0;

    this.imuDriftX = 0;
    this.imuDriftZ = 0;
    this.time = 0;
  }

  /**
   * Hand the simulator the scenery it is flying through.
   *
   * Called whenever the field changes. Passing null (the assembly bay, or a field
   * that has not loaded yet) leaves the sky empty rather than keeping the last
   * field's buildings around invisibly.
   */
  setObstacles(list) {
    this.obstacles = list && list.length ? new ObstacleField(list) : null;
    this.obstacleDistance = Infinity;
    this.obstacleLabel = null;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, payload) {
    this.events.push({ type, payload, t: this.time });
    this.listeners.forEach((fn) => fn(type, payload));
  }

  /* ---------------------------------------------------------- pilot input */

  setKey(code, down) {
    this.keys[code] = down;
  }

  arm() {
    if (this.crashed) return false;
    this.armed = true;
    this.emit("armed");
    return true;
  }

  /**
   * Cut the motors.
   *
   * On the ground this is the normal end of a flight. In the air it is not a
   * control input at all — it is switching the aircraft off mid-hover, and every
   * multirotor does exactly one thing after that. There is no soft version of it
   * and no recovery, so the simulator says so immediately rather than letting the
   * student watch a silent fall and wonder whether they can still save it.
   */
  disarm() {
    const wasFlying = this.armed && !this.crashed && this.pos.y > DISARM_SAFE_ALT;
    this.armed = false;
    this.emit("disarmed");
    if (wasFlying) {
      this.crash(`Disarmed in flight at ${this.pos.y.toFixed(1)} m — motors stopped`);
    }
  }

  triggerRth() {
    if (!this.armed || this.crashed) return;
    this.rthActive = true;
    this.emit("rth");
  }

  /**
   * WHICH WAY IS RIGHT?
   * -------------------
   * The aircraft's nose is +Z and up is +Y. The chase camera sits BEHIND the
   * aircraft, so it looks along +Z — and in a right-handed system a camera facing
   * +Z has screen-right at -X, not +X.
   *
   * So from the pilot's seat:
   *     pilot RIGHT = -X          pilot LEFT = +X
   *
   * A positive yaw angle swings the nose from +Z toward +X, which the pilot sees
   * as a turn to the LEFT. "Turn left" is therefore a POSITIVE yaw demand, and
   * "slide right" is a POSITIVE roll demand (positive roll tips the lift vector
   * toward -X). Getting this backwards is what made A and D feel swapped.
   */
  readSticks() {
    const k = this.keys;
    const on = (...codes) => codes.some((c) => k[c]);
    return {
      pitch: (on("KeyW", "ArrowUp") ? 1 : 0) - (on("KeyS", "ArrowDown") ? 1 : 0),
      yaw: (on("KeyA", "ArrowLeft") ? 1 : 0) - (on("KeyD", "ArrowRight") ? 1 : 0),
      /* Descend is Z, NOT Shift. Windows opens its Sticky Keys prompt after five
         Shift presses, which is trivially reached by a student tapping to come
         down — and the dialog steals focus mid-flight, so the keyup never
         arrives and the control sticks on. Z sits under the left hand next to
         W/A/S/D and triggers nothing. */
      throttle: (on("Space") ? 1 : 0) - (on("KeyZ") ? 1 : 0),
      roll: (on("KeyE") ? 1 : 0) - (on("KeyQ") ? 1 : 0),
    };
  }

  /* ------------------------------------------------------------- the loop */

  step(dt) {
    if (!this.frame) return;
    dt = Math.min(dt, 0.033);
    this.time += dt;

    const env = this.env || {};
    const ambientC = env.temperature ?? 25;
    const siteAltM = env.altitude ?? 0;
    const windSpeed = env.wind ?? 0;
    const rho = airDensity(siteAltM + this.pos.y, ambientC);
    this.rho = rho;

    /* ---- GPS acquisition ------------------------------------------- */
    const gpsFitted = this.capabilities.gps && !this.capabilities.gpsFaulted;
    if (gpsFitted) {
      this.satTimer += dt;
      const target = this.capabilities.satelliteCap ?? 12;
      this.satellites = Math.min(target, Math.floor(this.satTimer * 1.6));
    } else {
      this.satellites = 0;
    }
    const gpsUsable = this.satellites >= 8;

    /* ---- Battery terminal voltage ----------------------------------- */
    const bat = batteryVoltage(this.soc, this.currentA, this.capacityMah, ambientC);
    this.voltage = this.capabilities.overVoltage ? 16.8 : bat.voltage;
    this.sag = bat.sag;

    /* ---- Failsafe / link ------------------------------------------- */
    const rcOk = this.capabilities.rcLink !== false;
    if (!rcOk && this.armed && !this.rthActive) {
      this.rthActive = true;
      this.flightMode = "failsafe";
      this.emit("failsafe");
    }

    /* ---- Low battery auto-RTH -------------------------------------- */
    if (this.armed && this.soc < 0.2 && !this.rthActive && gpsUsable) {
      this.rthActive = true;
      this.emit("lowBatteryRth");
    }

    /* ---- Pilot / autopilot demands ---------------------------------- */
    const sticks = rcOk ? this.readSticks() : { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
    this.sticks = sticks;

    const MAX_TILT = 0.42; // rad, ~24 degrees
    let rollSet = sticks.roll * MAX_TILT;
    let pitchSet = sticks.pitch * MAX_TILT;
    let yawRateSet = sticks.yaw * 2.2;
    let climbSet = sticks.throttle * 3.0;

    /* Return-To-Home: fly back to the launch point, then descend. */
    if (this.rthActive && this.armed) {
      this.flightMode = this.flightMode === "failsafe" ? "failsafe" : "rth";
      const dx = -this.pos.x;
      const dz = -this.pos.z;
      const dist = Math.hypot(dx, dz);

      /* Return-To-Home is a velocity controller, not a "point and go" one.
         We ask for a speed towards the launch point that tapers off as we close in,
         then lean to chase that velocity. Leaning towards the TARGET VELOCITY rather
         than towards the target POSITION is what stops the aircraft overshooting and
         circling the home point. The nose is turned home separately, purely so the
         camera faces the right way. */
      const desiredSpeed = dist > 0.2 ? Math.min(6, dist * 0.55) : 0;
      const ux = dist > 0.001 ? dx / dist : 0;
      const uz = dist > 0.001 ? dz / dist : 0;
      const evx = ux * desiredSpeed - this.vel.x;
      const evz = uz * desiredSpeed - this.vel.z;

      // World-frame velocity error rotated into the body frame
      const cy = Math.cos(-this.yaw);
      const sy = Math.sin(-this.yaw);
      const eFwd = evz * cy - evx * sy;
      const eRight = evz * sy + evx * cy;

      pitchSet = clamp(eFwd * 0.22, -MAX_TILT, MAX_TILT);
      rollSet = clamp(-eRight * 0.22, -MAX_TILT, MAX_TILT);

      if (dist > 3) {
        const bearing = Math.atan2(dx, dz);
        yawRateSet = clamp(wrapPi(bearing - this.yaw) * 1.2, -1.6, 1.6);
        climbSet = this.pos.y < 6 ? 1.5 : this.pos.y > 9 ? -1 : 0;
      } else {
        yawRateSet = 0;
        climbSet = -1.2; // overhead the pad: controlled descent
        if (this.pos.y < 0.4) this.achievements.add("rth");
      }
    } else if (
      gpsUsable &&
      this.capabilities.positionHold &&
      Math.abs(sticks.pitch) < 0.01 &&
      Math.abs(sticks.roll) < 0.01 &&
      this.armed &&
      !this.onGround
    ) {
      /* Position hold: GPS actively cancels drift. This is the single most
         visible benefit of a satellite lock, so it is worth simulating properly. */
      this.flightMode = "poshold";
      const kp = 0.35;
      const kd = 0.9;
      // Convert world-frame velocity error into body-frame lean commands
      const cy = Math.cos(-this.yaw);
      const sy = Math.sin(-this.yaw);
      const vFwd = this.vel.z * cy - this.vel.x * sy;
      const vRight = this.vel.z * sy + this.vel.x * cy;
      // Nose up (negative pitch) kills forward drift; positive roll tilts the lift
      // vector left, which is what kills a drift to the RIGHT. The two signs differ
      // and getting this wrong makes the drone chase its own drift instead of
      // stopping it.
      pitchSet = clamp(-(vFwd * kd) * kp, -MAX_TILT, MAX_TILT);
      rollSet = clamp((vRight * kd) * kp, -MAX_TILT, MAX_TILT);
      this.posHoldTimer += dt;
      if (this.posHoldTimer > 2.5) this.achievements.add("posHold");
    } else {
      this.posHoldTimer = 0;
      if (this.armed) this.flightMode = gpsUsable ? "gps" : "manual";
    }

    /* ---- IMU health: this is where "Drift" and "Attitude Unknown" bite -- */
    const imuOk = this.capabilities.imuWorking !== false;
    const imuCal = this.capabilities.imuCalibrated !== false;
    if (!imuCal) {
      // Uncalibrated: a slow, steady bias the FC believes is real.
      this.imuDriftX = 0.055;
      this.imuDriftZ = 0.035;
    } else {
      this.imuDriftX = 0;
      this.imuDriftZ = 0;
    }
    // What the FC *thinks* the attitude is
    const measuredRoll = imuOk
      ? this.roll + this.imuDriftX
      : this.roll + Math.sin(this.time * 3.1) * 0.5;
    const measuredPitch = imuOk
      ? this.pitch + this.imuDriftZ
      : this.pitch + Math.cos(this.time * 2.7) * 0.5;

    /* ---- Attitude PID ---------------------------------------------- */
    const KP_ANGLE = 7.0;
    const KP_RATE = 0.11;
    const KI_RATE = 0.05;
    const KD_RATE = 0.008;

    const rollRateSet = clamp((rollSet - measuredRoll) * KP_ANGLE, -6, 6);
    const pitchRateSet = clamp((pitchSet - measuredPitch) * KP_ANGLE, -6, 6);

    const eRoll = rollRateSet - this.p;
    const ePitch = pitchRateSet - this.q;
    const eYaw = yawRateSet - this.r;

    this.iRoll = clamp(this.iRoll + eRoll * dt, -1.5, 1.5);
    this.iPitch = clamp(this.iPitch + ePitch * dt, -1.5, 1.5);
    this.iYaw = clamp(this.iYaw + eYaw * dt, -1.5, 1.5);

    let rollCmd = clamp(KP_RATE * eRoll + KI_RATE * this.iRoll - KD_RATE * this.p, -0.5, 0.5);
    let pitchCmd = clamp(KP_RATE * ePitch + KI_RATE * this.iPitch - KD_RATE * this.q, -0.5, 0.5);
    let yawCmd = clamp(0.09 * eYaw + 0.04 * this.iYaw, -0.4, 0.4);

    /* ---- Altitude / throttle ---------------------------------------- */
    const baroOk = this.capabilities.baroWorking !== false;
    let throttleCmd = 0;
    if (this.armed) {
      const hoverGuess = this.estimateHoverThrottle(rho);
      if (baroOk) {
        const climbErr = climbSet - this.vel.y;
        this.iAlt = clamp(this.iAlt + climbErr * dt * 0.25, -0.25, 0.25);
        throttleCmd = clamp(hoverGuess + climbErr * 0.09 + this.iAlt, 0.06, 1);
      } else {
        // No barometer: raw throttle, the drone bobs
        throttleCmd = clamp(hoverGuess + climbSet * 0.09, 0.06, 1);
      }
    }

    /* ---- Motor Mixing Algorithm ------------------------------------- */
    const outputs = mix(
      this.frame,
      { throttle: throttleCmd, roll: rollCmd, pitch: pitchCmd, yaw: yawCmd },
      this.dead
    );

    /* ---- ESC -> Motor -> Propeller ---------------------------------- */
    const D = inchesToM(this.frame.propDiameterIn);
    let totalThrust = 0;
    let tauRoll = 0;
    let tauPitch = 0;
    let tauYaw = 0;
    let totalPowerW = 4; // avionics baseline
    const L = this.frame.armLength;
    const airspeed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);

    for (let i = 0; i < this.frame.motorCount; i++) {
      const m = this.mixTable[i];
      let out = outputs[i];

      if (this.dead.has(i) || this.escShutdown.has(i) || this.jammed.has(i)) out = 0;

      const rpm = motorRpm(out, this.voltage, this.kv);
      let thrust = propThrustN(rpm, D, rho);

      // A reversed motor or a mismatched propeller blows air the WRONG WAY.
      // Nothing is scripted here — the negative thrust is what flips the drone.
      if (this.reversed.has(i) || this.wrongProp.has(i)) thrust = -thrust * 0.85;

      // A loose prop wobbles, losing efficiency, and eventually departs.
      if (this.loose.has(i)) {
        thrust *= 0.82 + Math.sin(this.time * 37 + i) * 0.12;
        if (this.time > 6 && Math.random() < dt * 0.08) {
          this.dead.add(i);
          this.runtimeDead.add(i);
          this.emit("propDeparted", { motor: i });
        }
      }

      this.motorOut[i] = out;
      this.motorRpmArr[i] = rpm;
      this.motorThrust[i] = thrust;

      totalThrust += thrust;

      // Torques from this motor's actual thrust
      const a = (m.angle * Math.PI) / 180;
      tauRoll += thrust * -Math.sin(a) * L;
      tauPitch += thrust * -Math.cos(a) * L;
      // A propeller spinning CW (seen from above) drags the airframe the other way.
      // CW from above means the nose swings toward -X, which is DECREASING yaw, so
      // the reaction on the airframe is an INCREASING yaw — hence +spin here.
      tauYaw += m.spin * KAPPA * thrust;

      // Power and ESC heating
      const pw = propPowerW(rpm, D, rho);
      totalPowerW += pw;
      const escCurrent = pw / Math.max(1, this.voltage);
      this.escTemps[i] = stepEscTemp(
        this.escTemps[i],
        escCurrent,
        this.voltage,
        ambientC,
        airspeed,
        dt
      );
      const effTemp = this.escTemps[i] + (this.escTempBoost[i] || 0);
      // ESC logic tree: >90 degC -> Overheat -> Reduce Power -> Shutdown.
      // Real controllers give up somewhere around 105 degC, so that is the point at
      // which the "Shutdown" leaf of the diagram actually happens.
      if (effTemp > ESC_LIMIT_C + 15) {
        if (!this.escShutdown.has(i)) {
          this.escShutdown.add(i);
          this.dead.add(i);
          this.runtimeDead.add(i);
          this.emit("escShutdown", { motor: i, temp: effTemp });
        }
      } else if (effTemp > ESC_LIMIT_C) {
        this.motorThrust[i] *= 0.6; // "Reduce Power"
        totalThrust -= thrust * 0.4;
        this.emitOnce("escOverheat", { motor: i, temp: effTemp });
      }
    }

    this.currentA = totalPowerW / Math.max(1, this.voltage);

    /* ---- Battery consumption ---------------------------------------- */
    const usableMah = this.capacityMah * capacityFactor(ambientC);
    this.mahUsed += (this.currentA * 1000 * dt) / 3600;
    this.soc = clamp(1 - this.mahUsed / usableMah, 0, 1);
    if (this.capabilities.socOverride != null) this.soc = this.capabilities.socOverride;

    /* ---- Rigid-body rotation ---------------------------------------- */
    const pDot = tauRoll / this.Ixx;
    const qDot = tauPitch / this.Ixx;
    const rDot = tauYaw / this.Izz;

    const damp = 0.985;
    this.p = (this.p + pDot * dt) * damp;
    this.q = (this.q + qDot * dt) * damp;
    this.r = (this.r + rDot * dt) * damp;

    this.roll = wrapPi(this.roll + this.p * dt);
    this.pitch = wrapPi(this.pitch + this.q * dt);
    this.yaw = wrapPi(this.yaw + this.r * dt);

    /* ---- Rigid-body translation ------------------------------------- */
    // Body "up" rotated into world space (Euler YXZ)
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy2 = Math.cos(this.yaw), sy2 = Math.sin(this.yaw);

    const upX = -sr * cy2 + cr * sp * sy2;
    const upY = cr * cp;
    const upZ = sr * sy2 + cr * sp * cy2;

    let fx = totalThrust * upX;
    let fy = totalThrust * upY - this.massKg * g;
    let fz = totalThrust * upZ;

    // Wind pushes along +X, and the drone must lean into it to stay put
    const windDirX = 1, windDirZ = 0;
    const relX = this.vel.x - windSpeed * windDirX;
    const relY = this.vel.y;
    const relZ = this.vel.z - windSpeed * windDirZ;
    const relSpeed = Math.hypot(relX, relY, relZ);
    if (relSpeed > 0.01) {
      const dragN = dragForceN(relSpeed, this.frame.dragArea, rho);
      fx -= (relX / relSpeed) * dragN;
      fy -= (relY / relSpeed) * dragN;
      fz -= (relZ / relSpeed) * dragN;
    }

    this.vel.x += (fx / this.massKg) * dt;
    this.vel.y += (fy / this.massKg) * dt;
    this.vel.z += (fz / this.massKg) * dt;

    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    this.distanceFlown += Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
    this.maxAltitude = Math.max(this.maxAltitude, this.pos.y);

    /* ---- Ground contact --------------------------------------------- */
    if (this.pos.y <= 0.12) {
      const impact = -this.vel.y;
      const tilt = Math.hypot(this.roll, this.pitch);
      this.pos.y = 0.12;

      if (this.armed && (impact > 3.5 || tilt > 0.9)) {
        this.crash(
          impact > 3.5
            ? `Hard impact at ${impact.toFixed(1)} m/s`
            : `Touched down at ${((tilt * 180) / Math.PI).toFixed(0)} degrees of bank`
        );
      } else {
        /* Touching down and touching down WELL are different things.
           The event fires on any survivable arrival, because the pilot needs to
           hear that they are down whether it was tidy or not. The achievement
           keeps its quality bar: under 1 m/s is a real landing, 3 m/s is an
           arrival you got away with. Conflating the two meant a student who
           descended at full rate landed safely and got no feedback at all. */
        if (!this.onGround && this.armed && this.maxAltitude > 1.0) {
          this.emit("landed", { impact, clean: impact < 1.0 });
          if (impact < 1.0) this.achievements.add("landed");
        }
        this.onGround = true;
        this.vel.x *= 0.7;
        this.vel.z *= 0.7;
        this.vel.y = 0;
        if (!this.armed) {
          this.roll = lerp(this.roll, 0, 0.15);
          this.pitch = lerp(this.pitch, 0, 0.15);
          this.p = this.q = this.r = 0;
        }
      }
    } else {
      this.onGround = false;
    }

    /* ---- Scenery ----------------------------------------------------- */
    /* Run this whether or not we are armed: an unpowered aircraft still falls
       into things, and the proximity alarm has to keep sounding through a
       failsafe descent, which is precisely when it matters most. */
    if (this.obstacles && !this.crashed) {
      const near = this.obstacles.nearest(this.pos.x, this.pos.y, this.pos.z);
      // Distance to the propeller disc, not to the centre of mass
      const clearance = near.distance - this.collisionRadius;
      this.obstacleDistance = clearance;
      this.obstacleLabel = clearance < WARN_DISTANCE ? near.obstacle?.label ?? null : null;

      if (clearance <= 0 && this.pos.y > 0.2) {
        const speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
        this.crash(
          `Hit ${near.obstacle?.label ?? "an obstacle"} at ${speed.toFixed(1)} m/s`
        );
      }
    } else {
      this.obstacleDistance = Infinity;
      this.obstacleLabel = null;
    }

    /* ---- Crash conditions ------------------------------------------- */
    if (this.armed && !this.crashed) {
      const tilt = Math.hypot(this.roll, this.pitch);
      if (tilt > 1.75 && this.pos.y > 0.3) {
        this.crash("Inverted — attitude beyond recovery");
      } else if (Math.abs(this.r) > 14) {
        this.crash("Uncontrollable yaw spin — no yaw authority");
      } else if (this.soc <= 0.001) {
        this.crash("Battery exhausted in flight");
      } else if (this.voltage < BATTERY_SPEC.vCritical && this.pos.y > 0.5) {
        this.crash("Under-voltage — power lost mid-flight");
      }
    }

    /* ---- Mission gates ---------------------------------------------- */
    for (let i = 0; i < GATES.length; i++) {
      if (this.gatesPassed.has(i)) continue;
      const gate = GATES[i];
      const d = Math.hypot(this.pos.x - gate.x, this.pos.y - gate.y, this.pos.z - gate.z);
      if (d < 1.8) {
        this.gatesPassed.add(i);
        this.emit("gate", { index: i, total: GATES.length });
        if (this.gatesPassed.size === GATES.length) {
          this.achievements.add("mission");
          this.emit("missionComplete");
        }
      }
    }

    /* ---- Achievements ------------------------------------------------ */
    this.trackAchievements(dt, windSpeed);
  }

  emitOnce(type, payload) {
    const key = `${type}:${payload?.motor ?? ""}`;
    this._emitted = this._emitted || new Set();
    if (this._emitted.has(key)) return;
    this._emitted.add(key);
    this.emit(type, payload);
  }

  trackAchievements(dt, windSpeed) {
    if (!this.armed || this.crashed) return;
    const speed = Math.hypot(this.vel.x, this.vel.z);

    if (this.pos.y > 2) {
      /* Fire once per flight, not once per frame above 2 m. `announcedTakeoff`
         resets with the sim, so a second sortie announces itself again. */
      if (!this.announcedTakeoff) {
        this.announcedTakeoff = true;
        this.emit("takeoff", { altitude: this.pos.y });
      }
      this.achievements.add("takeoff");
    }

    if (this.pos.y > 1 && Math.abs(this.vel.y) < 0.5) {
      this.hoverTimer += dt;
      if (this.hoverTimer > 3) this.achievements.add("hover");
    } else {
      this.hoverTimer = 0;
    }

    if (speed > 5) this.achievements.add("forward");
    if (this.distanceFlown > 20) this.achievements.add("manual");

    if (windSpeed >= 10 && this.pos.y > 1.5 && speed < 1.5) {
      this.windTestTimer += dt;
      if (this.windTestTimer > 3) this.achievements.add("windTest");
    } else {
      this.windTestTimer = 0;
    }

    const payloadTarget = this.frame.maxPayloadKg * 0.5;
    if (this.payloadKg >= payloadTarget && this.pos.y > 1.5) {
      this.payloadTestTimer += dt;
      if (this.payloadTestTimer > 3) this.achievements.add("payloadTest");
    } else {
      this.payloadTestTimer = 0;
    }
  }

  estimateHoverThrottle(rho) {
    const D = inchesToM(this.frame.propDiameterIn);
    const live = this.frame.motorCount - this.dead.size;
    if (live <= 0) return 0;
    const needPerMotor = (this.massKg * g) / live;
    const rpmFull = motorRpm(1, this.voltage, this.kv);
    const tMax = propThrustN(rpmFull, D, rho);
    if (tMax <= 0) return 1;
    return clamp(Math.sqrt(needPerMotor / tMax), 0.05, 1);
  }

  crash(cause) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashCause = cause;
    this.armed = false;
    this.emit("crash", { cause, altitude: this.pos.y });
  }

  /* ---------------------------------------------------------- telemetry */

  telemetry() {
    return {
      altitude: this.pos.y,
      position: { ...this.pos },
      velocity: { ...this.vel },
      groundSpeed: Math.hypot(this.vel.x, this.vel.z),
      verticalSpeed: this.vel.y,
      heading: ((this.yaw * 180) / Math.PI + 360) % 360,
      rollDeg: (this.roll * 180) / Math.PI,
      pitchDeg: (this.pitch * 180) / Math.PI,
      yawRate: this.r,
      armed: this.armed,
      crashed: this.crashed,
      crashCause: this.crashCause,
      onGround: this.onGround,
      flightMode: this.flightMode,
      rthActive: this.rthActive,
      soc: this.soc,
      voltage: this.voltage,
      sag: this.sag,
      currentA: this.currentA,
      escTemps: [...this.escTemps],
      motorThrust: [...this.motorThrust],
      motorRpm: [...this.motorRpmArr],
      motorOut: [...this.motorOut],
      maxEscTemp: this.escTemps.length ? Math.max(...this.escTemps) : 25,
      satellites: this.satellites,
      obstacleDistance: this.obstacleDistance,
      obstacleLabel: this.obstacleLabel,
      gatesPassed: this.gatesPassed.size,
      gatesTotal: GATES.length,
      achievements: new Set(this.achievements),
      deadMotors: [...this.dead].sort((a, b) => a - b),
      distanceFlown: this.distanceFlown,
      maxAltitude: this.maxAltitude,
      thrustPerMotorN: this.motorThrust.length
        ? Math.max(...this.motorThrust.map(Math.abs))
        : 0,
      weightN: this.massKg * g,
      massKg: this.massKg,
      rho: this.rho ?? 1.225,
      propWash: this.onGround && this.armed ? 0.9 : 0,
      time: this.time,
    };
  }
}

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
