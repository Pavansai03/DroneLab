/**
 * BUZZER
 * ======
 * Synthesises the tones a real flight-controller buzzer makes, with the Web
 * Audio API — no sound files to ship or license.
 *
 * SILENT UNLESS THE BUZZER IS ACTUALLY FITTED AND WIRED.
 * ------------------------------------------------------
 * That is not a technical limitation, it is the lesson. A build with no buzzer
 * gives the pilot no audible feedback at all — arming, pre-arm failures, low
 * battery, and the lost-model alarm after a crash are all silent on a real
 * aircraft too if nobody fitted one. `setEnabled` is driven from whether the
 * buzzer-to-FC harness reports connected, not from a settings toggle.
 *
 * Browsers refuse to start an AudioContext before a user gesture. The context
 * is created lazily on the first tone request, which in practice is the
 * student's own click on ARM.
 */

let ctx = null;
let enabled = false;
let muted = false;

function ensureContext() {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call whenever the buzzer-to-FC wiring status changes. */
export function setBuzzerEnabled(fitted) {
  enabled = Boolean(fitted);
}

export function isBuzzerEnabled() {
  return enabled;
}

export function setBuzzerMuted(v) {
  muted = Boolean(v);
}

export function isBuzzerMuted() {
  return muted;
}

/** Resume a suspended context. Call this from the same click that arms. */
export function unlockAudio() {
  const c = ensureContext();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

function tone(freq, duration, delay = 0, { type = "square", gain = 0.055 } = {}) {
  if (!enabled || muted) return;
  const c = ensureContext();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  // Linear attack then exponential decay — a hard on/off click reads as a pop,
  // not a beep.
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/* ------------------------------------------------------------------ tunes */
/* Patterned on real Betaflight/Pixhawk buzzer tones, so the habit of listening
   before plugging in a laptop actually carries over to a real bench. */

const TUNES = {
  // Two rising beeps — the standard arm tune.
  armed: () => {
    tone(1600, 0.09, 0);
    tone(2000, 0.11, 0.11);
  },
  // Two falling beeps — its mirror image.
  disarmed: () => {
    tone(1600, 0.09, 0);
    tone(1200, 0.11, 0.11);
  },
  // Three fast harsh beeps: a pre-arm check failed.
  armingDenied: () => {
    [0, 0.14, 0.28].forEach((d) => tone(900, 0.09, d, { type: "sawtooth" }));
  },
  // Rising three-note chirp on power-up, like a controller booting.
  powerOn: () => {
    [1000, 1300, 1700].forEach((f, i) => tone(f, 0.07, i * 0.08));
  },
  // Climbing away: a short rising sweep, so leaving the ground is audible even
  // when the pilot is watching the horizon rather than the altimeter.
  takeoff: () => {
    [1200, 1500, 1900].forEach((f, i) => tone(f, 0.1, i * 0.09));
  },
  // Settled back down: the same shape inverted, and softer.
  landed: () => {
    [1900, 1500, 1200].forEach((f, i) => tone(f, 0.11, i * 0.09, { gain: 0.045 }));
  },
  // Slow, deliberate triple beep — the low-battery warning.
  lowBattery: () => {
    [0, 0.5, 1.0].forEach((d) => tone(1500, 0.15, d));
  },
  // Three level beeps: RTH engaged.
  rth: () => {
    [0, 0.15, 0.3].forEach((d) => tone(1800, 0.1, d));
  },
  // Urgent rapid sawtooth: failsafe.
  failsafe: () => {
    for (let i = 0; i < 6; i++) tone(1700, 0.09, i * 0.13, { type: "sawtooth", gain: 0.06 });
  },
  // A short high blip: something needs attention but flight continues.
  warning: () => {
    tone(1400, 0.1, 0);
    tone(1400, 0.1, 0.15);
  },
  // Bright two-note chime: a mission gate.
  gate: () => {
    tone(2200, 0.06, 0);
    tone(2800, 0.09, 0.06);
  },
  // A short rising jingle: mission complete.
  missionComplete: () => {
    [1568, 1976, 2349, 3136].forEach((f, i) => tone(f, 0.14, i * 0.11));
  },
  // The "lost model" alarm — insistent and repeating, exactly what a real FC
  // does after a crash so the wreckage can be found by ear. Real ones run
  // indefinitely; bounded here so a forgotten tab does not beep forever.
  lostModel: () => {
    for (let i = 0; i < 10; i++) tone(2500, 0.12, i * 0.35, { gain: 0.07 });
  },
};

export function play(name) {
  TUNES[name]?.();
}

export const BUZZER_TUNE_NAMES = Object.keys(TUNES);
