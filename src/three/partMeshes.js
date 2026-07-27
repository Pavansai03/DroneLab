/**
 * PART MESHES
 * ===========
 * One builder per component in the bill of materials. Each returns a THREE.Group
 * whose origin sits where the part logically attaches, so the assembly code can
 * simply drop it at a slot position.
 *
 * Geometry is deliberately recognisable rather than photoreal — a student should
 * be able to point at the screen and say "that's the ESC" without a label.
 */

import * as THREE from "three";

const deg = (d) => (d * Math.PI) / 180;

/* ---------------------------------------------------------------- FRAME */

/** Centre plate. `sides` follows the motor count so a hexa gets a hex plate. */
export function buildHubPlate(mats, frame) {
  const g = new THREE.Group();
  g.name = "hub";
  const R = frame.motorCount >= 8 ? 0.5 : frame.motorCount >= 6 ? 0.46 : 0.42;
  const sides = Math.max(6, frame.motorCount);

  const bottom = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, 0.05, sides),
    mats.carbon
  );
  bottom.rotation.y = Math.PI / sides;
  bottom.castShadow = bottom.receiveShadow = true;
  g.add(bottom);

  frame.armAngles.forEach((a) => {
    const nub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10),
      mats.gunmetal
    );
    nub.position.set(Math.cos(deg(a)) * R * 0.85, 0.04, Math.sin(deg(a)) * R * 0.85);
    g.add(nub);
  });

  g.userData.plateRadius = R;
  return g;
}

/** One arm, laid along +X, to be rotated into place. */
export function buildArm(mats, frame) {
  const g = new THREE.Group();
  g.name = "arm";
  const inner = (frame.motorCount >= 6 ? 0.46 : 0.42) * 0.75;
  const tip = frame.tipRadius;
  const len = tip - inner;

  const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.14), mats.carbon);
  arm.position.x = inner + len / 2;
  arm.castShadow = arm.receiveShadow = true;
  g.add(arm);

  const mount = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.05, 16),
    mats.gunmetal
  );
  mount.position.set(tip, 0.06, 0);
  mount.castShadow = true;
  g.add(mount);

  const leg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.028, 0.34, 8),
    mats.darkPlastic
  );
  leg.position.set(tip * 0.86, -0.17, 0);
  leg.castShadow = true;
  g.add(leg);

  const foot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mats.darkPlastic);
  foot.position.set(tip * 0.86, -0.33, 0);
  g.add(foot);

  for (let i = -1; i <= 1; i += 2) {
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.03, 8),
      mats.gunmetal
    );
    bolt.position.set(inner + 0.05, 0.06, i * 0.05);
    g.add(bolt);
  }
  return g;
}

export function buildTopPlate(mats, frame) {
  const g = new THREE.Group();
  g.name = "topplate";
  const R = (frame.motorCount >= 8 ? 0.5 : frame.motorCount >= 6 ? 0.46 : 0.42) * 1.05;
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, 0.035, Math.max(6, frame.motorCount)),
    mats.carbon
  );
  plate.rotation.y = Math.PI / Math.max(6, frame.motorCount);
  plate.castShadow = plate.receiveShadow = true;
  g.add(plate);
  return g;
}

/* ---------------------------------------------------------------- POWER */

export function buildBattery(mats, labelTex) {
  const g = new THREE.Group();
  g.name = "battery";
  const body = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.45, metalness: 0.05 });
  const side = new THREE.MeshStandardMaterial({ color: 0x1c2530, roughness: 0.5, metalness: 0.05 });
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.2, 0.82),
    [side, side, side, side, body, side]
  );
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh);

  const conn = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.06, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xffd23b, roughness: 0.5 })
  );
  conn.position.set(0, 0, 0.44);
  g.add(conn);

  [-1, 1].forEach((s) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 0.05, 0.02, 0.41),
      new THREE.Vector3(s * 0.08, 0.06, 0.5),
      new THREE.Vector3(s * 0.05, 0.09, 0.58),
    ]);
    const wire = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 10, 0.012, 6, false),
      new THREE.MeshStandardMaterial({ color: s > 0 ? 0xe5484d : 0x101010, roughness: 0.6 })
    );
    g.add(wire);
  });
  return g;
}

