import React, { useMemo, useState } from "react";
import {
  buildWiringSpec,
  WIRE_COLORS,
  CONNECTION_SUMMARY,
  PREFLIGHT_NOTES,
} from "../data/wiring.js";
import { Check } from "./Icons.jsx";

/**
 * The wiring bench. Every link from the course wiring diagram, generalised to the
 * chosen airframe. Clicking a row makes or breaks that connection, and the note
 * explains what happens on a real drone if you get it wrong.
 */
export default function WiringBench({
  frame,
  links,
  placed,
  componentSet,
  onToggle,
  onConnectAll,
}) {
  const [openId, setOpenId] = useState(null);
  const spec = useMemo(
    () => buildWiringSpec(frame, { components: componentSet }),
    [frame, componentSet]
  );

  const groups = useMemo(() => {
    const order = ["power", "propulsion", "control", "navigation"];
    const labels = {
      power: "Power path — battery to everything",
      propulsion: "Propulsion — ESC to motor phases",
      control: "Control — flight controller signals",
      navigation: "Navigation — optional but needed for GPS modes",
    };
    return order
      .map((g) => ({
        id: g,
        label: labels[g],
        // Hide links whose components this module has not introduced yet.
        rows: spec.filter((l) => l.group === g && l.available !== false),
      }))
      .filter((g) => g.rows.length);
  }, [spec]);

  /** A link can only be made if both ends are actually fitted. */
  const endpointsPresent = (link) => {
    const partFor = (node) => {
      if (node.startsWith("esc")) return "esc";
      if (node.startsWith("motor")) return "motor";
      return node;
    };
    const ok = (node) => {
      const p = partFor(node);
      if (p === "pdb" && !placed.pdb?.length) {
        // Modules 1-2 have no PDB; treat the battery lead as the distribution point
        return Boolean(placed.battery?.length);
      }
      return Boolean(placed[p]?.length);
    };
    return ok(link.from) && ok(link.to);
  };

  const requiredDone = spec.filter((l) => l.required && links.has(l.id)).length;
  const requiredTotal = spec.filter((l) => l.required).length;

  return (
    <div>
      <div className="panel-head" style={{ borderTop: "1px solid var(--border)" }}>
        <h3>Loom {requiredDone}/{requiredTotal} required</h3>
        <div className="progress-track">
          <div
            className={`progress-fill ${requiredDone === requiredTotal ? "done" : ""}`}
            style={{ width: `${(requiredDone / Math.max(1, requiredTotal)) * 100}%` }}
          />
        </div>
      </div>

      <div className="sect-note">
        Follow the connection summary: {CONNECTION_SUMMARY[0]}. Tap a row to solder or
        unsolder it.
      </div>

      <div className="wire-bench">
        {groups.map((g) => (
          <div className="wire-group" key={g.id}>
            <div className="wire-group-title">{g.label}</div>
            {g.rows.map((link) => {
              const connected = links.has(link.id);
              const canWire = endpointsPresent(link);
              const missing = link.required && !connected;
              return (
                <div key={link.id}>
                  <div
                    className={`wire-row ${connected ? "connected" : ""} ${
                      missing ? "required-missing" : ""
                    }`}
                    style={{ opacity: canWire ? 1 : 0.45 }}
                    onClick={() => {
                      if (!canWire) return;
                      onToggle(link.id);
                      setOpenId(openId === link.id ? null : link.id);
                    }}
                    title={canWire ? link.note : "Fit both components first"}
                  >
                    <span
                      className="wire-swatch"
                      style={{ background: WIRE_COLORS[link.color].hex }}
                    />
                    <div className="wire-main">
                      <div className="wire-path">
                        {label(link.from)} &rarr; {label(link.to)}
                      </div>
                      <div className="wire-ports">
                        {link.fromPort} &middot; {link.toPort}
                        {!link.required && <span className="opt-flag"> OPTIONAL</span>}
                      </div>
                      {openId === link.id && <div className="wire-note">{link.note}</div>}
                    </div>
                    <span className="wire-check">
                      <Check size={12} />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <button className="btn wide" onClick={onConnectAll}>
          Auto-wire the whole loom (teacher shortcut)
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

      <div className="cat-row">Notes before every flight</div>
      <div style={{ padding: "8px 12px 14px" }}>
        {PREFLIGHT_NOTES.map((n) => (
          <div
            key={n}
            style={{
              fontSize: 11,
              color: "var(--dim)",
              lineHeight: 1.6,
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

function label(node) {
  if (node.startsWith("esc")) return `ESC ${Number(node.slice(3)) + 1}`;
  if (node.startsWith("motor")) return `M${Number(node.slice(5)) + 1}`;
  const map = {
    battery: "BATT",
    pdb: "PDB",
    fc: "FC",
    receiver: "RX",
    gps: "GPS",
    compass: "MAG",
  };
  return map[node] || node.toUpperCase();
}
