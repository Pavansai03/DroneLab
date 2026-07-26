# DroneLab — Drone Engineering Simulator

A classroom simulator for teaching how a multirotor is built and why it flies (or
doesn't). Students assemble a **quadcopter, hexacopter or octocopter** part by part,
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
- do the same to a hexacopter and the mixer really can redistribute, so it flies on.

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

---

## The five modules

Each module reproduces the objective, component list, task chain and failure
simulations from the course notes. Tasks tick themselves only when the student
genuinely satisfies them — never on a button press.

| # | Module | Objective | Adds |
|---|---|---|---|
| 1 | Basic Drone Build | Build your first drone and make it hover | Frame, battery, FC, ESC x4, motor x4, prop x4 |
| 2 | Controlled Flight | Control the drone using a transmitter | Transmitter, receiver, GPS |
| 3 | Complete Electronics | Build and configure a complete drone | PDB, IMU, compass, barometer — **airframe choice unlocks here** |
| 4 | Flight Physics & Environment | Understand how conditions affect flight | Wind, payload, temperature, altitude controls |
| 5 | Complete Engineering Simulator | Build, test, troubleshoot, fly missions | Random failure injection, diagnose, repair, crash report |

Modules 1 and 2 are locked to a quadcopter, as the notes specify. Module 1 has no
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
individually, which is how you find the one backwards motor on an octocopter.

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

Module 4's sliders feed straight into this — change the temperature and the
predicted flight time moves, because the same code runs the aircraft.

---

## Project layout

```
src/
  data/
    airframes.js     quad/hexa/octo geometry, motor order & direction, failure model
    parts.js         bill of materials with the real specs from the parts chart
    logicTrees.js    the 13 decision trees + the Complete Flight Logic diagram
    wiring.js        every connection from the wiring diagram, generalised to N motors
    curriculum.js    the 5 modules: objectives, task chains, failure simulations
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
  components/        the React workbench UI
```

---

## Controls

**Assembly** — drag from the parts tray onto the glowing ring (it turns green when
you are close enough to drop). Left-drag the background to orbit, wheel to zoom.

**Flight** — `W`/`S` forward and back, `A`/`D` yaw, `Q`/`E` roll left and right,
`Space` climb, `Shift` descend. `ARM` and `RTH` are in the top bar.

---

## Teaching with it

The **Failures** panel on the right is the most useful control in the room. Pick a
fault, inject it, and send students to the logic trees to find it — the affected
tree is already showing the failing branch. "Inject random fault" does it blind,
which is what Module 5 is built around.

Suggested comparison for Module 3 onward: build the same mission on a quad, then a
hexa, then an octo, and kill one motor on each. The Health panel will show three
different verdicts for the same fault, and the students can explain why from the
mixer rank alone.
