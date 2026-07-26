/**
 * DRONE SCENE
 * ===========
 * Owns the whole three.js world: the holographic assembly bay, the slot system
 * that students drag parts into, the assembled aircraft, and the flight chamber
 * with its mission gates.
 *
 * It is a plain class (no React) so the render loop never touches React state.
 * React pushes data in through `setBuild`, `setMode`, `setTelemetry`.
 */

import * as THREE from "three";
import {
  makeMaterials,
  makeGradientTexture,
  makeGridTexture,
  makeHexGridTexture,
  makeRadialGlowTexture,
  makeBatteryLabelTexture,
  makeLabelTexture,
  disposeObject,
  ghostify,
} from "./materials.js";
import { buildPart, buildArm } from "./partMeshes.js";
import { AIRFRAMES } from "../data/airframes.js";
import { GATES } from "../sim/flightSim.js";

const deg = (d) => (d * Math.PI) / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* Vertical stack heights, in scene units. */
const H = {
  hub: 0,
  arm: 0,
  esc: 0.09,
  motor: 0.1,
  prop: 0.42,
  pdb: 0.2,
  fc: 0.36,
  imu: 0.5,
  barometer: 0.5,
  topplate: 0.58,
  battery: -0.28,
  gps: 0.6,
  compass: 0.6,
  receiver: 0.46,
};

export const SNAP_DISTANCE = 0.85;

export class DroneScene {
  constructor(canvas, wrap) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.mode = "assembly";
    this.placed = {};
    this.meshBySlot = new Map(); // "partId:slot" -> mesh
    this.telemetry = null;
    this.frame = AIRFRAMES.quad;
    this.onPlace = null;
    this.dragState = null;

    this.initRenderer();
    this.initScene();
    this.initAssemblyBay();
    this.initFlightChamber();
    this.initInteraction();
    this.resize();

