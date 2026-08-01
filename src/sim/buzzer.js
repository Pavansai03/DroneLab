/**
 * BUZZER
 * ======
 * The aircraft's audible alerts, synthesised with the Web Audio API.
 *
 * WHY SYNTHESISED AND NOT RECORDED
 * --------------------------------
 * No sound files ship with this project, so there is nothing to license, nothing
 * to download, and no second copy of the tones to keep in step with the code. The
 * cost is that the realism has to come from modelling the device rather than from
 * recording one — which is what everything below is doing.
 *
 * MODELLING A PIEZO
 * -----------------
 * A flight-controller buzzer is a piezoelectric disc, and it sounds nothing like
 * a raw oscillator. Three properties do almost all of the work:
 *
 *   1. It has NO low end at all. The disc is tiny and stiff, so everything below
 *      about a kilohertz simply is not radiated. A square wave sent straight to
 *      the speakers keeps that energy and comes out fat and synthetic — which is
 *      exactly the "weird" quality a bare oscillator has.
 *   2. It has a sharp mechanical RESONANCE, typically around 4 kHz, and any tone
 *      whose harmonics land near it gets a hard nasal honk. That honk is most of
 *      what makes a buzzer sound like a buzzer.
 *   3. It starts and stops almost instantly, with a mechanical tick on the attack.
 *
 * So every note here is a pair of slightly detuned square oscillators (real discs
 * beat a little), through a high-pass that removes the body, into a peaking filter
 * at the resonance. The chain is shared by every tone, because a real aircraft has
 * one buzzer and everything it says comes out of the same piece of hardware.
 *
 * ONE VOICE AT A TIME
 * -------------------
 * A real buzzer cannot play two things at once, and neither can this one. Tones
 * are ranked, a higher-ranked alert cuts off whatever is sounding, and a
 * lower-ranked one is dropped rather than layered on top. That is both what the
 * hardware does and the fix for arm and take-off talking over each other.
 *
 * SILENT UNLESS THE BUZZER IS ACTUALLY FITTED AND WIRED.
 * -----------------------------------------------------
 * Not a technical limitation — the lesson. A build with no buzzer gives the pilot
 * no audible feedback at all, which is what a real aircraft does if nobody fitted
 * one. `setBuzzerEnabled` is driven by the buzzer-to-FC harness, not by a setting.
 */

/* The disc's mechanical resonance. Real 12 mm FC buzzers sit between 3.8 and
   4.3 kHz; the tones below are chosen around this, so the loud ones really are
   the ones a real aircraft screams with. */
const PIEZO_RESONANCE = 4100;

/* Nothing below this is radiated by a disc that small. Removing it is the single
   biggest difference between "buzzer" and "synthesiser". */
const PIEZO_ROLLOFF = 950;

let ctx = null;
let bus = null; // where every note connects
let master = null;
let enabled = false;
let muted = false;

/* The one voice. `until` is on the AudioContext clock, so it stays correct even
   if the render loop stalls. */
const voice = { until: 0, rank: 0, nodes: [] };

function ensureContext() {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return (ctx = null);
  }

  /* The speaker chain, built once:
     bus -> high-pass (kill the body) -> resonance peak -> limiter -> master */
  bus = ctx.createGain();
  bus.gain.value = 1;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = PIEZO_ROLLOFF;
  hp.Q.value = 0.7;

  const peak = ctx.createBiquadFilter();
  peak.type = "peaking";
  peak.frequency.value = PIEZO_RESONANCE;
  peak.Q.value = 1.9;
  peak.gain.value = 11; // dB of honk

  /* A limiter, because a classroom should never take a sudden spike through
     headphones when two alerts land on the same instant. */
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 4;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.09;

  master = ctx.createGain();
  master.gain.value = 0.12;

  bus.connect(hp);
  hp.connect(peak);
  peak.connect(limiter);
  limiter.connect(master);
  master.connect(ctx.destination);

  return ctx;
}

/** Call whenever the buzzer-to-FC wiring status changes. */
export function setBuzzerEnabled(fitted) {
  enabled = Boolean(fitted);
  if (!enabled) stopVoice();
}

export function isBuzzerEnabled() {
  return enabled;
}