export function buildPdb(mats, frame) {
  const g = new THREE.Group();
  g.name = "pdb";
  const board = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.03, 8),
    mats.pcb
  );
  board.rotation.y = Math.PI / 8;
  board.castShadow = board.receiveShadow = true;
  g.add(board);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.09, 14),
    mats.gold
  );
  cap.position.set(0, 0.06, 0.05);
  g.add(cap);

  const xt60 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.06), mats.darkPlastic);
  xt60.position.set(0, 0.04, -0.24);
  g.add(xt60);

  // One solder pad per motor — visually reinforces "one output per ESC"
  const n = frame?.motorCount || 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.008, 8),
      mats.gunmetal
    );
    pad.position.set(Math.cos(a) * 0.2, 0.019, Math.sin(a) * 0.2);
    g.add(pad);
  }
  return g;
}

export function buildEsc(mats) {
  const g = new THREE.Group();
  g.name = "esc";
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.26), mats.escBoard);
  board.castShadow = true;
  g.add(board);

  const shrink = new THREE.Mesh(
    new THREE.BoxGeometry(0.165, 0.028, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.75 })
  );
  shrink.position.y = 0.004;
  g.add(shrink);

  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.05), mats.darkPlastic);
  chip.position.y = 0.022;
  g.add(chip);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.055, 10), mats.gold);
  cap.position.set(0.05, 0.035, -0.07);
  g.add(cap);

  [0xe5484d, 0x101010, 0xffd23b].forEach((col, i) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.012, 0.13 + 0.01 * i),
      new THREE.Vector3(0.03, 0.02, 0.2 + 0.01 * i),
      new THREE.Vector3(0.05, 0.02, 0.29 + 0.01 * i),
    ]);
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 8, 0.008, 6, false),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 })
      )
    );
  });

  // Heat indicator — recoloured live by the scene when the ESC gets hot
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x46e6cf })
  );
  led.position.set(-0.05, 0.03, -0.09);
  led.name = "escHeatLed";
  g.add(led);
  g.userData.led = led;

  return g;
}

/* ----------------------------------------------------------- PROPULSION */

export function buildMotor(mats) {
  const g = new THREE.Group();
  g.name = "motor";

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.155, 0.17, 0.09, 20),
    mats.darkPlastic
  );
  base.position.y = 0.045;
  base.castShadow = true;
  g.add(base);

  const bell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.16, 20),
    mats.gunmetal
  );
  bell.position.y = 0.17;
  bell.castShadow = true;
  bell.name = "bell";
  g.add(bell);
  g.userData.bell = bell;

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.06, 8),
    mats.gunmetal
  );
  shaft.position.y = 0.27;
  g.add(shaft);

  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.035), mats.copper);
    tooth.position.set(Math.cos(a) * 0.08, 0.09, Math.sin(a) * 0.08);
    tooth.rotation.y = -a;
    g.add(tooth);
  }

  [0xe5484d, 0x101010, 0xffd23b].forEach((col, i) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.05, 0.06, 0.04 * (i - 1)),
      new THREE.Vector3(0.16, 0.02, 0.1 * (i - 1)),
      new THREE.Vector3(0.26, -0.03, 0.13 * (i - 1)),
    ]);
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 12, 0.011, 6, false),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 })
      )
    );
  });

  return g;
}

/**
 * A propeller. `spin` is +1 for CW or -1 for CCW; the blade twist is mirrored so
 * a CW and a CCW prop are visually distinguishable — exactly the difference
 * students must learn to spot before they arm.
 */