    this.clock = new THREE.Clock();
    this.raf = requestAnimationFrame(this.animate);
  }

  /* ------------------------------------------------------------ renderer */

  initRenderer() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    this.renderer = renderer;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
  }

  initScene() {
    const scene = new THREE.Scene();
    this.studioBg = makeGradientTexture("#5fb6e8", "#c6e9fb");
    scene.background = this.studioBg;
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);

    this.hemi = new THREE.HemisphereLight(0xbcd6f0, 0x3a5570, 0.75);
    this.key = new THREE.DirectionalLight(0xffffff, 1.5);
    this.key.position.set(4, 6, 3);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.setShadowBounds(4.2, 12);
    this.fill = new THREE.DirectionalLight(0x9fc9ff, 0.35);
    this.fill.position.set(-4, 3, -3);
    this.rim = new THREE.DirectionalLight(0x46e6cf, 0.45);
    this.rim.position.set(-1, 2, -4);
    // A DirectionalLight's target only takes effect once it is in the scene graph.
    scene.add(this.hemi, this.key, this.key.target, this.fill, this.rim);

    this.mats = makeMaterials();
    this.glowCyan = makeRadialGlowTexture(0x46e6cf);
    this.glowAmber = makeRadialGlowTexture(0xffab4a);
    this.glowBlue = makeRadialGlowTexture(0xa8d4ff);
    this.batteryLabel = makeBatteryLabelTexture(4200);

    /* Camera orbit state (assembly) */
    this.camAz = deg(35);
    this.camPolar = deg(60);
    this.camRadius = 10;
    this.camTarget = new THREE.Vector3(0, 0.5, 0);
    this.lastInteract = performance.now();
    this.chasePos = new THREE.Vector3(0, 5, -7);
    this.chaseLook = new THREE.Vector3();
  }

  setShadowBounds(half, far) {
    const s = this.key.shadow.camera;
    s.left = -half;
    s.right = half;
    s.top = half;
    s.bottom = -half;
    s.near = 0.5;
    s.far = far;
    s.updateProjectionMatrix();
  }

  /* -------------------------------------------------------- assembly bay */

  initAssemblyBay() {
    const bay = new THREE.Group();
    this.bay = bay;
    this.scene.add(bay);

    this.groundTex = makeGridTexture("rgba(255,255,255,0.35)", "#3fa0d6");
    this.groundTex.repeat.set(30, 30);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(20, 72),
      new THREE.MeshStandardMaterial({ map: this.groundTex, roughness: 0.92, metalness: 0.02 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.72;
    ground.receiveShadow = true;
    bay.add(ground);

    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(2.7, 2.95, 0.14, 8),
      new THREE.MeshStandardMaterial({ color: 0xeef5fb, roughness: 0.4, metalness: 0.25 })
    );
    podium.position.y = -0.66;
    podium.receiveShadow = true;
    bay.add(podium);

    this.padTex = makeHexGridTexture("rgba(15,95,125,0.75)");
    this.padTex.repeat.set(9, 9);
    this.pad = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 64),
      new THREE.MeshBasicMaterial({
        map: this.padTex,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      })
    );
    this.pad.rotation.x = -Math.PI / 2;
    this.pad.position.y = -0.585;
    bay.add(this.pad);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(2.62, 0.03, 10, 80),
      new THREE.MeshBasicMaterial({ color: 0xffab4a })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.585;
    bay.add(rim);

    this.orbitA = this.makeOrbitRing(2.25, 12, 0x46e6cf, -0.55, 0.07);
    this.orbitB = this.makeOrbitRing(2.5, 8, 0xffab4a, -0.52, 0.06);

    this.core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowCyan,
        color: 0x46e6cf,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.core.scale.set(1.0, 1.0, 1);
    this.core.position.set(0, -0.55, 0);
    bay.add(this.core);

    this.coreLight = new THREE.PointLight(0x46e6cf, 0.7, 5);
    this.coreLight.position.set(0, -0.3, 0);
    bay.add(this.coreLight);

    /* The aircraft itself. Everything the student places is parented here, so
       switching to flight mode is just re-parenting one group. */
    this.aircraft = new THREE.Group();
    this.aircraft.name = "aircraft";
    bay.add(this.aircraft);

    this.slotGroup = new THREE.Group();
    bay.add(this.slotGroup);

    this.labelGroup = new THREE.Group();
    bay.add(this.labelGroup);

    /* The transmitter lives beside the pad, not on the aircraft. */
    this.txStand = new THREE.Group();
    this.txStand.position.set(-2.9, -0.2, 1.7);
    this.txStand.rotation.y = deg(35);
    bay.add(this.txStand);
  }

  makeOrbitRing(radius, count, color, y, dotScale) {
    const group = new THREE.Group();
    const map = color === 0x46e6cf ? this.glowCyan : this.glowAmber;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      spr.scale.set(dotScale, dotScale, 1);
      spr.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
      group.add(spr);
    }
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.006, 8, 80),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
    this.bay.add(group);
    return group;
  }

  /* ------------------------------------------------------ flight chamber */

  initFlightChamber() {
    const fc = new THREE.Group();
    fc.visible = false;
    this.flight = fc;
    this.scene.add(fc);

    const base = new THREE.Mesh(
      new THREE.CircleGeometry(90, 96),
      new THREE.MeshStandardMaterial({ color: 0x2f6f43, roughness: 0.95, metalness: 0.02 })
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.02;
    base.receiveShadow = true;
    fc.add(base);

    this.fieldTex = makeGridTexture("rgba(255,255,255,0.18)", null, 64);
    this.fieldTex.repeat.set(60, 60);
    const gridOverlay = new THREE.Mesh(
      new THREE.CircleGeometry(90, 96),
      new THREE.MeshBasicMaterial({
        map: this.fieldTex,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
    );
    gridOverlay.rotation.x = -Math.PI / 2;
    gridOverlay.position.y = -0.01;
    fc.add(gridOverlay);

    /* Launch pad marker at the origin — the RTH home point. */
    const homePad = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 40),
      new THREE.MeshBasicMaterial({ color: 0xffab4a, transparent: true, opacity: 0.28 })
    );
    homePad.rotation.x = -Math.PI / 2;
    homePad.position.y = 0.005;
    fc.add(homePad);
    const homeRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.06, 8, 60),
      new THREE.MeshBasicMaterial({ color: 0xffab4a })
    );
    homeRing.rotation.x = Math.PI / 2;
    homeRing.position.y = 0.01;
    fc.add(homeRing);

    /* Wind indicator — a windsock that leans with the environment setting. */
    this.windsock = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xdddddd })
    );
    pole.position.y = 2;
    this.windsock.add(pole);
    this.sockMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 1.8, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xff7a33,
        side: THREE.DoubleSide,
        roughness: 0.8,
      })
    );
    this.sockMesh.rotation.z = -Math.PI / 2;
    this.sockMesh.position.set(0.9, 3.9, 0);
    this.windsock.add(this.sockMesh);
    this.windsock.position.set(-8, 0, 4);
    fc.add(this.windsock);

    /* Mission gates */
    this.gates = GATES.map((p, i) => {
      const g = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x5b6270,
        transparent: true,
        opacity: 0.5,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.09, 10, 44), ringMat);
      g.add(ring);
      const glowMat = new THREE.SpriteMaterial({
        map: this.glowAmber,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(2.2, 2.2, 1);
      g.add(glow);
      const num = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeLabelTexture(`${i + 1}`, null, "#ffab4a"),
          transparent: true,
          depthWrite: false,
        })
      );
      num.scale.set(0.9, 0.45, 1);
      num.position.y = 2.3;
      g.add(num);
      g.position.set(p.x, p.y, p.z);
      fc.add(g);
      return { group: g, ringMat, glowMat };
    });

    /* A few reference objects so speed and altitude are readable. */
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 18 + Math.random() * 60;
      const h = 1.5 + Math.random() * 4;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, h * 0.4, 6),
        new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.9 })
      );
      trunk.position.y = h * 0.2;
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(h * 0.34, h * 0.85, 8),
        new THREE.MeshStandardMaterial({ color: 0x2c6b3f, roughness: 0.9 })
      );
      crown.position.y = h * 0.62;
      crown.castShadow = true;
      tree.add(trunk, crown);
      tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      fc.add(tree);
    }
  }

  /* --------------------------------------------------------- interaction */

  initInteraction() {
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.orbiting = false;

    this.onPointerDown = (e) => {
      if (this.mode !== "assembly" || this.dragState) return;
      this.orbiting = true;
      this.lastPX = e.clientX;
      this.lastPY = e.clientY;
    };
    this.onPointerMove = (e) => {
      if (this.dragState) {
        this.dragMove(e.clientX, e.clientY);
        return;
      }
      if (!this.orbiting) return;
      this.lastInteract = performance.now();
      const dx = e.clientX - this.lastPX;
      const dy = e.clientY - this.lastPY;
      this.lastPX = e.clientX;
      this.lastPY = e.clientY;
      this.camAz -= dx * 0.006;
      this.camPolar = clamp(this.camPolar - dy * 0.006, deg(15), deg(86));
    };
    this.onPointerUp = () => {
      this.orbiting = false;
      if (this.dragState) this.dragEnd();
    };
    this.onWheel = (e) => {
      if (this.mode !== "assembly") return;
      e.preventDefault();
      this.lastInteract = performance.now();
      this.camRadius = clamp(this.camRadius + e.deltaY * 0.004, 5, 20);
    };

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  /* -------------------------------------------------------- slot system */

  /**
   * Where every part goes for the current airframe. Computed from the frame's
   * geometry so a hexacopter automatically gets six of everything, in the right
   * places, with the right CW/CCW labels.
   */
  buildSlots() {
    const f = this.frame;
    const R = f.tipRadius;
    const stackR = f.motorCount >= 6 ? 0.5 : 0.44;
    const escR = R * 0.58;

    const slots = {};
    /* Motor angles are measured CLOCKWISE FROM THE NOSE, and the mixer treats
       cos(angle) as the FORWARD component and sin(angle) as the RIGHT component.
       World axes here are +Z forward and +X right, so it must be
       x = sin(angle), z = cos(angle). Swapping these two mirrors the whole
       airframe about its diagonal, which silently puts M2 at the front-left when
       the mixer believes it is at the rear-right. */
    const polar = (r, y, a) =>
      new THREE.Vector3(Math.sin(deg(a)) * r, y, Math.cos(deg(a)) * r);

    slots.frame = [{ slot: 0, pos: new THREE.Vector3(0, H.hub, 0), rot: 0, size: 0.95 }];

    slots.esc = f.motors.map((m) => ({
      slot: m.index,
      pos: polar(escR, H.esc, m.angle),
      // Same convention as the arms: a part laid along +X is rotated by
      // (angle - 90 degrees) about Y to point down its arm.
      rot: deg(m.angle) - Math.PI / 2,
      size: 0.34,
      label: `ESC ${m.index + 1}`,
    }));

    slots.motor = f.motors.map((m) => ({
      slot: m.index,
      pos: polar(R, H.motor, m.angle),
      rot: 0,
      size: 0.36,
      label: `M${m.index + 1}`,
      sub: `${m.spinLabel} · ${m.position}`,
      spin: m.spin,
    }));

    slots.propeller = f.motors.map((m) => ({
      slot: m.index,
      pos: polar(R, H.prop, m.angle),
      rot: 0,
      size: 0.5,
      label: `PROP ${m.index + 1}`,
      sub: m.spinLabel,
      spin: m.spin,
      propColor: m.propColor,
    }));

    slots.pdb = [{ slot: 0, pos: new THREE.Vector3(0, H.pdb, 0), rot: 0, size: 0.42 }];
    slots.fc = [{ slot: 0, pos: new THREE.Vector3(0, H.fc, 0), rot: 0, size: 0.42 }];
    slots.imu = [
      { slot: 0, pos: new THREE.Vector3(-0.22, H.imu, -0.18), rot: 0, size: 0.24 },
    ];
    slots.barometer = [
      { slot: 0, pos: new THREE.Vector3(0.22, H.barometer, -0.18), rot: 0, size: 0.22 },
    ];
    slots.gps = [
      { slot: 0, pos: new THREE.Vector3(0, H.gps, -stackR * 0.85), rot: 0, size: 0.32 },
    ];
    slots.compass = [
      { slot: 0, pos: new THREE.Vector3(0, H.compass, stackR * 0.85), rot: 0, size: 0.3 },
    ];
    slots.receiver = [
      { slot: 0, pos: new THREE.Vector3(0.3, H.receiver, 0.2), rot: 0, size: 0.3 },
    ];
    slots.telemetry = [
      { slot: 0, pos: new THREE.Vector3(-0.32, H.receiver, 0.18), rot: 0, size: 0.3 },
    ];
    slots.buzzer = [
      { slot: 0, pos: new THREE.Vector3(-0.3, H.pdb + 0.04, -0.26), rot: 0, size: 0.22 },
    ];
    slots.battery = [
      { slot: 0, pos: new THREE.Vector3(0, H.battery, 0), rot: 0, size: 0.85 },
    ];
    slots.transmitter = [
      { slot: 0, pos: new THREE.Vector3(-2.9, 0.2, 1.7), rot: deg(35), size: 0.7, offAircraft: true },
    ];

    this.slots = slots;
    return slots;
  }

  setFrame(frameId) {
    const next = AIRFRAMES[frameId] || AIRFRAMES.quad;
    if (this.frame?.id === next.id && this.slots) return;
    this.frame = next;
    this.clearAircraft();
    this.buildSlots();
    this.buildArms();
    this.rebuildSlotMarkers();
  }

  /** Arms are structural: they appear as soon as the frame is placed. */
  buildArms() {
    if (this.armsGroup) {
      this.aircraft.remove(this.armsGroup);
      disposeObject(this.armsGroup);
    }
    this.armsGroup = new THREE.Group();
    this.armsGroup.visible = false;
    this.frame.motors.forEach((m) => {
      const arm = buildArm(this.mats, this.frame);
      // buildArm lays the arm along +X. Rotating by (angle - 90) about Y swings it
      // to (sin angle, 0, cos angle) — the same place buildSlots() puts the motor.
      arm.rotation.y = deg(m.angle) - Math.PI / 2;
      this.armsGroup.add(arm);
    });
    this.aircraft.add(this.armsGroup);
  }

  rebuildSlotMarkers() {
    if (this.slotGroup) {
      this.slotGroup.clear();
      this.markers = [];
    }
    this.markers = [];
    Object.entries(this.slots).forEach(([partId, list]) => {
      list.forEach((s) => {
        const marker = this.makeMarker(s.size, partId === "frame" ? 0x46e6cf : 0xffab4a);
        marker.position.copy(s.pos);
        marker.visible = false;
        // Merge — makeMarker already stored ring / disc / baseColor in userData.
        Object.assign(marker.userData, { partId, slot: s.slot, base: s });
        this.slotGroup.add(marker);
        this.markers.push(marker);
      });
    });
  }

  makeMarker(size, color) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(size, size * 0.07, 10, 40),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.rotation.x = Math.PI / 2;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.92, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    disc.rotation.x = -Math.PI / 2;
    g.add(disc, ring);
    g.userData.ring = ring;
    g.userData.disc = disc;
    g.userData.baseColor = color;
    return g;
  }

  /** Which part is the student currently allowed to drop, and into which slots. */
  setActiveTarget(partId, filledSlots) {
    this.activePart = partId;
    this.filledSlots = filledSlots || new Set();
    if (!this.markers) return;
    this.markers.forEach((m) => {
      const isActive = m.userData.partId === partId;
      const isFilled = this.filledSlots.has(`${m.userData.partId}:${m.userData.slot}`);
      m.visible = isActive && !isFilled;
      this.setMarkerColor(m, m.userData.baseColor);
    });
    this.updateSlotLabels();
  }

  setMarkerColor(marker, hex) {
    marker.userData.ring.material.color.setHex(hex);
    marker.userData.disc.material.color.setHex(hex);
  }

  updateSlotLabels() {
    this.labelGroup.clear();
    if (!this.activePart || !this.slots?.[this.activePart]) return;
    this.slots[this.activePart].forEach((s) => {
      if (!s.label) return;
      if (this.filledSlots?.has(`${this.activePart}:${s.slot}`)) return;
      const accent = s.spin === 1 ? "#7fd7ff" : s.spin === -1 ? "#ffab4a" : "#46e6cf";
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeLabelTexture(s.label, s.sub, accent),
          transparent: true,
          depthWrite: false,
        })
      );
      spr.scale.set(0.86, 0.43, 1);
      spr.position.copy(s.pos).add(new THREE.Vector3(0, s.size + 0.32, 0));
      this.labelGroup.add(spr);
    });
  }

  /* ------------------------------------------------------ drag and drop */

  startDrag(partId, clientX, clientY, ctx = {}) {
    if (this.dragState || this.mode !== "assembly") return;
    const slotList = this.slots?.[partId];
    if (!slotList) return;

    const firstFree = slotList.find(
      (s) => !this.filledSlots?.has(`${partId}:${s.slot}`)
    );
    const ghost = buildPart(partId, this.mats, {
      frame: this.frame,
      batteryLabel: this.batteryLabel,
      spin: firstFree?.spin ?? 1,
      propColor: firstFree?.propColor ?? 0x14161b,
      ...ctx,
    });
    ghostify(ghost);
    ghost.position.set(-3.4, 0.8, 2.6);
    this.bay.add(ghost);

    this.dragState = {
      partId,
      ghost,
      sx: clientX,
      sy: clientY,
      moved: false,
      hover: null,
      ctx,
    };
    this.dragMove(clientX, clientY);
  }

  dragMove(clientX, clientY) {
    const ds = this.dragState;
    if (!ds) return;
    if (Math.hypot(clientX - ds.sx, clientY - ds.sy) > 5) ds.moved = true;

    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    const slotList = this.slots[ds.partId] || [];
    const planeY = slotList[0]?.pos.y ?? 0;
    this.dragPlane.constant = -planeY;

    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, hit)) return;
    hit.x = clamp(hit.x, -4, 4);
    hit.z = clamp(hit.z, -4, 4);
    ds.ghost.position.set(hit.x, planeY + 0.12, hit.z);
    ds.ghost.rotation.y += 0.015;

    /* Highlight the nearest free slot in green once it is within snap range. */
    let best = null;
    let bestD = Infinity;
    for (const s of slotList) {
      if (this.filledSlots?.has(`${ds.partId}:${s.slot}`)) continue;
      const d = s.pos.distanceTo(ds.ghost.position);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    const marker =
      best && bestD <= SNAP_DISTANCE
        ? this.markers.find(
            (m) => m.userData.partId === ds.partId && m.userData.slot === best.slot
          )
        : null;

    if (ds.hover && ds.hover !== marker) this.setMarkerColor(ds.hover, ds.hover.userData.baseColor);
    if (marker && ds.hover !== marker) this.setMarkerColor(marker, 0x39ff6a);
    ds.hover = marker;
    ds.candidate = marker ? best : null;
  }

  dragEnd() {
    const ds = this.dragState;
    if (!ds) return;
    if (ds.hover) this.setMarkerColor(ds.hover, ds.hover.userData.baseColor);

    const accepted = ds.moved && ds.candidate;
    if (accepted) {
      this.onPlace?.(ds.partId, ds.candidate.slot, ds.ctx);
    }
    this.bay.remove(ds.ghost);
    disposeObject(ds.ghost);
    this.dragState = null;
  }

  /* -------------------------------------------------- aircraft assembly */

  clearAircraft() {
    this.meshBySlot.forEach((mesh) => {
      mesh.parent?.remove(mesh);
      disposeObject(mesh);
    });
    this.meshBySlot.clear();
  }

  /**
   * Reconcile the 3D aircraft with the student's build state.
   * `placed` is { partId: [{ slot, variant, ... }] }
   */
  syncBuild(placed) {
    this.placed = placed;
    const wanted = new Set();

    Object.entries(placed).forEach(([partId, items]) => {
      const slotList = this.slots?.[partId];
      if (!slotList) return;
      items.forEach((item) => {
        const key = `${partId}:${item.slot}`;
        wanted.add(key);
        if (this.meshBySlot.has(key)) return;

        const s = slotList.find((x) => x.slot === item.slot);
        if (!s) return;

        const mesh = buildPart(partId, this.mats, {
          frame: this.frame,
          batteryLabel: this.batteryLabel,
          spin: item.variant === "ccw" ? -1 : item.variant === "cw" ? 1 : (s.spin ?? 1),
          propColor: s.propColor ?? 0x14161b,
        });
        // Off-aircraft parts (the transmitter) sit on their own stand, which is
        // already positioned, so they go at its origin.
        if (s.offAircraft) mesh.position.set(0, 0, 0);
        else mesh.position.copy(s.pos);
        mesh.rotation.y = s.offAircraft ? 0 : s.rot || 0;
        mesh.traverse((o) => {
          if (o.isMesh) o.castShadow = true;
        });
        mesh.scale.setScalar(0.01);
        mesh.userData.targetScale = 1;
        mesh.userData.partId = partId;
        mesh.userData.slot = item.slot;

        (s.offAircraft ? this.txStand : this.aircraft).add(mesh);
        this.meshBySlot.set(key, mesh);

        this.placementFlash(s.pos);
      });
    });

    /* Remove anything the student took back off. */
    [...this.meshBySlot.keys()].forEach((key) => {
      if (wanted.has(key)) return;
      const mesh = this.meshBySlot.get(key);
      mesh.parent?.remove(mesh);
      disposeObject(mesh);
      this.meshBySlot.delete(key);
    });

    if (this.armsGroup) {
      this.armsGroup.visible = (placed.frame?.length || 0) > 0;
    }
  }

  placementFlash(pos) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.03, 8, 32),
      new THREE.MeshBasicMaterial({
        color: 0x39ff6a,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(pos);
    this.bay.add(ring);
    this.flashes = this.flashes || [];
    this.flashes.push({ mesh: ring, t: 0 });
  }

  /* ------------------------------------------------------------- modes */

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;

    if (mode === "flight") {
      this.bay.remove(this.aircraft);
      this.scene.add(this.aircraft);
      this.flight.visible = true;
      this.bay.visible = false;
      this.scene.background = new THREE.Color(0x86c9f0);
      this.scene.fog = new THREE.FogExp2(0x9fd3f2, 0.006);
      this.setShadowBounds(30, 160);
      this.key.intensity = 1.7;
      // In the flight field 1 unit = 1 metre, so the aircraft is scaled down from
      // bay units. Slightly larger than true scale so students can still see it.
      this.aircraft.scale.setScalar(0.32);
    } else {
      this.scene.remove(this.aircraft);
      this.bay.add(this.aircraft);
      this.flight.visible = false;
      this.bay.visible = true;
      this.scene.background = this.studioBg;
      this.scene.fog = null;
      this.setShadowBounds(4.2, 12);
      this.key.intensity = 1.5;
      this.aircraft.scale.setScalar(1);
      this.aircraft.position.set(0, 0, 0);
      this.aircraft.rotation.set(0, 0, 0);
      this.camAz = deg(35);
      this.camPolar = deg(60);
      this.camRadius = 10;
    }
  }

  setTelemetry(t) {
    this.telemetry = t;
  }

  /**
   * Hand the scene the flight simulator so it can step the physics inside its own
   * render loop and read the aircraft's state directly.
   *
   * Previously the physics ran in a separate React loop and the pose reached the
   * scene through React state at 20 Hz, so the drone visibly stepped between
   * snapshots while everything around it rendered at 60. Driving both from one
   * loop removes that judder entirely.
   */
  attachSim(sim) {
    this.sim = sim;
    this.simAccumulator = 0;
  }

  setEnvironment(env) {
    this.env = env;
  }

  /* ------------------------------------------------------------- render */

  resize() {
    const w = this.wrap.clientWidth || 1;
    const h = this.wrap.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  animate = () => {
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();

    /* Grow-in animation for newly placed parts */
    this.meshBySlot.forEach((mesh) => {
      if (mesh.scale.x < 0.999) {
        const s = Math.min(1, mesh.scale.x + dt * 4.5);
        // slight overshoot so placement feels satisfying
        mesh.scale.setScalar(s < 1 ? s * (1 + 0.18 * (1 - s)) : 1);
      }
    });

    /* Placement flashes */
    if (this.flashes?.length) {
      this.flashes = this.flashes.filter((f) => {
        f.t += dt;
        const k = f.t / 0.55;
        f.mesh.scale.setScalar(1 + k * 3.2);
        f.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
        if (k >= 1) {
          this.bay.remove(f.mesh);
          disposeObject(f.mesh);
          return false;
        }
        return true;
      });
    }

    /* Ambient bay motion */
    if (this.bay.visible) {
      this.orbitA.rotation.y += dt * 0.35;
      this.orbitB.rotation.y -= dt * 0.25;
      this.padTex.offset.x = (now * 0.00002) % 1;
      this.groundTex.offset.x = (now * 0.000008) % 1;
      const pulse = 0.5 + Math.sin(now * 0.003) * 0.5;
      this.core.material.opacity = 0.3 + pulse * 0.3;
      this.coreLight.intensity = 0.45 + pulse * 0.5;

      (this.markers || []).forEach((m) => {
        if (!m.visible) return;
        const p = 0.5 + Math.sin(now * 0.005) * 0.5;
        m.userData.ring.material.opacity = 0.45 + p * 0.35;
        m.userData.disc.material.opacity = 0.08 + p * 0.16;
        m.scale.setScalar(1 + p * 0.08);
      });
    }

    this.updateLiveIndicators(dt);

    if (this.mode === "flight") this.updateFlight(dt);
    else this.updateOrbitCamera(dt, now);

    this.renderer.render(this.scene, this.camera);
  };

  /** Propeller spin, ESC heat LEDs, GPS lock LED, FC status LED, compass needle. */
  updateLiveIndicators(dt) {
    const t = this.telemetry;
    // Propeller speed comes straight off the simulator when one is attached, so
    // the blades track the motors frame-for-frame instead of stepping.
    const liveRpm = this.mode === "flight" && this.sim ? this.sim.motorRpmArr : null;

    this.meshBySlot.forEach((mesh, key) => {
      const [partId, slotStr] = key.split(":");
      const slot = Number(slotStr);

      if (partId === "propeller") {
        const spin = mesh.userData.spin ?? 1;
        let rpm = 0;
        if (liveRpm?.[slot] != null) rpm = liveRpm[slot];
        else if (t?.motorRpm?.[slot] != null) rpm = t.motorRpm[slot];
        else if (this.mode === "assembly" && this.idleSpin) rpm = 1200;
        // Scale RPM down heavily — real RPM would be a strobing blur
        mesh.rotation.y += spin * (rpm / 6000) * dt * 22;
      }

      if (partId === "esc" && mesh.userData.led) {
        const temp = t?.escTemps?.[slot] ?? 25;
        const c = temp > 90 ? 0xe5484d : temp > 70 ? 0xffab4a : 0x46e6cf;
        mesh.userData.led.material.color.setHex(c);
      }

      if (partId === "gps" && mesh.userData.led) {
        const sats = t?.satellites ?? 0;
        mesh.userData.led.material.color.setHex(
          sats >= 8 ? 0x39ff6a : sats > 0 ? 0xffab4a : 0xe5484d
        );
      }

      if (partId === "fc" && mesh.userData.led) {
        const tone = this.fcTone || "info";
        const c =
          tone === "ok" ? 0x39ff6a : tone === "warn" ? 0xffab4a : tone === "bad" ? 0xe5484d : 0x46e6cf;
        mesh.userData.led.material.color.setHex(c);
      }

      if (partId === "compass" && mesh.userData.needle) {
        // The needle always points at world north, so it counter-rotates with yaw
        mesh.userData.needle.rotation.y = -(this.aircraft.rotation.y || 0);
      }
    });

    /* Windsock leans with wind speed */
    if (this.sockMesh && this.env) {
      const w = this.env.wind ?? 0;
      const droop = Math.max(0, 1 - w / 12);
      this.sockMesh.rotation.y = 0;
      this.sockMesh.rotation.x = 0;
      this.sockMesh.rotation.z = -Math.PI / 2 + droop * 1.0;
    }
  }

  setFcTone(tone) {
    this.fcTone = tone;
  }

  updateOrbitCamera(dt, now) {
    if (!this.orbiting && !this.dragState && now - this.lastInteract > 2500) {
      this.camAz += dt * 0.09;
    }
    const x = this.camTarget.x + this.camRadius * Math.sin(this.camPolar) * Math.sin(this.camAz);
    const y = this.camTarget.y + this.camRadius * Math.cos(this.camPolar);
    const z = this.camTarget.z + this.camRadius * Math.sin(this.camPolar) * Math.cos(this.camAz);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.camTarget);
  }

  updateFlight(dt) {
    const sim = this.sim;

    /* Step the physics here, in the render loop, at a fixed 240 Hz. Reading the
       aircraft's pose straight out of the simulator on the same frame it is
       rendered is what makes the motion smooth — no snapshot quantisation. */
    if (sim) {
      this.simAccumulator = Math.min((this.simAccumulator || 0) + dt, 0.25);
      const STEP = 1 / 240;
      let guard = 0;
      while (this.simAccumulator >= STEP && guard++ < 60) {
        sim.step(STEP);
        this.simAccumulator -= STEP;
      }
    }

    // Prefer the live simulator; fall back to the last React snapshot.
    const t = sim
      ? {
          position: sim.pos,
          pitch: sim.pitch,
          yaw: sim.yaw,
          roll: sim.roll,
          gatesPassed: sim.gatesPassed.size,
        }
      : this.telemetry
        ? {
            position: this.telemetry.position,
            pitch: (this.telemetry.pitchDeg * Math.PI) / 180,
            yaw: (this.telemetry.heading * Math.PI) / 180,
            roll: (this.telemetry.rollDeg * Math.PI) / 180,
            gatesPassed: this.telemetry.gatesPassed ?? 0,
          }
        : null;
    if (!t) return;

    this.aircraft.position.set(t.position.x, t.position.y, t.position.z);
    this.aircraft.rotation.order = "YXZ";
    this.aircraft.rotation.set(t.pitch, t.yaw, t.roll);

    /* Chase camera */
    const yaw = t.yaw;
    const desired = new THREE.Vector3(
      t.position.x - Math.sin(yaw) * 6.5,
      t.position.y + 2.4,
      t.position.z - Math.cos(yaw) * 6.5
    );
    this.chasePos.lerp(desired, 1 - Math.pow(0.001, dt));
    this.chaseLook.lerp(
      new THREE.Vector3(t.position.x, t.position.y + 0.4, t.position.z),
      1 - Math.pow(0.0001, dt)
    );
    this.camera.position.copy(this.chasePos);
    this.camera.lookAt(this.chaseLook);

    /* Gate states */
    const passedCount = t.gatesPassed ?? 0;
    this.gates.forEach((gate, i) => {
      const passed = i < passedCount;
      const isNext = i === passedCount;
      const targetColor = passed ? 0x39ff6a : isNext ? 0xffab4a : 0x5b6270;
      gate.ringMat.color.lerp(new THREE.Color(targetColor), 0.1);
      gate.ringMat.opacity += ((passed ? 0.25 : isNext ? 0.95 : 0.4) - gate.ringMat.opacity) * 0.1;
      gate.glowMat.opacity += ((passed ? 0.1 : isNext ? 0.7 : 0.22) - gate.glowMat.opacity) * 0.1;
      gate.group.rotation.y += dt * (isNext ? 0.5 : 0.12);
    });

    /* Sun follows the aircraft so shadows stay crisp over a large field */
    this.key.position.set(t.position.x + 12, t.position.y + 22, t.position.z + 9);
    this.key.target.position.set(t.position.x, t.position.y, t.position.z);
    this.key.target.updateMatrixWorld();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.scene.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        o.geometry?.dispose?.();
        const d = (m) => {
          m?.map?.dispose?.();
          m?.dispose?.();
        };
        Array.isArray(o.material) ? o.material.forEach(d) : d(o.material);
      }
    });
    this.renderer.dispose();
  }
}