export function setBuzzerMuted(v) {
  muted = Boolean(v);
  if (muted) stopVoice();
}

export function isBuzzerMuted() {
  return muted;
}

/** Resume a suspended context. Call this from the same click that arms. */
export function unlockAudio() {
  const c = ensureContext();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

/* ------------------------------------------------------------------ voice */

/**
 * One note from the disc.
 *
 * Deliberately no pitch sweep. Real flight controllers describe their tones in
 * MML — the QBasic PLAY notation — and MML has no way to express a glide: it is
 * notes, octaves and durations. ArduPilot's whole tone library, from the startup
 * arpeggio to the lost-model alarm, is stepped notes. A portamento is a
 * synthesiser gesture, not a buzzer one, and it was exactly what made the
 * take-off tone sound wrong.
 */
function note(freq, t0, dur, { level = 0.55, detune = 7, type = "square" } = {}) {
  const c = ctx;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  // 2.5 ms attack: fast enough to tick, slow enough not to click
  env.gain.linearRampToValueAtTime(level, t0 + 0.0025);
  env.gain.setValueAtTime(level, t0 + dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
  env.connect(bus);

  for (let i = 0; i < 2; i++) {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    // The pair is detuned against itself, which gives the slight beating a real disc has
    osc.detune.setValueAtTime(i === 0 ? -detune : detune, t0);
    osc.connect(env);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    voice.nodes.push(osc);
  }
  voice.nodes.push(env);
  return dur;
}

/** Cut whatever is sounding, without a click. */
function stopVoice() {
  if (!ctx || !voice.nodes.length) {
    voice.until = 0;
    voice.rank = 0;
    voice.nodes = [];
    return;
  }
  const now = ctx.currentTime;
  for (const n of voice.nodes) {
    try {
      if (n.gain) {
        n.gain.cancelScheduledValues(now);
        n.gain.setTargetAtTime(0.0001, now, 0.004);
      } else if (n.stop) {
        n.stop(now + 0.03);
      }
    } catch {
      /* already stopped */
    }
  }
  voice.nodes = [];
  voice.until = 0;
  voice.rank = 0;
}

/* ------------------------------------------------------------------ tunes */
/**
 * Ranked the way a cockpit ranks its alerts: things that mean the aircraft is
 * being lost outrank things that mean the pilot did something, which outrank
 * things that are merely informative.
 *
 * A tone at or above the sounding tone's rank cuts it off. Below it, the new tone
 * is dropped — deliberately, because two alerts at once is how a pilot ends up
 * hearing neither.
 */
const RANK = {
  lostModel: 100,
  failsafe: 90,
  armingDenied: 70,
  lowBattery: 65,
  altitudeLimit: 60,
  disarmed: 55,
  armed: 55,
  rth: 50,
  warning: 45,
  takeoff: 40,
  landed: 40,
  missionComplete: 30,
  gate: 20,
  powerOn: 10,
};

/* Every tune returns its own length, so the scheduler knows when the buzzer is
   free again without a second table to keep in step. */
const TUNES = {
  /* Controller boot: three quick rising ticks. */
  powerOn: (t) => {
    [1900, 2500, 3200].forEach((f, i) => note(f, t + i * 0.055, 0.045, { level: 0.4 }));
    return 0.16;
  },

  /* ARM — two crisp rising beeps, and nothing more. It used to play the pair
     twice, which put nearly half a second of buzzer between the student's click
     and the aircraft moving, and ran straight into the take-off tone. Short is
     what a real controller does, and short is what keeps the two apart. */
  armed: (t) => {
    note(2700, t, 0.055);
    note(3400, t + 0.075, 0.075);
    return 0.16;
  },

  /* DISARM — the mirror image, so the two are told apart by direction alone. */
  disarmed: (t) => {
    note(3400, t, 0.055);
    note(2700, t + 0.075, 0.085);
    return 0.17;
  },

  /* Refused to arm: low, harsh, obviously wrong. A sawtooth through the piezo
     rolloff comes out as a rasp rather than a tone. */
  armingDenied: (t) => {
    [0, 0.1, 0.2].forEach((d) =>
      note(1150, t + d, 0.07, { type: "sawtooth", level: 0.6, detune: 16 })
    );
    return 0.3;
  },

  /* TAKE-OFF — three rising notes, the last one held.
     This is ArduPilot's "ready or finished" tune, MML "MFT100L4>G#6A#6B#4": two
     short steps up and a longer note to settle on. It is the tone a real machine
     plays to say it is good to go, which is precisely what leaving the ground
     means, and the held final note is what stops three quick beeps sounding like
     an error code.

     Transposed up an octave from the literal MML. A 12 mm piezo radiates almost
     nothing at G#5, so the pitches a real board writes down are not the pitches
     it is actually loud at — up here the notes sit in the disc's efficient band.

     It stays clear of the arm tone by rhythm and register: arm is two short high
     beeps, this is three lower ones with a long tail. */
  takeoff: (t) => {
    note(2093, t, 0.075, { level: 0.5 }); // C7
    note(2349, t + 0.095, 0.075, { level: 0.52 }); // D7
    note(2637, t + 0.19, 0.2, { level: 0.55 }); // E7, held
    return 0.42;
  },

  /* LANDED — the same figure walked back down, and softer.
     PX4 plays a descending sequence on power-down for the same reason: rising
     means starting, falling means finishing, and a pilot should not have to think
     about which they just heard. Same rhythm as take-off so the two read as a
     matched pair; opposite direction so they can never be confused. */
  landed: (t) => {
    note(2637, t, 0.075, { level: 0.42 });
    note(2349, t + 0.095, 0.075, { level: 0.4 });
    note(2093, t + 0.19, 0.22, { level: 0.38 });
    return 0.44;
  },

  /* The classic slow triple. Deliberately unhurried: low battery means "come home
     now", not "you are about to crash". */
  lowBattery: (t) => {
    [0, 0.42, 0.84].forEach((d) => note(2900, t + d, 0.13));
    return 1.0;
  },

  /* Height limit: an alternating two-tone, the shape every altitude alert uses. */
  altitudeLimit: (t) => {
    for (let i = 0; i < 3; i++) {
      note(3300, t + i * 0.22, 0.1, { level: 0.6 });
      note(2500, t + i * 0.22 + 0.11, 0.1, { level: 0.6 });
    }
    return 0.68;
  },

  /* Three level beeps: the autopilot has taken it. */
  rth: (t) => {
    [0, 0.13, 0.26].forEach((d) => note(3100, t + d, 0.09));
    return 0.37;
  },

  /* Failsafe: a fast two-tone warble. The one tone in the set built to be
     unpleasant, because it means nobody is flying the aircraft. */
  failsafe: (t) => {
    for (let i = 0; i < 7; i++) {
      note(i % 2 ? 2600 : 3900, t + i * 0.11, 0.1, { level: 0.7, detune: 12 });
    }
    return 0.8;
  },

  /* Something needs attention but the flight continues. */
  warning: (t) => {
    note(2400, t, 0.07);
    note(2400, t + 0.11, 0.07);
    return 0.2;
  },

  /* A bright two-note chime: a mission gate. */
  gate: (t) => {
    note(2600, t, 0.05, { level: 0.4 });
    note(3500, t + 0.055, 0.08, { level: 0.4 });
    return 0.15;
  },

  /* A short rising jingle: mission complete. */
  missionComplete: (t) => {
    [2093, 2637, 3136, 4186].forEach((f, i) => note(f, t + i * 0.1, 0.13, { level: 0.45 }));
    return 0.45;
  },

  /* Lost model. Pitched deliberately AT the disc's resonance, which is where a
     real one is loudest — the whole point of the tone is to be findable by ear
     from the far side of a field. */
  lostModel: (t) => {
    for (let i = 0; i < 8; i++) {
      note(PIEZO_RESONANCE, t + i * 0.3, 0.16, { level: 0.85, detune: 3 });
    }
    return 2.5;
  },
};

/**
 * Play a one-shot alert.
 *
 * Returns true if it sounded, false if it was dropped because something more
 * important was already sounding.
 */
export function play(name) {
  const tune = TUNES[name];
  if (!tune || !enabled || muted) return false;
  const c = ensureContext();
  if (!c) return false;

  const rank = RANK[name] ?? 0;
  const now = c.currentTime;
  if (now < voice.until) {
    if (rank < voice.rank) return false; // outranked: stay quiet rather than layer
    stopVoice();
  }

  voice.rank = rank;
  const t0 = c.currentTime + 0.005;
  const length = tune(t0);
  // A short tail, so the next tone never butts straight onto this one
  voice.until = t0 + length + 0.05;
  return true;
}

/* ================================================================== */
/* PERIODIC ALARMS                                                     */
/* ================================================================== */
/**
 * The repeating alerts: obstacle closure, landing approach, height limit.
 *
 * They work like a car's parking sensor — the same pulse, faster the closer you
 * get, running solid at the point of contact. Everyone already knows how to read
 * that, and a pilot can judge closure rate by ear with their eyes on the aircraft.
 *
 * There are no timers. Each channel remembers when its next pulse is due on the
 * AudioContext's own clock and the flight loop pushes an urgency in every frame;
 * a pulse fires when its due time passes. The alarm therefore cannot drift out of
 * step with the physics, cannot keep sounding after a crash freezes the loop, and
 * costs nothing when nothing is near.
 */

const ALARM_CHANNELS = {
  /* Obstacle: a hard alternating two-tone, the shape aircraft proximity warnings
     use. Distinct from every one-shot tune in the set, which are all single-pitch
     or a smooth sweep. */
  obstacle: {
    rank: 75,
    slowest: 0.55,
    fastest: 0.11,
    fire: (t, level) => {
      const d = level > 0.75 ? 0.06 : 0.07;
      note(3800, t, d, { level: 0.5 + level * 0.35, detune: 11 });
      note(2900, t + d + 0.015, d, { level: 0.5 + level * 0.35, detune: 11 });
      return d * 2 + 0.015;
    },
  },
  /* Landing approach: one low, soft pulse. Information, not a warning — it must
     not sound like the obstacle alert. */
  landing: {
    rank: 25,
    slowest: 0.85,
    fastest: 0.24,
    fire: (t) => {
      note(1600, t, 0.075, { level: 0.34 });
      return 0.075;
    },
  },
  /* Height limit: a high double-tick. Unmistakably "up". */
  ceiling: {
    rank: 60,
    slowest: 0.8,
    fastest: 0.3,
    fire: (t, level) => {
      note(3600, t, 0.055, { level: 0.45 + level * 0.25 });
      note(3600, t + 0.08, 0.055, { level: 0.45 + level * 0.25 });
      return 0.135;
    },
  },
};

const alarmState = {};

/**
 * Drive one repeating alarm.
 *
 * `urgency` runs 0 (clear — silent) to 1 (imminent). Call it every frame; call it
 * with 0 the moment the hazard is behind you and the alarm stops there.
 */
export function setAlarm(channel, urgency) {
  const spec = ALARM_CHANNELS[channel];
  if (!spec) return;
  const st = (alarmState[channel] = alarmState[channel] || { nextAt: 0 });

  const level = Math.max(0, Math.min(1, urgency || 0));
  if (level <= 0.001 || !enabled || muted) {
    // Re-arm, so the next approach sounds at once instead of waiting out a stale
    // interval left over from the last one.
    st.nextAt = 0;
    return;
  }

  const c = ensureContext();
  if (!c) return;
  const now = c.currentTime;
  if (st.nextAt && now < st.nextAt) return;

  /* Never talk over a one-shot alert. Without this the alarms sounded underneath
     the arm and take-off tones, which is most of what made the audio feel
     cluttered — two sources on a device that physically has one. */
  if (now < voice.until) {
    if (spec.rank < voice.rank) return;
    stopVoice();
  }

  const t0 = now + 0.004;
  const length = spec.fire(t0, level);
  voice.rank = spec.rank;
  voice.until = t0 + length + 0.02;

  st.nextAt = now + spec.slowest + (spec.fastest - spec.slowest) * level;
}

/** Silence every repeating alarm — on landing, on reset, on leaving flight mode. */
export function clearAlarms() {
  for (const k of Object.keys(alarmState)) alarmState[k].nextAt = 0;
}

export const BUZZER_TUNE_NAMES = Object.keys(TUNES);
