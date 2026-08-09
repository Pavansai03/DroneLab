import * as THREE from "three";

/**
 * BRAND ARTWORK
 * =============
 * Paints the RajUddan identity onto a canvas, for use as a texture on the
 * assembly dais's side console.
 *
 * THE MARK IS A FILE, NOT CODE.
 * A logotype drawn with canvas paths will never be the real thing — the
 * letterforms and the wing beside them ARE the brand, and an approximation of
 * someone's logo is worse than an honest placeholder because it looks finished.
 * So this loads `public/brand/logo.png` and uses it the moment it exists.
 *
 * Until it does, it draws a stand-in: the right colours, the right shapes,
 * clearly not the real artwork. Loading is asynchronous and non-blocking — the
 * dais appears immediately and repaints itself when the image arrives. A logo is
 * not worth delaying the workshop for.
 */

/* Read off the supplied artwork. */
export const DEEP = "#1d6b52";
export const LEAF = "#8ab52f";

const W = 1400;
const H = 300;

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

/** The stand-in mark: "RU" with the swept wing, in the right greens. */
function drawFallbackMark(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = DEEP;
  ctx.font = `700 ${size * 0.62}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("RU", size * 0.06, size * 0.52);

  /* Three tapered strokes sweeping right, longest at the top — the wing reads
     as motion, which is the whole point of it on a drone company's mark. */
  ctx.fillStyle = LEAF;
  const bx = size * 0.6;
  for (let i = 0; i < 3; i++) {
    const yy = size * (0.32 + i * 0.17);
    const len = size * (0.36 - i * 0.09);
    const th = size * 0.1;
    ctx.beginPath();
    ctx.moveTo(bx, yy);
    ctx.lineTo(bx + len, yy);
    ctx.lineTo(bx + len - th * 0.7, yy + th);
    ctx.lineTo(bx, yy + th);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function paint(ctx, logo) {
  ctx.clearRect(0, 0, W, H);

  /* The gradient from the supplied wordmark: deep green to the leaf green,
     left to right. */
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#14523f");
  bg.addColorStop(0.55, DEEP);
  bg.addColorStop(1, "#2f7d45");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // A brushed sheen across the panel, so it reads as a lit metal face.
  const sheen = ctx.createLinearGradient(0, 0, 0, H);
  sheen.addColorStop(0, "rgba(255,255,255,0.16)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.02)");
  sheen.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  /* The mark sits on a white tile. The supplied artwork is drawn for a light
     background — its darker green disappears entirely on a dark one. */
  const t = { x: 64, y: 52, s: H - 104 };
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, t.x, t.y, t.s, t.s, 26);
  ctx.fill();

  if (logo) {
    const pad = 18;
    const box = t.s - pad * 2;
    const k = Math.min(box / logo.width, box / logo.height);
    ctx.drawImage(
      logo,
      t.x + (t.s - logo.width * k) / 2,
      t.y + (t.s - logo.height * k) / 2,
      logo.width * k,
      logo.height * k
    );
  } else {
    drawFallbackMark(ctx, t.x, t.y, t.s);
  }

  const tx = t.x + t.s + 56;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#ffffff";
  ctx.font = '800 108px "Segoe UI", system-ui, -apple-system, Arial, sans-serif';
  ctx.fillText("RajUddan", tx, 160);

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = '500 36px "Segoe UI", system-ui, -apple-system, Arial, sans-serif';
  ctx.fillText("Empowering the Next Generation of Drones", tx + 3, 214);

  // A leaf-green rule under the lot, tying the panel to the mark.
  ctx.fillStyle = LEAF;
  ctx.fillRect(tx, 240, W - tx - 64, 6);
}

/**
 * A CanvasTexture carrying the brand panel.
 *
 * Returns `{ texture, dispose }`. The texture repaints itself if and when the
 * real logo loads, so callers need do nothing but use it.
 */
export function makeBrandTexture() {
  if (!hasCanvas()) return null;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  paint(ctx, null);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;

  const img = new Image();
  img.onload = () => {
    paint(ctx, img);
    texture.needsUpdate = true;
  };
  /* A missing logo is the normal state until someone saves one, and it is not a
     fault worth putting in a student's console mid-build. */
  img.onerror = () => {};
  img.src = "brand/logo.png";

  return { texture, dispose: () => texture.dispose() };
}

export const BRAND_ASPECT = W / H;
