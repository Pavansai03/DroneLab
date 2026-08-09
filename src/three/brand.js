import * as THREE from "three";

/**
 * THE HANGAR SIGN
 * ===============
 * A branded backdrop standing behind the assembly pad, where a real workshop
 * would have one: bolted to the wall the bench faces, readable from the
 * default camera without ever getting between the camera and the aircraft.
 *
 * THE LOGO IS A FILE, NOT CODE.
 * A wordmark drawn with canvas text will never be the real thing — the
 * letterforms, the spacing and the mark beside them are the brand. So the sign
 * loads `public/brand/logo.png` and uses it if it is there. Until it is, it
 * draws a plain typeset fallback so the bay is never broken, and so it is
 * obvious at a glance that the real asset has not been dropped in yet.
 *
 * Loading is asynchronous and non-blocking: the sign appears immediately with
 * the fallback and repaints itself when the image arrives. A logo is not worth
 * delaying the workshop for.
 */

/* RajUddan's greens, read off the supplied artwork. */
const DEEP = "#1d6b52";
const LEAF = "#7fae2f";

const PANEL_W = 1024;
const PANEL_H = 288;

function hasCanvas() {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Paint the panel.
 *
 * `logo` is an already-loaded HTMLImageElement, or null. Everything else is
 * drawn either way, so the same function serves the first paint and the repaint
 * after the image arrives.
 */
function paint(ctx, logo) {
  ctx.clearRect(0, 0, PANEL_W, PANEL_H);

  // Brushed dark panel, so a white logo has something to sit on.
  const bg = ctx.createLinearGradient(0, 0, PANEL_W, PANEL_H);
  bg.addColorStop(0, "#12332a");
  bg.addColorStop(0.55, "#1d6b52");
  bg.addColorStop(1, "#14483a");
  ctx.fillStyle = bg;
  roundRect(ctx, 6, 6, PANEL_W - 12, PANEL_H - 12, 26);
  ctx.fill();

  ctx.strokeStyle = LEAF;
  ctx.lineWidth = 5;
  roundRect(ctx, 6, 6, PANEL_W - 12, PANEL_H - 12, 26);
  ctx.stroke();

  /* The mark sits on a white tile, exactly as it does on the supplied artwork —
     the logo is drawn for a light background and loses its darker green
     entirely on a dark one. */
  const tile = { x: 46, y: 46, s: PANEL_H - 92 };
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, tile.x, tile.y, tile.s, tile.s, 18);
  ctx.fill();

  if (logo) {
    // Fit inside the tile, preserving aspect, with a little breathing room.
    const pad = 16;
    const box = tile.s - pad * 2;
    const scale = Math.min(box / logo.width, box / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    ctx.drawImage(logo, tile.x + (tile.s - w) / 2, tile.y + (tile.s - h) / 2, w, h);
  } else {
    // Fallback monogram. Not the real mark, and not pretending to be.
    ctx.fillStyle = DEEP;
    ctx.font = "700 104px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("RU", tile.x + tile.s * 0.46, tile.y + tile.s * 0.52);
    ctx.fillStyle = LEAF;
    for (let i = 0; i < 3; i++) {
      const y = tile.y + tile.s * (0.42 + i * 0.13);
      roundRect(ctx, tile.x + tile.s * 0.66, y, tile.s * (0.3 - i * 0.06), 11, 5);
      ctx.fill();
    }
  }

  // Wordmark
  const textX = tile.x + tile.s + 52;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 96px 'Segoe UI', system-ui, -apple-system, Arial, sans-serif";
  ctx.fillText("RajUddan", textX, 168);

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "600 30px 'Segoe UI', system-ui, -apple-system, Arial, sans-serif";
  ctx.letterSpacing = "6px";
  ctx.fillText("DRONE ENGINEERING LAB", textX + 4, 214);
  ctx.letterSpacing = "0px";
}

/**
 * Build the sign.
 *
 * Returns a Group ready to add to the assembly bay, with a `dispose()` on
 * userData so the scene's teardown can release the canvas texture like any
 * other resource.
 */
export function buildBrandSign() {
  const g = new THREE.Group();
  g.name = "brandSign";

  /* No DOM means no canvas means no texture. The sign is then geometry with a
     flat colour, which is the right amount of nothing for a headless import. */
  if (!hasCanvas()) return g;

  const canvas = document.createElement("canvas");
  canvas.width = PANEL_W;
  canvas.height = PANEL_H;
  const ctx = canvas.getContext("2d");
  paint(ctx, null);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;

  const W = 4.6;
  const H = (W * PANEL_H) / PANEL_W;

  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
  panel.position.y = H / 2 + 0.42;
  g.add(panel);

  // A thin backing board so the sign has a physical edge, not a floating decal.
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.16, H + 0.16, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x0f2a24, roughness: 0.7, metalness: 0.2 })
  );
  board.position.set(0, H / 2 + 0.42, -0.05);
  board.castShadow = true;
  g.add(board);

  // Legs, planted on the bay floor.
  const legMat = new THREE.MeshStandardMaterial({ color: 0x8d99a6, roughness: 0.45, metalness: 0.6 });
  for (const x of [-W / 2 + 0.35, W / 2 - 0.35]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.15, 8), legMat);
    leg.position.set(x, -0.13, -0.05);
    leg.castShadow = true;
    g.add(leg);
  }

  /* Swap in the real artwork the moment it loads. If it is not there — which is
     the normal state until someone saves it — the fallback simply stays, and no
     error reaches the console: a missing logo is not a fault worth reporting to
     a student mid-build. */
  const img = new Image();
  img.onload = () => {
    paint(ctx, img);
    tex.needsUpdate = true;
  };
  img.onerror = () => {};
  img.src = "brand/logo.png";

  g.userData.dispose = () => tex.dispose();
  return g;
}
