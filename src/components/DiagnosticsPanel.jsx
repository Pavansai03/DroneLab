import React from "react";
import { LOGIC_TREES } from "../data/logicTrees.js";
import MotorMap from "./MotorMap.jsx";

const TREE_ORDER = [
  "battery",
  "pdb",
  "fc",
  "esc",
  "motor",
  "propeller",
  "gps",
  "transmitter",
  "receiver",
  "imu",
  "compass",
  "barometer",
];

/**
 * The health board. Every component's tree verdict in one column, plus the
 * pre-flight checklist and — when motors are dead — the multi-rotor failure model
 * from section 14 of the course notes.
 */
export default function DiagnosticsPanel({ diagnostics, telemetry, frame, onOpenTree }) {
  if (!diagnostics) return <div className="empty">Build something first.</div>;

  const { results, preflight, failureClass, authority, deadMotors } = diagnostics;

  return (
    <div>
      {/* ---------- flight mode ---------- */}
      <div style={{ padding: "10px 12px 4px" }}>
        <span className={`mode-pill ${diagnostics.flightMode.tone}`}>
          {diagnostics.flightMode.label}
        </span>
      </div>

      {/* ---------- motor map ---------- */}
      <MotorMap
        frame={frame}
        deadMotors={deadMotors}
        motorOut={telemetry?.motorOut || []}
      />

      {/* ---------- multi-rotor failure model ---------- */}
      {failureClass && (
        <div className="fault-detail" style={{ marginTop: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <b style={{ fontSize: 12 }}>
              {frame.label.toUpperCase()} &middot; {failureClass.title}
            </b>
            <span className={`sev ${failureClass.severity}`}>
              {failureClass.severity.toUpperCase()}
            </span>
          </div>
          <div className="chain">
            {failureClass.chain.map((c) => (
              <div className="chain-item" key={c}>
                {c}
              </div>
            ))}
          </div>
          {authority && (
            <>
              <div
                className="mono"
                style={{ fontSize: 10, color: "var(--dim)", marginTop: 8 }}
              >
                MIXER RANK {authority.rank}/4 &middot; LOAD SPREAD{" "}
                {authority.loadSpread}x &middot; THRUST MARGIN{" "}
                {authority.margin?.toFixed(2)}x
              </div>
              <div
                style={{
                  fontSize: 11,
                  marginTop: 5,
                  lineHeight: 1.5,
                  color: authority.fullAuthority ? "var(--ok)" : "var(--bad)",
                }}
              >
                {authority.note}
              </div>
              <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 5 }}>
                This verdict is computed from the mixer maths, independently of the
                table above. When the two agree, the theory has been confirmed by the
                simulation.
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------- component verdicts ---------- */}
      <div className="cat-row">Component logic — live verdicts</div>
      {TREE_ORDER.map((id) => {
        const r = results[id];
        if (!r) return null;
        return (
          <div
            className="check-row"
            key={id}
            style={{ cursor: "pointer" }}
            onClick={() => onOpenTree(id)}
            title="Open this decision tree"
          >
            <span className={`check-dot ${r.tone === "ok" ? "pass" : r.tone === "warn" ? "opt" : "fail"}`} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="check-label">{LOGIC_TREES[id].title.replace(" Logic", "")}</div>
              <div
                className="check-detail"
                style={{
                  color:
                    r.tone === "ok"
                      ? "var(--ok)"
                      : r.tone === "warn"
                        ? "var(--warn)"
                        : "var(--bad)",
                }}
              >
                {r.text}
              </div>
            </div>
          </div>
        );
      })}

      {/* ---------- pre-flight ---------- */}
      <div className="cat-row">Pre-flight check</div>
      {preflight.map((c) => (
        <div className="check-row" key={c.id}>
          <span
            className={`check-dot ${
              c.pass ? "pass" : c.required === false ? "opt" : "fail"
            }`}
          />
          <div>
            <div className="check-label">{c.label}</div>
            <div className="check-detail">{c.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
