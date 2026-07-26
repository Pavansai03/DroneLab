import * as THREE from "three";

/* Procedural textures and the shared material set for every part. */

export function makeCarbonTexture() {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1a1c21";
  ctx.fillRect(0, 0, s, s);
  const w = 8;
  for (let y = 0; y < s; y += w) {
    for (let x = 0; x < s; x += w) {
      const alt = (x / w + y / w) % 2 === 0;
      ctx.fillStyle = alt ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.18)";
      ctx.fillRect(x, y, w, w);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeBatteryLabelTexture(mah = 4200) {
  const w = 512;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#1c5fa8");
  grad.addColorStop(1, "#123b6b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffab4a";
  ctx.fillRect(0, h - 26, w, 10);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 42px monospace";
  ctx.fillText("LI-PO 3S", 22, 62);
  ctx.font = "24px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(`11.1V   ${mah}mAh   45C`, 22, 102);
  ctx.font = "16px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("CAUTION - HANDLE WITH CARE", 22, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeGradientTexture(top, bottom) {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext("2d");
  const gr = ctx.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeGridTexture(lineColor, bgColor, step = 32) {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, s, s);
  } else ctx.clearRect(0, 0, s, s);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  for (let x = 0; x <= s; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, s);
    ctx.stroke();
  }
  for (let y = 0; y <= s; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(s, y);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeHexGridTexture(lineColor) {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  const hexR = 21;
  const hexH = hexR * Math.sqrt(3);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.4;
  for (let row = -1; row < s / hexH + 2; row++) {
    for (let col = -1; col < s / (hexR * 1.5) + 2; col++) {
      const x = col * hexR * 1.5;
      const y = row * hexH + (col % 2 ? hexH / 2 : 0);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = x + hexR * Math.cos(a);
        const py = y + hexR * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeRadialGlowTexture(hexColor) {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  const col = new THREE.Color(hexColor);
  const r = Math.round(col.r * 255);
  const g = Math.round(col.g * 255);
  const b = Math.round(col.b * 255);
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.4, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

/** Sprite label used for motor numbers (M1 CW, M2 CCW ...). */
export function makeLabelTexture(text, sub, accent = "#46e6cf") {
  const w = 256;
  const h = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(10,14,20,0.82)";
  roundRect(ctx, 6, 26, w - 12, 76, 14);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  roundRect(ctx, 6, 26, w - 12, 76, 14);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.font = "bold 40px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText(text, w / 2, 68);
  if (sub) {
    ctx.fillStyle = "rgba(231,236,242,0.85)";
    ctx.font = "20px 'JetBrains Mono', monospace";
    ctx.fillText(sub, w / 2, 93);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function makeMaterials() {
  const carbonTex = makeCarbonTexture();
  return {
    carbonTex,
    carbon: new THREE.MeshPhysicalMaterial({
      color: 0x2a2c31,
      roughness: 0.4,
      metalness: 0.2,
      clearcoat: 0.55,
      clearcoatRoughness: 0.3,
      map: carbonTex,
    }),
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x8b93a1, roughness: 0.28, metalness: 0.9 }),
    darkPlastic: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.55, metalness: 0.05 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb8733a, roughness: 0.35, metalness: 0.85 }),
    pcb: new THREE.MeshStandardMaterial({ color: 0x0f3d28, roughness: 0.6, metalness: 0.1 }),
    pcbBlue: new THREE.MeshStandardMaterial({ color: 0x123a5c, roughness: 0.55, metalness: 0.15 }),
    standoffRed: new THREE.MeshStandardMaterial({ color: 0xb43a2d, roughness: 0.4, metalness: 0.7 }),
    strapOrange: new THREE.MeshStandardMaterial({ color: 0xff6a1f, roughness: 0.6, metalness: 0.05 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.35, metalness: 0.9 }),
    vtxAlum: new THREE.MeshStandardMaterial({ color: 0x555b66, roughness: 0.3, metalness: 0.85 }),
    escBoard: new THREE.MeshStandardMaterial({ color: 0x1c1030, roughness: 0.5, metalness: 0.15 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.5, metalness: 0.05 }),
    lens: new THREE.MeshPhysicalMaterial({
      color: 0x0a0e14,
      roughness: 0.05,
      metalness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
  };
}

/** Recursively free GPU resources for a subtree. */
export function disposeObject(obj) {
  obj.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return;
    o.geometry?.dispose?.();
    const dispose = (m) => {
      m?.map?.dispose?.();
      m?.dispose?.();
    };
    Array.isArray(o.material) ? o.material.forEach(dispose) : dispose(o.material);
  });
}

/** Turn a finished part into a translucent "ghost" for drag preview. */
export function ghostify(root, opacity = 0.55) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const gm = (m) => {
      const c = m.clone();
      c.transparent = true;
      c.opacity = opacity;
      c.depthWrite = false;
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(gm) : gm(o.material);
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return root;
}
