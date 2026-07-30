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
 */
export default function WiringDialog({ harness, links, onConnect, onDisconnect, onClose }) {
  const [color, setColor] = useState("red");
  const [drag, setDrag] = useState(null); // { fromCard, fromPin, x, y }
  const [feedback, setFeedback] = useState(null);
  const [hoverWire, setHoverWire] = useState(null);
  const [tick, setTick] = useState(0); // forces a re-measure

  const surfaceRef = useRef(null);
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
      // The SVG wire overlay and the scrolling surface can both swallow the hit,
      // and a drop that lands two pixels off a pin should still count.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      let target = el?.closest?.("[data-pin]");

      if (!target) {
        let best = null;
        let bestD = 30; // px tolerance
        pinRefs.current.forEach((node, k) => {
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
          text: "Drop the wire onto a pin. Pins are the small circles beside each label.",
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
    setFeedback({ tone: "ok", text: `Connected.`, detail: match.note });
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

  /**
   * WIRE ROUTING
   * ------------
   * Every wire gets its OWN vertical lane in the gutter between the columns, so
   * no two wires ever share a segment. A bundle of curves that all sweep through
   * the same space is impossible to trace with your eye — which defeats the point
   * of drawing them at all.
   *
   * Route: out of the pin horizontally -> along a private lane vertically ->
   * into the target pin horizontally, with rounded corners.
   */
  const laneX = (index, count) => {
    const s = surfaceRef.current;
    if (!s) return 0;
    // Gutter is the space between the two card columns.
    const cols = s.querySelectorAll(".wd-col");
    const sr = s.getBoundingClientRect();
    const leftEdge = cols[0] ? cols[0].getBoundingClientRect().right - sr.left : sr.width * 0.35;
    const rightEdge = cols[1] ? cols[1].getBoundingClientRect().left - sr.left : sr.width * 0.65;
    const pad = 18;
    const a = leftEdge + pad;
    const b = rightEdge - pad;
    if (count <= 1) return (a + b) / 2;
    return a + ((b - a) * index) / (count - 1);
  };

  const routePath = (a, b, lane) => {
    if (!a || !b) return "";
    const r = 7;
    // Straight through when the pins already line up.
    if (Math.abs(a.y - b.y) < 1.5) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

    const v = b.y > a.y ? 1 : -1;
    const c1y = a.y + v * r;
    const c2y = b.y - v * r;
    return [
      `M ${a.x} ${a.y}`,
      `H ${lane - r}`,
      `Q ${lane} ${a.y} ${lane} ${c1y}`,
      `V ${c2y}`,
      `Q ${lane} ${b.y} ${lane + r} ${b.y}`,
      `H ${b.x}`,
    ].join(" ");
  };

  const dragFrom = drag ? pinPos(drag.fromCard, drag.fromPin) : null;

  /* --------------------------------------------------------------- render */

  /** Every wire that touches this card, and how many are made. */
  const cardStatus = (cardId) => {
    const wires = harness.wires.filter(
      (w) => w.from[0] === cardId || w.to[0] === cardId
    );
    const done = wires.filter((w) => links.has(w.id)).length;
    return { done, total: wires.length, complete: wires.length > 0 && done === wires.length };
  };

  /**
   * A component card: the part's picture, with its pins on the edge that faces
   * the other column — so a wire leaves the pin and heads straight across the
   * gap, the way it does on a bench.
   */
  const renderCard = (c, side) => {
    const st = cardStatus(c.id);
    return (
      <div className={`wd-card ${side} ${st.complete ? "complete" : ""}`} key={c.id}>
        <div className="wd-card-head">
          <b>{c.label}</b>
          {c.sub && <small>{c.sub}</small>}
          <span className="wd-card-check" title={`${st.done} of ${st.total} connections made`}>
            <Check size={11} />
          </span>
        </div>

        <div className="wd-card-body">
          <div className="wd-art">
            {/* Swap in a photo of your own kit by giving the part a `photo` in
                the harness definition. */}
            <PartArtwork part={c.part} src={c.photo} label={c.label} width={132} height={94} />
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
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
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

        {/* ---------------- wire colour palette ---------------- */}
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
        <div className="wd-surface" ref={surfaceRef}>
          {/* Columns with many cards wrap into a grid, otherwise an octocopter's
              eight ESCs would run off the bottom and become undraggable. */}
          <div className={`wd-col left ${harness.leftCards.length > 2 ? "grid" : ""}`}>
            {harness.leftCards.map((c) => renderCard(c, "left"))}
          </div>
          <div className={`wd-col right ${harness.rightCards.length > 2 ? "grid" : ""}`}>
            {harness.rightCards.map((c) => renderCard(c, "right"))}
          </div>

          <svg className="wd-wires">
            {/* Each wire keeps the same lane whether it is drawn or not, so a
                wire does not jump sideways when a neighbour is connected. */}
            {harness.wires.map((w, i) => {
              if (!links.has(w.id)) return null;
              const a = pinPos(w.from[0], w.from[1]);
              const b = pinPos(w.to[0], w.to[1]);
              if (!a || !b) return null;
              const lane = laneX(i, harness.wires.length);
              const hot = hoverWire === w.id;
              return (
                <g key={w.id}>
                  {/* Dark casing under the coloured core: makes crossings readable
                      and stops a red wire vanishing against a red one behind it. */}
                  <path
                    d={routePath(a, b, lane)}
                    stroke="#0a0d12"
                    strokeWidth={hot ? 8 : 6}
                    fill="none"
                    strokeLinecap="round"
                  />
                  <path
                    d={routePath(a, b, lane)}
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
                  {hot && (
                    <circle cx={lane} cy={(a.y + b.y) / 2} r="9" fill="#0a0d12" stroke={WIRE_COLORS[w.color].hex} />
                  )}
                  {hot && (
                    <text
                      x={lane}
                      y={(a.y + b.y) / 2 + 3.5}
                      textAnchor="middle"
                      fill={WIRE_COLORS[w.color].hex}
                      fontSize="9"
                      fontFamily="monospace"
                      style={{ pointerEvents: "none" }}
                    >
                      x
                    </text>
                  )}
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

        {/* ---------------- feedback ---------------- */}
        <div className={`wd-feedback ${feedback ? feedback.tone : "idle"}`}>
          {feedback ? (
            <>
              <b>{feedback.text}</b>
              {feedback.detail && <span>{feedback.detail}</span>}
            </>
          ) : (
            <span>
              Click a connected wire to remove it. Hover a pin to see what it does.
            </span>
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
          <button
            className="btn primary"
            disabled={done !== total}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