export function buildPropeller(mats, spin, colorHex) {
  const g = new THREE.Group();
  g.name = "propeller";
  g.userData.spin = spin;

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.045, 0.05, 12),
    mats.gunmetal
  );
  hub.castShadow = true;
  g.add(hub);

  const bladeMat = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    roughness: 0.28,
    metalness: 0.05,
    clearcoat: 0.6,
    side: THREE.DoubleSide,
  });

  const shape = new THREE.Shape();
  shape.moveTo(0, 0.018);
  shape.quadraticCurveTo(0.22, 0.05, 0.5, 0.016);
  shape.quadraticCurveTo(0.54, 0, 0.5, -0.016);
  shape.quadraticCurveTo(0.22, -0.045, 0, -0.018);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.006,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
  });
  geo.rotateX(Math.PI / 2);

  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(geo, bladeMat);
    blade.rotation.y = i * Math.PI;
    blade.rotation.z = deg(7) * spin; // pitch mirrors with direction
    blade.castShadow = true;
    g.add(blade);
  }

  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.035, 6), mats.gold);
  nut.position.y = 0.04;
  g.add(nut);

  return g;
}

/* ------------------------------------------------------------- AVIONICS */

export function buildFc(mats) {
  const g = new THREE.Group();
  g.name = "fc";
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.4), mats.pcbBlue);
  board.castShadow = board.receiveShadow = true;
  g.add(board);

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.09, 0.38),
    new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.45, metalness: 0.3 })
  );
  shell.position.y = 0.06;
  shell.castShadow = true;
  g.add(shell);

  const mcu = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.1), mats.darkPlastic);
  mcu.position.y = 0.108;
  g.add(mcu);

  // Nose arrow: the single most commonly mis-installed detail on a real build
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.045, 0.09, 3),
    new THREE.MeshBasicMaterial({ color: 0x46e6cf })
  );
  arrow.rotation.x = Math.PI / 2;
  arrow.position.set(0, 0.108, 0.16);
  g.add(arrow);

  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0x46e6cf })
  );
  led.position.set(0.16, 0.108, -0.14);
  led.name = "fcStatusLed";
  g.add(led);
  g.userData.led = led;

  // Output header — one pin per motor
  for (let i = 0; i < 8; i++) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.012), mats.gunmetal);
    pin.position.set(-0.19 + i * 0.05, 0.11, -0.17);
    g.add(pin);
  }
  return g;
}

export function buildImu(mats) {
  const g = new THREE.Group();
  g.name = "imu";
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.04, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x0f1116, roughness: 0.4, metalness: 0.35 })
  );
  body.castShadow = true;
  g.add(body);
  const chip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.018, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.3, metalness: 0.6 })
  );
  chip.position.y = 0.028;
  g.add(chip);
  // Foam anti-vibration pad
  const foam = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.02, 0.13),
    new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.95 })
  );
  foam.position.y = -0.03;
  g.add(foam);
  return g;
}

export function buildCompass(mats) {
  const g = new THREE.Group();
  g.name = "compass";
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.4, 10),
    mats.darkPlastic
  );
  mast.position.y = 0.2;
  mast.castShadow = true;
  g.add(mast);
  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.035, 16),
    mats.white
  );
  head.position.y = 0.42;
  head.castShadow = true;
  g.add(head);
  const needle = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.006, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xe5484d })
  );
  needle.position.y = 0.442;
  needle.name = "compassNeedle";
  g.add(needle);
  g.userData.needle = needle;
  return g;
}

export function buildBarometer(mats) {
  const g = new THREE.Group();
  g.name = "barometer";
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.025, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.5, metalness: 0.2 })
  );
  g.add(body);
  const foam = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.03, 0.09),
    new THREE.MeshStandardMaterial({ color: 0x4a5160, roughness: 0.95 })
  );
  foam.position.y = 0.028;
  g.add(foam);
  return g;
}

export function buildGps(mats) {
  const g = new THREE.Group();
  g.name = "gps";
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.46, 10),
    mats.darkPlastic
  );
  mast.position.y = 0.23;
  mast.castShadow = true;
  g.add(mast);
  const puck = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.24), mats.white);
  puck.position.y = 0.48;
  puck.castShadow = true;
  g.add(puck);
  const dot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.012, 16),
    new THREE.MeshStandardMaterial({ color: 0x2f7d5a, roughness: 0.4 })
  );
  dot.position.y = 0.507;
  g.add(dot);
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffab4a })
  );
  led.position.set(0.09, 0.51, 0.09);
  led.name = "gpsLockLed";
  g.add(led);
  g.userData.led = led;
  return g;
}

