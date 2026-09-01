import React, { useMemo, useState } from "react";
import { PARTS, CATEGORIES, requiredQty, variantsFor } from "../data/parts.js";
import { PART_ICONS, Check, Lock } from "./Icons.jsx";

/**
 * The parts tray. Only the part the current task calls for is draggable — that
 * enforcement is what turns a toy into a build sequence, because on a real drone
 * fitting the propellers before the battery is disconnected is how people get hurt.
 */
export default function PartsLibrary({
  frame,
  module,
  placed,
  activePart,
  variants,
  onVariant,
  onStartDrag,
  onRemove,
}) {
  const [expanded, setExpanded] = useState(null);

  const available = useMemo(() => {
    const ids = module.components?.length
      ? module.components
      : Object.keys(PARTS);
    return ids.filter((id) => PARTS[id]);
  }, [module]);

  const grouped = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      ...cat,
      parts: available.filter((id) => PARTS[id].category === cat.id),
    })).filter((c) => c.parts.length > 0);
  }, [available]);

  if (available.length === 0) {
    return (
      <div className="empty">
        This module adds no new components.
        <br />
        Use the airframe you already built and head for the flight chamber.
      </div>
    );
  }

  const activeDef = activePart ? PARTS[activePart] : null;

  return (
    <>
      {activeDef && (
        <div className="teach">
          <h4>WHY THE {activeDef.label.toUpperCase()}?</h4>
          <p>{activeDef.why}</p>
          <p className="why">{activeDef.teaches}</p>
        </div>
      )}

      <div className="tip">
        Drag the glowing part onto the matching ring on the aircraft. Rings turn{" "}
        <b style={{ color: "var(--green)" }}>green</b> when you are close enough to drop.
      </div>

      {grouped.map((cat) => (
        <div key={cat.id}>
          <div className="cat-row">{cat.label}</div>
          <div className="part-grid">
            {cat.parts.map((id) => {
              const def = PARTS[id];
              const need = requiredQty(def, frame);
              const have = placed[id]?.length || 0;
              const remaining = need - have;
              const isDone = remaining <= 0;
              // Optional extras can be fitted whenever the student likes; everything
              // else must wait its turn in the build order.
              const isActive = !isDone && (id === activePart || def.optional);

              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${def.label}, ${
                    isDone ? "complete" : isActive ? `${remaining} remaining` : "locked"
                  }`}
                  className={`part-tile ${isActive ? "active" : isDone ? "done" : "locked"}`}
                  onPointerDown={(e) => {
                    if (!isActive) return;
                    e.preventDefault();
                    onStartDrag(id, e);
                  }}
                  onClick={() => setExpanded(expanded === id ? null : id)}
                >
                  {!isDone && <div className="part-count mono">{remaining}x</div>}
                  <div className="part-icon">
                    {isDone ? <Check /> : !isActive ? <Lock /> : PART_ICONS[def.icon]}
                  </div>
                  <div className="part-name">{def.label}</div>
                  <div className="part-spec mono">{def.spec}</div>
                </div>
              );
            })}
          </div>

          {/* Variant chooser for whichever tile is expanded */}
          {cat.parts
            .filter((id) => id === expanded && variantsFor(PARTS[id], frame).length > 1)
            .map((id) => {
              const def = PARTS[id];
              /* Only the packs and motors that suit this airframe. A 3S pack on
                 an octocopter browns out on take-off and a 920 KV motor on a 6S
                 pack over-revs the propeller — neither is a trade worth offering. */
              const options = variantsFor(def, frame);
              return (
                <div key={`${id}-var`}>
                  <div className="sect-note">
                    Choose the {def.label.toLowerCase()} variant before you fit it.
                  </div>
                  <div className="variant-row">
                    {options.map((v) => (
                      <button
                        key={v.id}
                        className={`variant-chip ${variants[id] === v.id ? "on" : ""}`}
                        onClick={() => onVariant(id, v.id)}
                      >
                        {v.label}
                        <small>{v.detail}</small>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      ))}

      {Object.values(placed).some((a) => a?.length) && (
        <div style={{ padding: 10 }}>
          <button className="btn wide danger" onClick={onRemove}>
            Strip the airframe and start again
          </button>
        </div>
      )}
    </>
  );
}
