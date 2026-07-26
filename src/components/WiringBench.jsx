import React, { useMemo } from "react";
import {
  wiringStatus,
  WIRE_COLORS,
  CONNECTION_SUMMARY,
  PREFLIGHT_NOTES,
} from "../data/wiring.js";
import { Check } from "./Icons.jsx";

/**
 * The wiring bench lists the looms this build needs. Opening one launches the
 * wiring dialog, where the student picks a wire colour and drags it pin to pin.
 */
export default function WiringBench({
  frame,
  links,
  placed,
  componentSet,
  onOpenHarness,
  onConnectAll,
}) {
  const status = useMemo(
    () => wiringStatus(frame, componentSet, links),
    [frame, componentSet, links]
  );

  /** A harness can only be wired once every component it touches is fitted. */
  const missingParts = (h) => {
    const cards = [...h.leftCards, ...h.rightCards];
    const needed = new Set(cards.map((c) => c.part));
    return [...needed].filter((p) => !(placed[p]?.length > 0));
  };

  const groups = useMemo(() => {
    const labels = {
      power: "Power path — battery to everything",
      propulsion: "Propulsion — ESC to motor phases",
      control: "Control — signals and radio",
      navigation: "Navigation — optional, needed for GPS modes",
    };
    return ["power", "propulsion", "control", "navigation"]
      .map((g) => ({
        id: g,
        label: labels[g],
        rows: status.harnesses.filter((h) => h.group === g),
      }))
      .filter((g) => g.rows.length);
  }, [status]);

  return (
    <div>
      <div className="panel-head" style={{ borderTop: "1px solid var(--border)" }}>
        <h3>
          Loom {status.requiredDone}/{status.requiredTotal} required
        </h3>
        <div className="progress-track">
          <div
            className={`progress-fill ${status.allRequiredDone ? "done" : ""}`}
            style={{
              width: `${(status.requiredDone / Math.max(1, status.requiredTotal)) * 100}%`,
            }}
          />
        </div>
      </div>

      <div className="sect-note">
        Open a loom to wire it. You pick the wire colour, then drag from a pin on one
        component to the matching pin on the other — the same way you would with a real
        loom on the bench.
      </div>

      {groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 10 }}>
          <div className="cat-row">{g.label}</div>
          {g.rows.map((h) => {
            const missing = missingParts(h);
            const blocked = missing.length > 0;
            return (
              <div
                key={h.id}
                className={`harness-row ${h.complete ? "complete" : ""} ${
                  blocked ? "blocked" : ""
                }`}
                onClick={() => !blocked && onOpenHarness(h.id)}
                title={
                  blocked
                    ? `Fit the ${missing.join(", ")} first`
                    : "Open this loom and wire it"
                }
              >
                <span className="wire-check" style={{ opacity: h.complete ? 1 : 0.35 }}>
                  <Check size={12} />
                </span>
                <div className="harness-main">
                  <div className="harness-title">
                    {h.title}
                    {!h.required && <span className="opt-flag"> OPTIONAL</span>}
                  </div>
                  <div className="harness-sub">
                    {blocked ? `Fit the ${missing.join(", ")} first` : h.subtitle}
                  </div>
                </div>
                <span className="harness-count">
                  {h.done}/{h.total}
                </span>
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ padding: "0 8px 10px" }}>
        <button className="btn wide" onClick={onConnectAll}>
          Auto-wire everything (teacher shortcut)
        </button>
      </div>

      <div className="cat-row">Wire colour guide</div>
      <div className="color-key">
        {Object.entries(WIRE_COLORS).map(([k, v]) => (
          <div key={k}>
            <i style={{ background: v.hex }} />
            {v.label} — {v.meaning}
          </div>
        ))}
      </div>

      <div className="cat-row">Connection summary</div>
      <div style={{ padding: "8px 12px" }}>
        {CONNECTION_SUMMARY.map((c) => (
          <div
            key={c}
            style={{
              fontSize: 11,
              color: "var(--dim)",
              lineHeight: 1.65,
              display: "flex",
              gap: 7,
            }}
          >
            <span style={{ color: "var(--ok)" }}>&#10003;</span>
            {c}
          </div>
        ))}
      </div>

      <div className="cat-row">Notes before every flight</div>
      <div style={{ padding: "8px 12px 16px" }}>
        {PREFLIGHT_NOTES.map((n) => (
          <div
            key={n}
            style={{
              fontSize: 11,
              color: "var(--dim)",
              lineHeight: 1.65,
              display: "flex",
              gap: 7,
            }}
          >
            <span style={{ color: "var(--amber)" }}>&bull;</span>
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}
