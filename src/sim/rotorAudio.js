import { getAudioContext } from "./buzzer.js";

/**
 * ROTOR AUDIO
 * ===========
 * The sound of the aircraft itself — motors and propellers — as distinct from the
 * buzzer, which is a component bolted to it.
 *
 * This is NOT gated on the buzzer being fitted. A quadcopter with no buzzer is
 * silent in the sense that it never *tells* you anything, but it is not quiet:
 * four propellers moving air is the loudest thing about it. Tying the two
 * together would have taught students something false.
 *
 * WHAT A MULTIROTOR ACTUALLY SOUNDS LIKE
 * --------------------------------------
 * Two ingredients, and the mix between them is what makes it read as a drone
 * rather than as a motor or a fan:
 *
 *   1. BLADE PASS TONES. A propeller chops the air once per blade per rotation,
 *      so it radiates a tone at the blade-pass frequency, BPF = RPM/60 x blades,
 *      plus harmonics. A 920 KV motor on 3S hovers near 7000 RPM, so a two-blade
 *      prop sits around 230 Hz — which is exactly the hum you hear standing next
 *      to one. Because it is driven from RPM, the pitch rises with throttle on
 *      its own; nothing here has to fake that.
 *
 *   2. BROADBAND NOISE. Turbulence off the blade tips. This is the "whoosh" that
 *      grows as the aircraft works harder, and its absence is why a pure tone
 *      sounds like a wasp instead of an aircraft.
 *
 * And one emergent property worth more than either: the four motors run at
 * genuinely different RPM, because the mixer is holding the aircraft level. Four
 * slightly detuned tones BEAT against each other, and that slow throbbing warble
 * is the single most recognisable thing about multirotor noise. It is not
 * simulated here — it falls out of using the real per-motor RPM.
 *
 * WHY SYNTHESISED
 * ---------------
 * A recording would be one fixed sound at one fixed throttle, looped. This
 * follows the physics the simulator is already computing, so climbing away, easing
 * into a hover and cutting the motors all sound like what they are — and a motor
 * that has failed simply stops contributing its tone.
 */

/* Propeller blades. Every airframe in the curriculum runs two-blade props. */
const BLADES = 2;

/* Above this the tones would climb into a whistle no real 10-inch prop makes;
   it is a guard against a runaway RPM reading, not a musical choice. */
const MAX_BPF = 900;

let nodes = null;
let running = false;
let muted = false;
let level = 0; // smoothed loudness, 0..1

function build(ctx) {
  /* One second of white noise, looped. Cheaper and more controllable than a
     ScriptProcessor, and at this bandwidth the loop is inaudible. */
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;

  /* Band-passed rather than raw: tip turbulence is not flat, it peaks where the
     blade is moving fastest, and unfiltered white noise reads as radio static. */
  const noiseBand = ctx.createBiquadFilter();
  noiseBand.type = "bandpass";
  noiseBand.frequency.value = 1400;
  noiseBand.Q.value = 0.55;

  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;

  /* One oscillator per motor. Sawtooth because a blade-pass tone is rich in
     harmonics — a sine would sound like a test tone. */
  const rotors = [];
  for (let i = 0; i < 8; i++) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 200;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(g);
    rotors.push({ osc, gain: g });
    osc.start();
  }

  /* Rolls the harmonics off so the tone stays a hum rather than a buzz. Opens up
     under power, which is what makes a hard climb sound harsher than a hover. */
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 1600;
  tone.Q.value = 0.9;

  const master = ctx.createGain();
  master.gain.value = 0;

  rotors.forEach((r) => r.gain.connect(tone));
  tone.connect(master);
  noise.connect(noiseBand);
  noiseBand.connect(noiseGain);
  noiseGain.connect(master);
  /* A limiter between the mix and the speakers.
     Four oscillators plus a noise bed can sum past full scale on a hard climb,
     and digital clipping does not sound like a loud drone — it sounds like a
     broken one. This holds the peaks and leaves everything below the threshold
     untouched, which is what allows the level above to be raised at all. */
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;

  master.connect(limiter);
  limiter.connect(ctx.destination);
  noise.start();

  return { ctx, noise, noiseBand, noiseGain, rotors, tone, master };
}