export function buildReceiver(mats) {
  const g = new THREE.Group();
  g.name = "receiver";
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.04, 0.13),
    new THREE.MeshStandardMaterial({ color: 0x101319, roughness: 0.55 })
  );
  body.castShadow = true;
  g.add(body);
  [-1, 1].forEach((s) => {
    const ant = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.5 })
    );
    ant.position.set(s * 0.08, 0.16, -0.05);
    ant.rotation.z = s * deg(18);
    g.add(ant);
  });
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x46e6cf })
  );
  led.position.set(0.08, 0.03, 0.05);
  led.name = "rxBindLed";
  g.add(led);
  g.userData.led = led;
  return g;
}

/** Transmitter sits beside the pad — it is the pilot's box, not part of the aircraft. */
export function buildTransmitter(mats) {
  const g = new THREE.Group();
  g.name = "transmitter";
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.42, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.6 })
  );
  body.castShadow = true;
  g.add(body);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.14, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x2c6f5a, roughness: 0.3, emissive: 0x0d2b22 })
  );
  screen.position.set(0, -0.08, 0.09);
  g.add(screen);
  [-1, 1].forEach((s) => {
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8),
      mats.gunmetal
    );
    stick.position.set(s * 0.16, 0.06, 0.12);
    stick.rotation.x = Math.PI / 2;
    g.add(stick);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 10), mats.darkPlastic);
    knob.position.set(s * 0.16, 0.06, 0.18);
    g.add(knob);
  });
  const ant = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8),
    mats.darkPlastic
  );
  ant.position.set(0, 0.36, -0.02);
  g.add(ant);
  return g;
}

/** Piezo buzzer. */
export function buildBuzzer(mats) {
  const g = new THREE.Group();
  g.name = "buzzer";
  const can = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.05, 18),
    new THREE.MeshStandardMaterial({ color: 0x0e1116, roughness: 0.55, metalness: 0.25 })
  );
  can.castShadow = true;
  g.add(can);
  const port = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.012, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.4 })
  );
  port.position.y = 0.028;
  g.add(port);
  [0xe5484d, 0x101010].forEach((col, i) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.05, -0.01, -0.01 + i * 0.02),
      new THREE.Vector3(0.11, -0.02, -0.02 + i * 0.02),
      new THREE.Vector3(0.17, -0.02, -0.02 + i * 0.02),
    ]);
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 8, 0.007, 6, false),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.55 })
      )
    );
  });
  return g;
}

/* --------------------------------------------------------------- LOOKUP */

export const PART_BUILDERS = {
  frame: (mats, ctx) => buildHubPlate(mats, ctx.frame),
  arm: (mats, ctx) => buildArm(mats, ctx.frame),
  topplate: (mats, ctx) => buildTopPlate(mats, ctx.frame),
  battery: (mats, ctx) => buildBattery(mats, ctx.batteryLabel),
  pdb: (mats, ctx) => buildPdb(mats, ctx.frame),
  esc: (mats) => buildEsc(mats),
  motor: (mats) => buildMotor(mats),
  propeller: (mats, ctx) =>
    buildPropeller(mats, ctx.spin ?? 1, ctx.propColor ?? 0x14161b),
  fc: (mats) => buildFc(mats),
  imu: (mats) => buildImu(mats),
  compass: (mats) => buildCompass(mats),
  barometer: (mats) => buildBarometer(mats),
  gps: (mats) => buildGps(mats),
  receiver: (mats) => buildReceiver(mats),
  transmitter: (mats) => buildTransmitter(mats),
  buzzer: (mats) => buildBuzzer(mats),
};

export function buildPart(partId, mats, ctx = {}) {
  const fn = PART_BUILDERS[partId];
  if (!fn) return new THREE.Group();
  return fn(mats, ctx);
}
