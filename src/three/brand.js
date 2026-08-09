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

/**
 * The RajUddan mark, drawn.
 *
 * Reproduced from the supplied artwork rather than loaded from it, because the
 * file is not in the repository. `public/brand/logo.png` still wins whenever it
 * is there — this is what stands in until then.
 *
 * MEASURED, THEN SCALED TO FIT.
 * The first attempt set the type at a fixed fraction of the tile and drew the
 * wing after it, which put the wing outside the tile and underneath the
 * wordmark — a font's advance width is not something you can guess, and Georgia
 * on one machine is not Georgia on another. So it lays the mark out at a
 * nominal size, measures the actual result, and scales the whole thing to fit
 * the space it has been given. That also makes it safe on a machine with no
 * serif font at all, where the fallback face will be a different width again.
 */
function drawFallbackMark(ctx, x, y, boxW, boxH) {
  const NOMINAL = 100;

  /* ---- lay out at a nominal size and measure ---- */
  ctx.save();
  ctx.font = `700 ${NOMINAL * 0.8}px Georgia, "Times New Roman", serif`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${-NOMINAL * 0.06}px`;
  const textW = ctx.measureText("RU").width;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.restore();

  const WING = NOMINAL * 0.72; // how far the longest feather reaches
  const markW = textW + WING;
  const markH = NOMINAL;

  // Fit inside the tile with a margin, and centre what is left over.
  const pad = boxH * 0.14;
  const k = Math.min((boxW - pad * 2) / markW, (boxH - pad * 2) / markH);

  ctx.save();
  ctx.translate(x + (boxW - markW * k) / 2, y + (boxH - markH * k) / 2);
  ctx.scale(k, k);

  /* ------------------------------------------------------------ RU */
  ctx.fillStyle = DEEP;
  ctx.font = `700 ${NOMINAL * 0.8}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${-NOMINAL * 0.06}px`;
  ctx.fillText("RU", 0, NOMINAL * 0.86);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  /* ---------------------------------------------------------- wing */
  /* Three feathers off a short spine, longest at the top, each cut back
     sharply on its underside so the tip is a forward-leaning point. The rake
     is the whole idea of the mark — it is what makes it read as flight rather
     than as a stack of bars, which is exactly what the first version looked
     like. */
  ctx.fillStyle = LEAF;
  const wx = textW - NOMINAL * 0.02;

  const spineW = NOMINAL * 0.11;
  ctx.beginPath();
  ctx.moveTo(wx, NOMINAL * 0.3);
  ctx.lineTo(wx + spineW, NOMINAL * 0.3);
  ctx.lineTo(wx + spineW, NOMINAL * 0.86);
  ctx.lineTo(wx, NOMINAL * 0.86);
  ctx.closePath();
  ctx.fill();

  const feather = (top, h, len) => {
    const lean = h * 0.85; // how far the underside is cut back
    ctx.beginPath();
    ctx.moveTo(wx, top);
    ctx.lineTo(wx + len, top);
    ctx.lineTo(wx + len - lean, top + h);
    ctx.lineTo(wx, top + h);
    ctx.closePath();
    ctx.fill();
  };

  const h = NOMINAL * 0.15;
  const gap = NOMINAL * 0.055;
  feather(NOMINAL * 0.3, h, WING);
  feather(NOMINAL * 0.3 + h + gap, h, WING * 0.72);
  feather(NOMINAL * 0.3 + (h + gap) * 2, h, WING * 0.46);

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
  /* A rounded rectangle, proportioned like the mark. A square tile left the
     logo stranded in the middle of a field of white — the mark is close to
     twice as wide as it is tall, and the plate it sits on should say so. */
  const t = { x: 54, y: 44, w: 372, h: H - 88 };
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, t.x, t.y, t.w, t.h, 24);
  ctx.fill();

  if (logo) {
    const pad = 18;
    const k = Math.min((t.w - pad * 2) / logo.width, (t.h - pad * 2) / logo.height);
    ctx.drawImage(
      logo,
      t.x + (t.w - logo.width * k) / 2,
      t.y + (t.h - logo.height * k) / 2,
      logo.width * k,
      logo.height * k
    );
  } else {
    drawFallbackMark(ctx, t.x, t.y, t.w, t.h);
  }

  const tx = t.x + t.w + 62;
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