/** Spin up the synth. Safe to call repeatedly. */
export function startRotorAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (!nodes) nodes = build(ctx);
  if (!running) {
    /* Clear the fade-out the last stop scheduled. Without this a restart is
       fighting a ramp that is still running towards zero, and whether any sound
       comes back depends on which of the two the audio thread saw last — which
       is exactly the kind of bug that shows up as "it worked a minute ago". */
    const now = ctx.currentTime;
    nodes.master.gain.cancelScheduledValues(now);
    nodes.master.gain.setValueAtTime(nodes.master.gain.value, now);
  }
  running = true;
}

/** Fade out and stop driving. The graph is kept for the next flight. */
export function stopRotorAudio() {
  running = false;
  level = 0;
  if (!nodes) return;
  const now = nodes.ctx.currentTime;
  nodes.master.gain.cancelScheduledValues(now);
  nodes.master.gain.setTargetAtTime(0, now, 0.08);
}

/**
 * The synth's output node, or null before it has been started.
 *
 * Exposed so the rotor bed can be metered or re-routed without reaching into the
 * module — a level meter, a recording tap, or a separate volume control all hang
 * off this rather than off the destination everything else shares.
 */
export function getRotorOutput() {
  return nodes ? nodes.master : null;
}

export function setRotorMuted(v) {
  muted = Boolean(v);
  if (muted) stopRotorAudio();
}

/**
 * Drive the synth from the simulator, once per rendered frame.
 *
 * `rpms` is the live per-motor array — the same numbers the propellers are being
 * drawn from, so what you hear and what you see cannot disagree.
 */
export function updateRotorAudio(rpms, { crashed = false, dt = 1 / 60 } = {}) {
  if (muted || !rpms || !rpms.length) return;

  /* Self-starting, unconditionally.
     Tying the synth to the flight-mode TRANSITION meant it never started if the
     scene was already in flight when the simulator attached, or if the browser
     only granted audio after that edge had passed. Building on the first update
     instead is state-driven and cannot miss an edge. The graph is silent until
     driven, so building it a little early costs nothing. */
  if (!nodes || !running) {
    startRotorAudio();
    if (!nodes) return; // no audio available at all
  }

  const { ctx } = nodes;
  const now = ctx.currentTime;

  let live = 0;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < rpms.length && i < nodes.rotors.length; i++) {
    const rpm = rpms[i] || 0;
    const bpf = Math.min(MAX_BPF, (rpm / 60) * BLADES);
    const r = nodes.rotors[i];
    if (bpf > 8) {
      /* setTargetAtTime, not setValueAtTime: stepping the frequency once per
         frame is audible as a zipper. The short time constant tracks throttle
         closely while smoothing the step. */
      r.osc.frequency.setTargetAtTime(bpf, now, 0.03);
      r.gain.gain.setTargetAtTime(0.2, now, 0.05);
      live++;
      sum += rpm;
      peak = Math.max(peak, rpm);
    } else {
      // A dead motor contributes nothing — you can hear which one stopped
      r.gain.gain.setTargetAtTime(0, now, 0.05);
    }
  }
  for (let i = rpms.length; i < nodes.rotors.length; i++) {
    nodes.rotors[i].gain.gain.setTargetAtTime(0, now, 0.05);
  }

  /* Loudness from mean RPM, with a steep curve: aerodynamic noise rises far
     faster than linearly with tip speed, which is why a drone barely audible at
     idle is unmissable on a hard climb. */
  const mean = live ? sum / live : 0;
  const target = crashed ? 0 : Math.min(1, Math.pow(mean / 9000, 1.7));
  // Smoothed in JS as well, so a single odd frame cannot make it stutter
  level += (target - level) * Math.min(1, dt * 10);

  /* Louder. 0.16 was set by ear on headphones and is far too quiet through the
     speakers a classroom actually has — a laptop at half volume with twenty
     students in the room. The limiter below is what makes this safe to raise:
     it is the ceiling, so a bigger number here means the quiet parts come up
     while the loud parts stay exactly where they were. */
  nodes.master.gain.setTargetAtTime(level * 0.42, now, 0.06);
  nodes.noiseGain.gain.setTargetAtTime(level * 0.55, now, 0.08);
  // Both filters open with power: more air, more high end
  nodes.noiseBand.frequency.setTargetAtTime(900 + level * 1700, now, 0.1);
  nodes.tone.frequency.setTargetAtTime(700 + level * 2200, now, 0.1);
}
