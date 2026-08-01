# DroneLab — Drone Engineering Simulator

A classroom simulator for teaching how a multirotor is built and why it flies (or
doesn't). Students assemble a **quadcopter** part by part,
wire the loom, run the pre-flight checks, then fly it — and every component's
behaviour is driven by the decision logic from the course notes.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

---

## What makes this different from an animation

Nothing about the failure behaviour is scripted. The simulator runs a real
control loop:

```
receiver sticks -> flight controller (attitude PID) -> motor mixing algorithm
     -> per-motor throttle -> ESC -> motor RPM -> propeller thrust + reaction torque
     -> rigid-body forces and torques -> motion
```

Because the torques are computed from the **actual thrust each propeller makes**,
the consequences emerge on their own:

- fit a propeller backwards and that corner produces *negative* thrust, so the
  aircraft really does flip on takeoff;
- kill one motor on a quadcopter and the three survivors genuinely cannot cancel
  the leftover yaw torque, so it spins up and crashes;
- and the same analysis, run on a six- or eight-rotor mixer, shows why those
  airframes survive it — the maths is general even though the course builds a quad.

The simulator's independently-computed verdict is displayed next to the failure
table from the course notes. **They agree on all eight cases** — which is the point:
the theory the students are taught is confirmed by the physics they are watching.

| Case | Mixer analysis (computed) | Course notes (taught) |
|---|---|---|
| Quad, 1 motor | rank 3/4, **yaw uncommandable** | Uncontrollable roll/yaw, rapid spin, crash in 2–5 s |
| Quad, 2 motors | rank 2/4, roll + yaw lost | No stabilization possible, immediate crash |
| Hexa, 1 motor | rank 4/4, load spread 1.25x | Recalculate mixing, reduced stability, land soon |
| Hexa, 2 adjacent | rank 4/4 but **saturated** | Severe instability, crash likely |
| Hexa, 2 opposite | rank 3/4, **yaw uncommandable** | Limited recovery, forced landing |
| Octo, 1 motor | rank 4/4, spread 1.31x | Automatic redistribution, stable flight |
| Octo, 2 motors | rank 4/4, spread 1.74x lopsided | Degraded performance, reduced payload |
| Octo, 3 motors | rank 4/4, **saturated** | Severe instability, emergency landing |
| Octo, 4+ motors | heavily saturated | Crash |

The quad rows are what the simulator flies. The hexa and octo rows are the same
code run against six- and eight-rotor mixers — kept because they show the analysis
is general, not hand-tuned for one airframe.

---

## The three modules

Each module reproduces the objective, component list, task chain and failure
simulations from the course notes. Tasks tick themselves only when the student
genuinely satisfies them — never on a button press.

| # | Module | Objective | Adds |
|---|---|---|---|
| 1 | Basic Drone Build | Build your first drone and make it hover | Frame, battery, FC, ESC x4, motor x4, prop x4 |
| 2 | Controlled Flight | Control the drone using a transmitter | Transmitter, receiver, GPS |
| 3 | Complete Electronics | Build and configure a complete drone | PDB, IMU, compass, barometer, buzzer |

Module 3 is the final module. Every module builds a quadcopter. Module 1 has no
radio yet, so it runs as a **bench hover test** — this is stated explicitly in the
pre-flight panel rather than quietly faked.

---

## The 13 decision trees

Every diagram from sections 1–13 of the notes is encoded so it can do two jobs at
once: be **drawn** as the flowchart students study, and be **walked at runtime**
against live simulator state, lighting up the exact branch the aircraft is taking.

Battery · PDB · Flight Controller · ESC · Motor · Propeller · GPS · Transmitter ·
Receiver · IMU · Compass · Barometer, plus the **Complete Flight Logic** block
diagram which tints each stage by its live health.

When a student cannot arm, they open the Flight Controller tree and see precisely
which question answered "no". That is the whole teaching loop.

ESC, motor and propeller trees are **per-motor** — tabs let you inspect M1…M8
individually, which is how you find the one backwards motor on the aircraft.


---

## Wiring: drag the wire, not a checkbox

Wiring is done in a dialog, pin to pin. The student picks a wire colour from the
legend, then drags from a pin on one component onto a pin on another. A connection
is accepted only when **both the pin pair and the wire colour are right** — because
on a real drone, putting the red wire where the black one belongs is not a near miss.

Wrong attempts explain themselves rather than just going red:

- *Wrong colour* — "Right pins, wrong wire. You picked Black (Ground) but this is a
  Red wire — + (Positive / Power)."
- *Wrong pin* — "GPS Module TX does not go to Flight Controller TX. It belongs on
  Flight Controller RX. TX talks, RX listens — wire TX to TX and both ends shout
  while neither hears a thing."

Each component is shown as a **technical illustration with its pins on the edge
facing the other card**, so a wire leaves the pin and heads straight across the
gap the way it does on a bench.

**Every wire gets its own vertical lane**, so no two ever overlap. A bundle of
curves sweeping through the same space cannot be traced by eye, which defeats the
point of drawing them. Wires are drawn with a dark casing under the coloured core
so crossings stay readable and a red wire does not vanish against another red one
behind it. Hover a wire to highlight it; click it to pull it out.

Pin ORDER is deliberate, not just the pairing. The flight controller's GPS port
is listed `VCC / TX / RX / GND` because that is the real Pixhawk order — listing
RX second so it lined up with the GPS's TX would have drawn the two serial wires
as straight parallel lines and hidden the crossover, which is the one thing that
harness exists to teach.

### Using photographs instead

The illustrations are drawn rather than sourced, because stock product photos are
copyrighted and this gets handed to a class. To use pictures of **your own kit** —
which beats any stock image, since it is the hardware the students will actually
hold — give a card a `photo` in `src/data/wiring.js`:

```js
card("esc", "esc", "ESC 1", "30A BLHeli_S", [...])   // add: photo: "/img/my-esc.jpg"
```

Anything passed that way replaces the drawing.

The loom is grouped into harnesses, and scales with the airframe:

| Harness | Wires |
|---|---|
| Battery to PDB | 2 |
| PDB to ESCs | 8 |
| PDB BEC to FC | 2 |
| FC MAIN OUT to ESC signals | 4 |
| ESCs to motors (3-phase) | 4 |
| Receiver to FC (SBUS) | 3 |
| GPS to FC *(optional)* | 4 |
| Buzzer to FC *(optional)* | 2 |
| **Required total** | **23** |

### Two corrections to the reference diagram

The supplied connection notes flag two genuine labelling errors in the source
image, and the simulator teaches the **correct** wiring rather than reproducing the
mistake. Each is explained in the dialog itself, so students see the discrepancy
rather than being quietly steered around it:

1. **GPS port.** The image shows GPS TX landing on a pin marked "5V", GPS RX on
   "GND" and GPS GND on "RX". A real Pixhawk GPS port is VCC / TX / RX / GND, and a
   serial link crosses over: **GPS TX to FC RX, GPS RX to FC TX**.
2. **TELEM port.** The image labels one row "TX" twice — the row carrying the red
   wire should read "5V" — and its wire colours contradict its own legend. We follow
   the legend: green TX, blue RX.

There is still an "auto-wire everything" button for teachers who want to skip ahead.

### The buzzer

Module 3 adds a piezo buzzer, and it is not a decoration — it is wired to real
audio, synthesised with the Web Audio API. It only makes a sound once the buzzer
is **placed on the airframe and wired to the FC**, exactly like a real one. Skip
it and the aircraft is completely silent: arming, pre-arm failures and the crash
alarm all happen without a sound, which is the honest behaviour of a drone
nobody fitted a buzzer to.

**Why it is synthesised rather than recorded.** No sound files ship here, so
there is nothing to license, nothing to download, and no second copy of the tones
to keep in step with the code. The realism has to come from modelling the device
instead — which is what the synth does.

**Modelling a piezo.** An FC buzzer is a piezoelectric disc and it sounds nothing
like a raw oscillator. Three properties do almost all the work:

1. It has **no low end at all**. The disc is tiny and stiff, so nothing below
   about a kilohertz is radiated. A square wave sent straight to the speakers
   keeps that energy and comes out fat and synthetic.
2. It has a sharp mechanical **resonance** near 4 kHz, and any tone whose
   harmonics land on it gets a hard nasal honk. That honk is most of what makes a
   buzzer sound like a buzzer.
3. It starts and stops almost instantly, with a mechanical tick on the attack.

So every note is a pair of slightly detuned square oscillators (real discs beat a
little) through a high-pass that removes the body, into a peaking filter at the
resonance, into a limiter. Measured on the rendered output, that chain leaves
roughly a thousandth of the energy below 800 Hz that it leaves at the
fundamentals — the thin, piercing quality is measured, not asserted.

**One voice at a time.** A real buzzer cannot play two things at once and neither
can this one. Tones are ranked the way a cockpit ranks alerts — losing the
aircraft outranks pilot actions, which outrank information — and a higher-ranked
alert cuts off whatever is sounding while a lower-ranked one is dropped rather
than layered underneath. That is what stops arm and take-off talking over each
other, and it applies to the repeating alarms too.

**No pitch sweeps.** Real flight controllers describe their tones in MML — the
QBasic `PLAY` notation — and MML has no way to express a glide: it is notes,
octaves and durations. ArduPilot's entire tone library is stepped notes, from the
startup arpeggio (`MFT240L8O4aO5dcO4aO5dc...`) to the "ready" tune
(`MFT100L4>G#6A#6B#4`) to the lost-model alarm. A portamento is a synthesiser
gesture, not a buzzer one, and an early version of the take-off tone used one —
which is exactly why it sounded wrong.

So take-off is now that real "ready" figure: two short steps up and a longer note
to settle on, the tone a real machine plays to say it is good to go. Landing is
the same figure walked back down, which is what PX4 plays on power-down. Rising
means starting, falling means finishing, and a pilot should not have to think
about which they just heard.

Both are transposed up an octave from the literal MML, because a 12 mm piezo
radiates almost nothing at G#5 — the pitches a real board writes down are not the
pitches it is actually loud at.

Arm and take-off stay apart by rhythm and register rather than direction: arm is
two short high beeps, take-off is three lower ones with a long tail.

| Event | Tone |
|---|---|
| Armed | two crisp rising beeps |
| Disarmed | the mirror image, two falling |
| Arming denied | three low sawtooth rasps — a pre-arm check failed |
| Power on | three rising ticks |
| Take-off | three rising notes, last one held — ArduPilot's "ready" tune |
| Landed | the same figure walked back down, softer |
| Obstacle ahead | hard alternating two-tone, faster the closer you get |
| Landing approach | slow low pulse while settling in, speeding up as the ground comes up |
| Above the height limit | high double-tick, repeating |
| Low battery | slow triple beep |
| RTH engaged | three level beeps |
| Failsafe | fast two-tone warble |
| Mission gate | bright two-note chime |
| Mission complete | four-note rising jingle |
| Crash | the lost-model alarm, pitched **at** the disc's resonance where a real one is loudest |

A speaker icon in the top bar mutes it. It is disabled with an explanatory
tooltip until a buzzer is actually wired in, and the pre-flight checklist reports
its status the same way it reports GPS: informational, never blocking arming,
because a real drone flies fine without one.

### The height limit

120 m is the ceiling almost every civil aviation authority sets for an uncrewed
aircraft — the UK CAA, EASA and the FAA all land on 120 m or its imperial twin,
400 ft. Nothing here enforces it: the aircraft keeps climbing, because a
simulator that silently refused would teach that the limit is the airframe's
rather than the law's. The buzzer starts calling at 100 m and runs at full rate
above 120, and the HUD says which limit you are over.

### Things you can hit

The scenery used to be decoration the physics knew nothing about, so a drone flew
straight through a tower block. Every solid object now publishes an analytic
collider — an upright cylinder or a box — alongside its mesh, and the simulator
asks one question per frame: how far is the nearest thing I could hit?

Hitting it ends the flight, with a crash report naming what was hit and how fast.

A few details that matter more than they look:

- **Trees get two colliders, not one.** A single canopy-width cylinder would make
  it impossible to fly between the trunks under the canopy — which is exactly the
  shot a confident student goes looking for, and it is legitimately flyable. The
  trunk is slim, the canopy is wide, and the gap between them is real.
- **The crane jib sweeps**, so it cannot be bucketed with the static scenery. It is
  a chain of colliders the animation loop moves under the drawn arm each frame,
  spaced closer than twice their radius so the arm is genuinely solid along its
  length rather than a row of posts with gaps between them.
- **Buildings collide at their drawn rotation.** A 24x14 block turned 90 degrees is
  a different obstacle, and getting that wrong would let a drone clip a corner
  that looks solid on screen.
- The distance is measured to the **propeller disc**, not the centre of mass,
  because the propeller tips hit things first and end the flight when they do.

**The alarm asks the right question.** A pure distance trigger is unusable in
these fields: a forest has a tree every few metres and a city street has walls on
both sides, so "something is within 14 m" is true permanently, and an alarm that
is always on carries no information. Closure rate alone is not enough either —
flying *past* a building five metres to one side shrinks the gap all the way to
the corner, and a closure alarm shouts the whole way along a wall you were never
going to touch.

So the alarm asks what a pilot asks: *if I hold this course, do I hit something,
and how soon?* That is answered by marching the aircraft's own velocity vector
forward through the collider field — sphere tracing, where the distance to the
nearest surface is itself a safe step, so it cannot tunnel through something thin
the way fixed-interval sampling would miss a street light at cruise speed. A
second trigger covers anything inside 2.2 m regardless of heading, because at
that range a gust will close it for you.

Measured behaviour:

| Situation | Alarm |
|---|---|
| Hovering 4 m from a tree | silent |
| 200 m down a city street at 14 m | silent |
| 200 m over the forest canopy | silent |
| Flying straight at a building at 8 m/s | calls it 2.4 s out, then crashes |
| Threading the canopy at 12 m | calls only the trunks actually ahead |

The forward look runs at about 25 Hz rather than on all 240 physics steps a
second, because no human can hear the difference and it is forty times the work.

The gate course is verified clear in both fields — over 40 random layouts per
field the tightest clearance anywhere along it is 5.8 m.

### Disarming in flight

On the ground, disarming is the normal end of a flight. In the air it is not a
control input at all: it is switching the aircraft off mid-hover, and every
multirotor does exactly one thing after that. There is no soft version of it and
no recovery, so the simulator says so immediately rather than letting a student
watch a silent fall and wonder whether they can still save it. The DISARM button
warns in its tooltip while airborne.

### Making the fields look like places

Two changes did most of the work, and neither was more geometry.

**The sky.** A flat background colour is the single biggest thing that reads as a
3D model rather than as outside. Real sky is never one colour — pale and warm at
the horizon where you are looking through a hundred kilometres of atmosphere,
deep at the zenith where you are looking through five. Both fields now sit under a
gradient dome with a visible sun and a drifting cloud deck. The gradient is
useful, not just pretty: it tells a pilot where the horizon is when the aircraft
is a speck.

The dome re-centres on the camera every frame (you cannot fly closer to the sky)
while the clouds stay anchored in the world at an altitude a drone can climb
through — a cloud that followed the camera could never be passed or looked down
on. The key light is aimed along the sun the sky actually draws, so shadows fall
the way the visible sun says they should.

**Shared materials.** `mat()` used to mint a new material per call, leaving the
forest with 780 meshes and **780 distinct materials**. Triangles were never the
problem — 34k is nothing — but every unique material is its own shader binding.
Caching by value collapsed that to 33, and that saving is what paid for
everything else: painted ground textures, wind sway on every tree, a forest floor
of logs and boulders and ferns, kerbs and zebra crossings, rooftop tanks and air
handling, parked cars, traffic lights, and distant treelines and skylines so
neither world ends in mid-air.

Everything with a high count is instanced. The net result:

| | before | after |
|---|---|---|
| Forest draw calls | 780 | 773 (+437 instanced objects) |
| Forest materials | 780 | **33** |
| City draw calls | 1159 | 1219 (+1805 instanced objects) |
| City materials | 578 | **133** |

After frustum culling a flight frame issues 86-198 draw calls.

### Two flight fields

The student picks where to fly from the **Field** tab, and the choice is a real
difficulty setting rather than a skin.

| Field | What is in it | Why it is harder or easier |
|---|---|---|
| **Forest** | Broadleaf and conifer canopy, a river, a lake, deer, birds, rocks and long grass | Open lanes between the trunks. Height is easy to judge against a tree, and the ground is flat. This is where a first solo should happen. |
| **City** | Tower blocks, a lattice cell tower, a crane and a building under construction, moving traffic, a park with a bandstand, and people on the pavements | Vertical walls on both sides, a crane arm that swings through the course, and far less room to recover from a bad input. |

All the open water is in the forest — the river and a lake off to the west. Still
water is the best altitude reference a field can have: it is perfectly flat, and
the shoreline is a hard edge to hold a hover against. In the middle of a city
block it was scenery nobody had a reason to fly over, so the city's park has a
bandstand where its pond used to be — small, hard, and right where a student
practising a slow circuit will be looking.

Both fields are laid out around the same mission gates, and the scenery generator
keeps a clearance corridor along the whole course — trees and buildings are placed
with their canopy or footprint taken into account, so nothing ever grows through a
gate you are supposed to fly through.

Swapping fields rebuilds the scenery, so it is disabled while the aircraft is
airborne.

### Light and dark

A switch in the top bar, next to the mute button. The default follows the
operating system, and an explicit choice is remembered.

The two palettes are not inversions of each other. Text flips dark-on-light, but
the accent hues are re-picked: `--cyan` at `#46e6cf` is bright and legible on
near-black and disappears completely on white, so the light theme uses a deeper,
more saturated teal at roughly the same hue. Every colour in the interface reads
from a CSS variable — including the alpha tints, which use `rgba(var(--cyan-rgb), .14)`
so they follow the theme too — and both palettes are checked to WCAG AA contrast
for every piece of text the interface renders.

The **assembly bay** follows the theme, because a floodlit blue workshop next to a
dark interface is jarring. The **flight fields deliberately do not**: they are
daylight scenes, and judging your height against a building or a treeline depends
on them being lit like daytime.

---

## Physics model

Calibrated against real bench data for a 450-class airframe (920 KV motor,
10x4.5 propeller, 3S 4200 mAh pack), so the numbers are ones a student could
measure themselves:

| Quantity | Model | Result |
|---|---|---|
| Air density | ISA barometric + ideal gas | 100% at sea level, 86% at 1000 m, 59% at 4000 m |
| Thrust | `T = Ct·rho·n²·D⁴` | 824 g per motor at full throttle |
| Power | `P = Cp·rho·n³·D⁵` | ~37 W per motor in the hover |
| Hover | `sqrt(weight / max thrust)` | 55% throttle, 15.4 A, thrust-to-weight 3.3 |
| Endurance | coulomb counting + temperature derate | 13.1 min at 25 °C, 11.8 min at −10 °C |
| Battery | OCV curve + `V = OCV − I·R`, R rises when cold | 12.6 V full, 11.1 V nominal, 10.5 V cutoff |
| ESC thermal | 5% of throughput as heat, airspeed cooling | ~50 °C hover, 90 °C limit per the ESC tree |
| Wind | `F = ½·rho·v²·Cd·A`, drone leans to hold | lean angle and drift both shown live |

These models still run the aircraft even though the environment sliders were
removed with Modules 4 and 5 — the simulator flies at standard conditions
(no wind, 25 degC, sea level). Re-exposing the controls is a one-component change
if you want that lesson back.

---

## Optional: Supabase on Dokploy

The simulator works with no backend at all. Supabase adds accounts, saved
builds and a teacher dashboard — and if it is not configured, **every one of
those features switches off silently and nothing else changes**. No part of the
simulator is locked behind an account.

### 1. Deploy Supabase

Dokploy → **Templates → Supabase** (needs Dokploy ≥ 0.22.5). It brings up
Postgres, Kong, GoTrue, PostgREST, Realtime, Storage and Studio.

Generate the secrets first:

```bash
node supabase/generate-keys.mjs
```

`ANON_KEY` and `SERVICE_ROLE_KEY` are **HS256 JWTs signed with `JWT_SECRET`**, not
random strings. If they are not signed with the same secret the stack is given,
every API call returns 401 and nothing tells you why. The script emits a matching
set, plus the exact-length fields (`VAULT_ENC_KEY` 32, `REALTIME_DB_ENC_KEY` 16,
`SECRET_KEY_BASE` 64) that the stack refuses to start without.

Set these yourself — the template does not generate them all:

| Variable | Note |
|---|---|
| `JWT_SECRET` | Sign `ANON_KEY` and `SERVICE_ROLE_KEY` **with this secret**; they are JWTs, not random strings |
| `ANON_KEY` / `SERVICE_ROLE_KEY` | roles `anon` and `service_role` respectively |
| `POSTGRES_PASSWORD` | |
| `SECRET_KEY_BASE` | 64 random chars |
| `VAULT_ENC_KEY` | 32 random chars |
| `LOGFLARE_API_KEY` | the stack will not come up healthy without it |
| `DOCKER_SOCKET_LOCATION` | `/var/run/docker.sock` |
| `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL` | must match the domain you expose, with the right scheme |
| `SITE_URL`, `ADDITIONAL_REDIRECT_URLS` | GoTrue validates these before sending auth emails |
| `SMTP_*` | needed for confirmation and password-reset emails |

Point a domain at the **Kong** service on port **8000** — that is the single API
entry point. Give Studio its own domain. Do not change `CONTAINER_PREFIX` after
deploying; it is referenced by the Vector logging config.

### 2. Create the schema

Studio → SQL Editor → run [`supabase/schema.sql`](supabase/schema.sql). It creates
the tables **and their Row Level Security policies**. Do not skip it: self-hosted
Supabase creates tables with RLS *off*, which would make the public anon key a
full read/write credential to your students' data.

Then make yourself a teacher (the statement is at the bottom of that file). It
has to be done in Studio — the app deliberately cannot grant it, or any student
could promote themselves.

### 3. Check the connection before touching the app

```bash
# .env.local in the project root:
#   VITE_SUPABASE_URL=https://<kong-domain>
#   VITE_SUPABASE_ANON_KEY=<anon key>
npm run supabase:check
```

Works through every failure mode that produces a silent or misleading symptom in
the browser: key not signed with the deployed `JWT_SECRET`, the Studio domain
used instead of Kong, `schema.sql` never run, or RLS left off. Nothing it does
writes to the database.

### 4. Deploy DroneLab

Build type **Dockerfile**, domain port **80**. Then set, under
**Advanced → Build Time Arguments** — *not* Environment:

```
VITE_SUPABASE_URL=https://<your-kong-domain>
VITE_SUPABASE_ANON_KEY=<your anon key>
```

**This is the step that catches people out.** Vite substitutes
`import.meta.env.VITE_*` while `vite build` runs and then discards the
environment, so the values are compiled into the bundle. Runtime environment
variables reach a container that was built long ago and have no effect — the
only symptom is that nothing ever saves. The Dockerfile fails the build if the
URL is set without the key, rather than shipping a half-configured bundle.

### Things that will bite you

- **Plain HTTP breaks it outright.** If DroneLab is served over HTTPS and
  Supabase over HTTP, the browser blocks every request as mixed content. Over
  HTTP the auth tokens and Studio's basic-auth password also travel in the
  clear. Use a domain with Dokploy's Let's Encrypt. The app logs an explicit
  console error if it detects this mismatch.
- **`SERVICE_ROLE_KEY` must never appear in the frontend.** It bypasses RLS
  entirely. It is not referenced anywhere in `src/`.
- **Email confirmation is on by default.** Either configure SMTP or turn
  confirmation off in Auth settings, or new accounts cannot sign in.

### What gets stored

| Table | Contents |
|---|---|
| `profiles` | display name, class code |
| `user_roles` | `student` or `teacher` — no client write policy at all, by design |
| `module_progress` | per-module tasks done, completion, current task |
| `builds` | the current aircraft as JSON, so a student resumes on any machine |
| `class_roster` (view) | the teacher dashboard, `security_invoker` on so a student sees only themselves |

Saves are debounced (1.5 s for builds, 1.2 s for progress) — assembling a drone
fires dozens of state changes a minute and each one is not worth a round trip.

---

## Project layout

```
src/
  data/
    airframes.js     airframe geometry, motor order & direction, failure model
    parts.js         bill of materials with the real specs from the parts chart
    logicTrees.js    the 13 decision trees + the Complete Flight Logic diagram
    wiring.js        pin-level connections + harness grouping, generalised to N motors
    curriculum.js    the 3 modules: objectives, task chains, failure simulations
  sim/
    mixer.js         motor mixing algorithm + control-authority analysis
    physics.js       atmosphere, propeller, battery, ESC thermal models
    flightSim.js     the rigid-body flight loop
    diagnostics.js   walks every tree against live state, builds the pre-flight report
    progress.js      evaluates curriculum tasks against the real build state
  three/
    materials.js     procedural textures and the shared material set
    partMeshes.js    one mesh builder per component
    droneScene.js    assembly bay, slot system, drag & drop, flight field
  components/
    WiringDialog.jsx the drag-a-wire-between-pins interface
    ...              the rest of the React workbench UI
```

---

## Controls

**Assembly** — drag from the parts tray onto the glowing ring (it turns green when
you are close enough to drop). Left-drag the background to orbit, wheel to zoom.

**Flight** — `W`/`S` forward and back, **`A`/`D` (or the left/right arrows) turn
left and right**, `Q`/`E` slide sideways, `Space` climb, **`Z` descend**.
`ARM` and `RTH` are in the top bar.

Descend is `Z` and not `Shift` on purpose: Windows pops its **Sticky Keys**
prompt after five Shift presses, which a student reaches in seconds while
trying to come down. Worse, that dialog steals focus, so the browser never
delivers the `keyup` and the control stays jammed on. Losing focus for any
reason — an OS dialog, alt-tab, a notification — now releases every key, the
same way a real failsafe reacts to losing the transmitter.

**Undo / redo** — `Ctrl+Z` and `Ctrl+Y` (or `Ctrl+Shift+Z`), or the arrows in the
top bar. History covers the build only: parts, wiring, calibrations and injected
faults. It deliberately does not rewind the camera, the open panel or the flight
itself. Stripping the build asks for confirmation and clears the history with it.

### Which way is "right"?

The nose is `+Z` and up is `+Y`, and the chase camera sits *behind* the aircraft
looking along `+Z`. In a right-handed system a camera facing `+Z` has screen-right
at **`-X`**, not `+X`. So a positive yaw angle swings the nose toward `+X`, which
the pilot sees as a turn to the **left**. Every control sign in `readSticks()`,
every motor position in `buildSlots()` and the propeller spin direction all follow
from that one fact — get it wrong and A/D feel swapped.

---

## Teaching with it

The **Failures** panel on the right is the most useful control in the room. Pick a
fault, inject it, and send students to the logic trees to find it — the affected
tree is already showing the failing branch. "Inject random fault" does it blind, so
the class has to diagnose from symptoms alone.

Suggested exercise: kill one motor on the quad and ask the class to predict what
happens before you fly it. The Health panel shows the mixer rank dropping to 3/4
with yaw uncommandable — and the aircraft then does exactly that in the air.
