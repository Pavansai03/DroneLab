import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { WIRE_COLORS, WIRE_COLOR_LIST } from "../data/wiring.js";
import { Check } from "./Icons.jsx";
import PartArtwork from "./PartArtwork.jsx";

/**
 * THE WIRING DIALOG
 * =================
 * The student picks a wire colour from the palette, then drags from a pin on one
 * component to a pin on another. A connection is only accepted when BOTH the pin
 * pair and the wire colour are right — because on a real drone, putting the red
 * wire where the black one belongs is not a near miss.
 *
 * Wrong attempts are not just rejected: they explain what the mistake would do.
 *
 * LAYOUT
 * ------
 * One column of components down the left, one down the right, and a gutter
 * between them that the wires route through. Both columns share a single CSS grid
 * so their row tracks are the same height — which is what keeps ESC 3 lined up
 * with Motor 3 and its wire horizontal. Giving each column its own grid lets the
 * row heights drift apart and the whole thing turns into a jumble.
 */
export default function WiringDialog({ harness, links, onConnect, onDisconnect, onClose }) {
  const [color, setColor] = useState("red");
  const [drag, setDrag] = useState(null); // { fromCard, fromPin, x, y }
  const [feedback, setFeedback] = useState(null);
  const [hoverWire, setHoverWire] = useState(null);
  const [tick, setTick] = useState(0); // forces a re-measure

  const surfaceRef = useRef(null); // the grid canvas: every coordinate is relative to it
  const gutterRef = useRef(null); // the gap between the columns; wires route through it
  const pinRefs = useRef(new Map());

  /* The pointerup handler is installed while a drag is in flight, so it must read
     the CURRENT colour and link set rather than whatever they were when the drag
     began — otherwise a fresh connection can be misreported as already made. */
  const colorRef = useRef(color);
  const linksRef = useRef(links);
  colorRef.current = color;
  linksRef.current = links;

  const key = (cardId, pinId) => `${cardId}::${pinId}`;

  /* Re-measure pin positions after layout, on resize and on scroll. */
  useLayoutEffect(() => {
    const bump = () => setTick((t) => t + 1);
    bump();
    const ro = new ResizeObserver(bump);
    if (surfaceRef.current) ro.observe(surfaceRef.current);
    window.addEventListener("resize", bump);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", bump);
    };
  }, [harness]);

  const pinPos = useCallback(
    (cardId, pinId) => {
      const el = pinRefs.current.get(key(cardId, pinId));
      const surface = surfaceRef.current;
      if (!el || !surface) return null;
      const r = el.getBoundingClientRect();
      const s = surface.getBoundingClientRect();
      return { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, harness]
  );

  /* ---------------------------------------------------------- interaction */

  const startDrag = (cardId, pinId, e) => {
    e.preventDefault();
    e.stopPropagation();
    const s = surfaceRef.current.getBoundingClientRect();
    setFeedback(null);
    setDrag({
      fromCard: cardId,
      fromPin: pinId,
      x: e.clientX - s.left,
      y: e.clientY - s.top,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      const s = surfaceRef.current?.getBoundingClientRect();
      if (!s) return;
      setDrag((d) => (d ? { ...d, x: e.clientX - s.left, y: e.clientY - s.top } : d));
    };
    const up = (e) => {
      // Prefer a real hit test, but fall back to the nearest pin within reach.
      // The SVG overlay can swallow the hit, and a drop that lands two pixels off
      // a pin should still count.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      let target = el?.closest?.("[data-pin]");

      if (!target) {
        let best = null;
        let bestD = 30; // px tolerance
        pinRefs.current.forEach((node) => {
          const row = node.closest("[data-pin]");
          if (!row) return;
          const r = row.getBoundingClientRect();
          const cx = Math.max(r.left, Math.min(e.clientX, r.right));
          const cy = Math.max(r.top, Math.min(e.clientY, r.bottom));
          const d = Math.hypot(e.clientX - cx, e.clientY - cy);
          if (d < bestD) {
            bestD = d;
            best = row;
          }
        });
        target = best;
      }

      if (target) {
        attempt(drag.fromCard, drag.fromPin, target.dataset.card, target.dataset.pinid);
      } else {
        setFeedback({
          tone: "miss",
          text: "Drop the wire onto a pin — the small pad or socket beside each label.",
        });
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  /** Validate one attempted connection and explain the outcome. */
  function attempt(fromCard, fromPin, toCard, toPin) {
    if (fromCard === toCard && fromPin === toPin) {
      setDrag(null);
      return;
    }

    // Find a wire in this harness that joins these two pins, either direction.
    const match = harness.wires.find((w) => {
      const [fc, fp] = w.from;
      const [tc, tp] = w.to;
      return (
        (fc === fromCard && fp === fromPin && tc === toCard && tp === toPin) ||
        (fc === toCard && fp === toPin && tc === fromCard && tp === fromPin)
      );
    });

    if (!match) {
      // Is either endpoint part of some other wire? Give a targeted hint.
      const expected = harness.wires.find(
        (w) =>
          (w.from[0] === fromCard && w.from[1] === fromPin) ||
          (w.to[0] === fromCard && w.to[1] === fromPin)
      );
      const label = (c, p) => `${cardLabel(c)} ${pinLabel(c, p)}`;
      setFeedback({
        tone: "bad",
        text: expected
          ? `${label(fromCard, fromPin)} does not go to ${label(toCard, toPin)}. It belongs on ${
              expected.from[0] === fromCard && expected.from[1] === fromPin
                ? label(expected.to[0], expected.to[1])
                : label(expected.from[0], expected.from[1])
            }.`
          : `There is no connection between ${label(fromCard, fromPin)} and ${label(
              toCard,
              toPin
            )} on this diagram.`,
        detail: expected?.note,
      });
      return;
    }

    if (linksRef.current.has(match.id)) {
      setFeedback({ tone: "warn", text: "That one is already connected." });
      return;
    }

    if (match.color !== colorRef.current) {
      const right = WIRE_COLORS[match.color];
      const chosen = WIRE_COLORS[colorRef.current];
      setFeedback({
        tone: "bad",
        text: `Right pins, wrong wire. You picked ${chosen.label} (${chosen.meaning}) but this is a ${right.label} wire — ${right.meaning}.`,
        detail: match.note,
      });
      return;
    }

    onConnect(match.id);
    setFeedback({ tone: "ok", text: "Connected.", detail: match.note });
  }

  const cardLabel = (id) =>
    [...harness.leftCards, ...harness.rightCards].find((c) => c.id === id)?.label || id;
  const pinLabel = (cardId, pinId) => {
    const c = [...harness.leftCards, ...harness.rightCards].find((x) => x.id === cardId);
    return c?.pins.find((p) => p.id === pinId)?.label || pinId;
  };

  /* ------------------------------------------------------------- geometry */

  const connected = harness.wires.filter((w) => links.has(w.id));
  const done = connected.length;
  const total = harness.wires.length;

  const rows = Math.max(harness.leftCards.length, harness.rightCards.length);

  /** Where a card sits in the shared grid. A lone card spans every row and centres. */
  const place = (list, i, col) =>
    list.length === 1 && rows > 1
      ? { gridColumn: col, gridRow: `1 / span ${rows}`, alignSelf: "center" }
      : { gridColumn: col, gridRow: i + 1 };

  /**
   * WIRE ROUTING
   * ------------
   * Each wire gets its OWN vertical lane inside the gutter, so no two ever share
   * a segment. Lanes are measured from the real gutter element rather than
   * inferred from the column edges — inferring it is how the wires previously
   * ended up drawn outside the cards altogether.
   */
  const laneX = (index, count) => {
    const g = gutterRef.current;
    const c = surfaceRef.current;
    if (!g || !c) return 0;
    const gr = g.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    const pad = 16;
    const a = gr.left - cr.left + pad;
    const b = gr.right - cr.left - pad;
    if (b <= a) return (gr.left + gr.right) / 2 - cr.left;
    if (count <= 1) return (a + b) / 2;
    return a + ((b - a) * index) / (count - 1);
  };

  const routePath = (a, b, lane) => {
    if (!a || !b) return "";
    // Pins already level: a straight run. Once the rows line up this is the
    // common case, and it is exactly what a real loom looks like.
    if (Math.abs(a.y - b.y) < 1.5) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

    const r = 7;
    const v = b.y > a.y ? 1 : -1;
    return [
      `M ${a.x} ${a.y}`,
      `H ${lane - r}`,
      `Q ${lane} ${a.y} ${lane} ${a.y + v * r}`,
      `V ${b.y - v * r}`,
      `Q ${lane} ${b.y} ${lane + r} ${b.y}`,
      `H ${b.x}`,
    ].join(" ");
  };

  const dragFrom = drag ? pinPos(drag.fromCard, drag.fromPin) : null;

  /* --------------------------------------------------------------- render */

  /** Every wire that touches this card, and how many are made. */
  const cardStatus = (cardId) => {
    const wires = harness.wires.filter((w) => w.from[0] === cardId || w.to[0] === cardId);
    const n = wires.filter((w) => links.has(w.id)).length;
    return { done: n, total: wires.length, complete: wires.length > 0 && n === wires.length };
  };

  const renderCard = (c, side, style) => {
    const st = cardStatus(c.id);
    return (
      <div className={`wd-card ${side} ${st.complete ? "complete" : ""}`} key={c.id} style={style}>
        <div className="wd-card-head">
          <b>{c.label}</b>
          {c.sub && <small>{c.sub}</small>}
          <span className="wd-card-check" title={`${st.done} of ${st.total} connections made`}>
            <Check size={11} />
          </span>
        </div>

        <div className="wd-card-body">
          <div className="wd-art">
            {/* Give a card a `photo` in data/wiring.js to show a picture of your
                own kit instead of the drawing. */}
            <PartArtwork part={c.part} src={c.photo} label={c.label} width={112} height={78} />
          </div>

          <div className="wd-pins">
            {c.pins.map((p) => {
              const wire = harness.wires.find(
                (w) =>
                  (w.from[0] === c.id && w.from[1] === p.id) ||
                  (w.to[0] === c.id && w.to[1] === p.id)
              );
              const isDone = wire && links.has(wire.id);
              return (
                <div
                  key={p.id}
                  className={`wd-pin ${isDone ? "done" : ""}`}
                  data-pin="1"
                  data-card={c.id}
                  data-pinid={p.id}
                  onPointerDown={(e) => startDrag(c.id, p.id, e)}
                  title={p.hint}
                >
                  <span className="wd-pin-label">{p.label}</span>
                  <span
                    className="wd-dot"
                    ref={(el) => {
                      if (el) pinRefs.current.set(key(c.id, p.id), el);
                      else pinRefs.current.delete(key(c.id, p.id));
                    }}
                    style={isDone ? { background: WIRE_COLORS[wire.color].hex } : undefined}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="wd">
        <div className="wd-head">
          <div>
            <h2>{harness.title}</h2>
            <p>{harness.subtitle}</p>
          </div>
          <div className="wd-progress">
            <span className="mono">
              {done}/{total}
            </span>
            <div className="progress-track" style={{ width: 90 }}>
              <div
                className={`progress-fill ${done === total ? "done" : ""}`}
                style={{ width: `${(done / total) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {harness.correction && (
          <div className="wd-correction">
            <b>Note on the reference diagram —</b> {harness.correction}
          </div>
        )}

        <div className="wd-palette">
          <span className="wd-palette-label">Wire:</span>
          {WIRE_COLOR_LIST.map((c) => (
            <button
              key={c.id}
              className={`wd-swatch ${color === c.id ? "on" : ""}`}
              onClick={() => setColor(c.id)}
              title={c.meaning}
            >
              <i style={{ background: c.hex }} />
              {c.label}
            </button>
          ))}
        </div>
        <div className="wd-hint">
          {WIRE_COLORS[color].label} = {WIRE_COLORS[color].meaning}. Drag from a pin on
          one component onto the matching pin on the other.
        </div>

        {/* ---------------- the wiring surface ---------------- */}
        <div className="wd-surface">
          <div className="wd-canvas" ref={surfaceRef}>
            {harness.leftCards.map((c, i) =>
              renderCard(c, "left", place(harness.leftCards, i, 1))
            )}

            {/* A real element for the gap, so lane positions are measured rather
                than guessed from the column edges. */}
            <div
              className="wd-gutter"
              ref={gutterRef}
              style={{ gridColumn: 2, gridRow: `1 / span ${rows}` }}
            />

            {harness.rightCards.map((c, i) =>
              renderCard(c, "right", place(harness.rightCards, i, 3))
            )}

            <svg className="wd-wires">
              {/* A wire keeps its lane whether drawn or not, so it never jumps
                  sideways when a neighbour gets connected. */}
              {harness.wires.map((w, i) => {
                if (!links.has(w.id)) return null;
                const a = pinPos(w.from[0], w.from[1]);
                const b = pinPos(w.to[0], w.to[1]);
                if (!a || !b) return null;
                const d = routePath(a, b, laneX(i, harness.wires.length));
                const hot = hoverWire === w.id;
                return (
                  <g key={w.id}>
                    {/* Dark casing under the coloured core keeps crossings readable
                        and stops a red wire vanishing against another behind it. */}
                    <path
                      d={d}
                      stroke="var(--wire-casing)"
                      strokeWidth={hot ? 8 : 6}
                      fill="none"
                      strokeLinecap="round"
                    />
                    <path
                      d={d}
                      stroke={WIRE_COLORS[w.color].hex}
                      strokeWidth={hot ? 4.5 : 3}
                      fill="none"
                      strokeLinecap="round"
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onPointerEnter={() => setHoverWire(w.id)}
                      onPointerLeave={() => setHoverWire(null)}
                      onClick={() => {
                        onDisconnect(w.id);
                        setFeedback({ tone: "warn", text: "Wire removed." });
                      }}
                    />
                  </g>
                );
              })}

              {drag && dragFrom && (
                <path
                  d={`M ${dragFrom.x} ${dragFrom.y} L ${drag.x} ${drag.y}`}
                  stroke={WIRE_COLORS[color].hex}
                  strokeWidth="3"
                  strokeDasharray="7 5"
                  fill="none"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </div>
        </div>

        <div className={`wd-feedback ${feedback ? feedback.tone : "idle"}`}>
          {feedback ? (
            <>
              <b>{feedback.text}</b>
              {feedback.detail && <span>{feedback.detail}</span>}
            </>
          ) : (
            <span>Click a connected wire to remove it. Hover a pin to see what it does.</span>
          )}
        </div>

        <div className="wd-foot">
          <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>
            {done === total
              ? "Harness complete."
              : `${total - done} connection${total - done === 1 ? "" : "s"} remaining`}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" disabled={done !== total} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
