import * as THREE from "three";

/**
 * SKY, SUN AND CLOUD
 * ==================
 * Everything above the horizon.
 *
 * The fields used to sit under a flat background colour, and a flat colour is the
 * single biggest thing that reads as "this is a 3D model" rather than "this is
 * outside". Real sky is never one colour: it is pale and warm at the horizon where
 * you are looking through a hundred kilometres of atmosphere, and deep at the
 * zenith where you are looking through five. That gradient is also genuinely
 * useful to a pilot, because it tells you where the horizon is when the aircraft
 * is a speck.
 *
 * Everything here sets `fog: false`. Fog exists to fade DISTANT SCENERY into the
 * haze; applying it to the sky would fade the sky into itself and flatten the
 * gradient straight back out.
 */

/* The dome is re-centred on the camera every frame, so this is not "how big is
   the world" — it is a fixed apparent distance that must sit comfortably inside
   the camera's far plane. Sky that is always the same distance away is also
   physically right: you cannot fly closer to the sky. */
const DOME_RADIUS = 480;

const VERT = `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * A three-stop vertical gradient with a sun.
 *
 * Three stops rather than two because real sky has a distinct band: the warm haze
 * sitting on the horizon is a narrow strip, not half the sky, and a straight
 * two-colour lerp spreads it all the way up and looks like a sunset at midday.
 */
const FRAG = `
  uniform vec3 horizon;
  uniform vec3 mid;
  uniform vec3 zenith;
  uniform vec3 sunDir;
  uniform vec3 sunColour;
  uniform float sunSize;
  varying vec3 vWorld;

  void main() {
    vec3 dir = normalize(vWorld);
    float h = clamp(dir.y, -1.0, 1.0);

    // Haze band hugging the horizon, then a slow climb to the zenith
    float lowBlend = smoothstep(-0.06, 0.16, h);
    float highBlend = smoothstep(0.10, 0.72, h);
    vec3 col = mix(horizon, mid, lowBlend);
    col = mix(col, zenith, highBlend);

    // The sun: a hard disc inside a wide, soft glow
    float d = dot(dir, normalize(sunDir));
    float disc = smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.35, d);
    float glow = pow(max(d, 0.0), 26.0) * 0.5 + pow(max(d, 0.0), 5.0) * 0.12;
    col += sunColour * (disc * 1.5 + glow);

    // Ground half: never actually seen, but keeps the seam from flashing white
    col = mix(col * 0.82, col, smoothstep(-0.25, 0.0, h));

    gl_FragColor = vec4(col, 1.0);
  }
`;

/* Painted textures need a DOM. Guarding it keeps this module importable without
   one, which is what lets the collision and course-clearance checks run headless. */
const hasCanvas = () => typeof document !== "undefined";

function cloudTexture() {
  if (!hasCanvas()) return null;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.clearRect(0, 0, S, S);

  /* A cloud is built from overlapping soft blobs, densest in the middle. Drawing
     them additively into a radial falloff gives a lumpy edge rather than the
     perfect circle a single gradient would produce. */
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.65) * S * 0.32;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r * 0.55;
    const rad = S * (0.09 + Math.random() * 0.13);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, "rgba(255,255,255,0.42)");
    grd.addColorStop(0.55, "rgba(255,255,255,0.16)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build the sky for a field.
 *
 * Returns a group to add to the scene, plus `animate(t)` for the cloud drift and
 * `sunDirection` so the field can aim its key light at the sun it can actually
 * see — a shadow falling the wrong way relative to a visible sun is the kind of
 * mistake the eye catches instantly even when it cannot say why.
 */
export function buildSky({
  horizon = 0xd8e7f2,
  mid = 0x9cc8e8,
  zenith = 0x4e8fc4,
  sun = 0xfff4de,
  sunAzimuth = 0.9,
  sunElevation = 0.62,
  cloudCount = 16,
  cloudHeight = 190,
  cloudColour = 0xffffff,
  cloudOpacity = 0.75,
} = {}) {
  const g = new THREE.Group();
  g.name = "sky";
  // Drawn first and never occluding anything
  g.renderOrder = -1000;

  const sunDir = new THREE.Vector3(
    Math.cos(sunElevation) * Math.sin(sunAzimuth),
    Math.sin(sunElevation),
    Math.cos(sunElevation) * Math.cos(sunAzimuth)
  ).normalize();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(DOME_RADIUS, 32, 20),
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        horizon: { value: new THREE.Color(horizon) },
        mid: { value: new THREE.Color(mid) },
        zenith: { value: new THREE.Color(zenith) },
        sunDir: { value: sunDir },
        sunColour: { value: new THREE.Color(sun) },
        sunSize: { value: 0.0022 },
      },
    })
  );
  dome.frustumCulled = false;

  /* The dome rides with the camera; the clouds do not.
     Clouds are at an altitude a drone can climb through, so they have to stay
     anchored in the world — a cloud that followed the camera could never be
     approached, passed, or looked down on, which is most of what makes a cloud
     deck worth having. */
  const domeHolder = new THREE.Group();
  domeHolder.add(dome);
  g.add(domeHolder);

  /* A cloud DECK, not billboards. Sprites would turn to face the camera, which
     is right for a distant puff and completely wrong when you climb past one —
     and climbing past one is exactly what a student will do. Flat horizontal
     planes read correctly from below and from above, which is the whole point of
     putting them at a height a drone can reach. */
  const tex = cloudTexture();
  const cloudMat = new THREE.MeshBasicMaterial({
    map: tex,
    color: cloudColour,
    transparent: true,
    opacity: cloudOpacity,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });

  const clouds = [];
  for (let i = 0; i < cloudCount; i++) {
    const size = 90 + Math.random() * 190;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.62), cloudMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI;
    const a = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 420;
    m.position.set(
      Math.cos(a) * r,
      cloudHeight + Math.random() * 90,
      Math.sin(a) * r
    );
    m.renderOrder = -900;
    g.add(m);
    clouds.push({ obj: m, drift: 0.6 + Math.random() * 1.4 });
  }

  g.userData.sunDirection = sunDir;
  g.userData.dome = domeHolder;
  g.userData.animate = (t, dt) => {
    for (const c of clouds) {
      c.obj.position.x += c.drift * dt;
      // Wrap the deck rather than letting it sail away
      if (c.obj.position.x > 520) c.obj.position.x = -520;
    }
  };
  g.userData.dispose = () => {
    tex.dispose();
    cloudMat.dispose();
  };
  return g;
}
