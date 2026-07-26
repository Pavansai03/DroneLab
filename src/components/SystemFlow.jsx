import React from "react";
import { SYSTEM_FLOW } from "../data/logicTrees.js";

/**
 * COMPLETE FLIGHT LOGIC (section 13)
 * The end-to-end block diagram, tinted live: each block takes the colour of its
 * component's current verdict, so students can see the chain break in real time.
 */
export default function SystemFlow({ diagnostics, telemetry, frame }) {
  const toneOf = (id) => {
    if (!diagnostics) return "";
    if (id === "mixer") {
      const a = diagnostics.authority;
      if (!a) return "";
      return a.fullAuthority ? "ok" : a.rank >= 3 ? "warn" : "bad";
    }
    if (id === "lift") {
      const thrust = (telemetry?.motorThrust || []).reduce((s, v) => s + v, 0);
      const weight = telemetry?.weightN ?? 0;
      if (!weight) return "";
      return thrust > weight ? "ok" : thrust > weight * 0.7 ? "warn" : "bad";
    }
    if (id === "flight") {
      if (telemetry?.crashed) return "bad";
      if (telemetry?.armed && !telemetry?.onGround) return "ok";
      return diagnostics.readyToFly ? "warn" : "bad";
    }
    if (id === "sensors") return "";
    const r = diagnostics.results[id];
    return r ? r.tone : "";
  };

  const labelOf = (id) => {
    if (id === "esc") return `ESC 1 . . . ${frame.motorCount}`;
    if (id === "motor") return `Motors x ${frame.motorCount}`;
    if (id === "propeller") return `Propellers x ${frame.motorCount}`;
    return null;
  };

  return (
    <div className="flow">
      <div className="tree-title">{SYSTEM_FLOW.title}</div>
      <div className="tree-sub">{SYSTEM_FLOW.subtitle}</div>

      {SYSTEM_FLOW.rows.map((row, i) => (
        <React.Fragment key={row.id}>
          {i > 0 && <div className="flow-arrow">&#8595;</div>}
          {row.kind === "fanout" ? (
            <div className="flow-fan">
              {row.children.map((c) => (
                <div key={c.id} className={`flow-node ${toneOf(c.id)}`}>
                  {c.label}
                </div>
              ))}
            </div>
          ) : (
            <div className={`flow-node ${toneOf(row.id)}`}>
              {labelOf(row.id) || row.label}
            </div>
          )}
        </React.Fragment>
      ))}

      <div className="teach" style={{ marginLeft: 0, marginRight: 0 }}>
        <h4>READ IT LIKE AN ENGINEER</h4>
        <p>
          Power flows down the left of the chain and commands flow down the right. Break
          any single block and everything below it goes dark — which is exactly why a
          drone with a perfect flight controller still will not fly if the PDB has a
          broken output track.
        </p>
        <p className="why">
          The Motor Mixing Algorithm is the only block that can compensate for a failure
          below it, and only if there are spare motors to redistribute to.
        </p>
      </div>
    </div>
  );
}
