import React, { useState } from "react";
import { FAILURES } from "../data/curriculum.js";
import { FAILURE_MODEL } from "../data/airframes.js";

/**
 * The fault injector — the teacher's most useful control.
 *
 * Every fault listed here is one of the failure simulations from the module notes.
 * Injecting one immediately re-routes the relevant logic tree, so students can
 * watch a diagram change and then work backwards to the cause.
 */
export default function FaultPanel({
  module,
  frame,
  faults,
  onToggle,
  onClear,
  onRandom,
  onOpenTree,
}) {
  const [openId, setOpenId] = useState(null);
  const [motorTarget, setMotorTarget] = useState(0);

  const ids = module.failures || [];

  return (
    <div>
      <div className="sect-note">
        Inject a fault, then send a student to the logic trees to find it. The tree for
        the affected component will already be showing the failing branch.
      </div>

      <div style={{ display: "flex", gap: 6, padding: "0 8px 8px" }}>
        <button className="btn sm" style={{ flex: 1 }} onClick={onRandom}>
          Inject random fault
        </button>
        <button className="btn sm danger" style={{ flex: 1 }} onClick={onClear}>
          Repair everything
        </button>
      </div>

      <div className="cat-row">Target motor (for per-motor faults)</div>
      <div className="motor-tabs">
        {frame.motors.map((m) => (
          <button
            key={m.index}
            className={`motor-tab ${motorTarget === m.index ? "on" : ""}`}
            onClick={() => setMotorTarget(m.index)}
            title={`${m.position} · ${m.spinLabel}`}
          >
            {m.id}
          </button>
        ))}
      </div>

      <div className="cat-row">Failure simulations — Module {module.number}</div>
      {ids.map((id) => {
        const f = FAILURES[id];
        if (!f) return null;
        const active = faults.some((x) => x.id === id && (!f.perMotor || x.motor === motorTarget));
        return (
          <div key={id}>
            <div
              className={`fault-row ${active ? "on" : ""}`}
              onClick={() => {
                onToggle(id, f.perMotor ? motorTarget : undefined);
                setOpenId(openId === id ? null : id);
              }}
            >
              <span className="fault-name">
                {f.label}
                {f.perMotor && (
                  <span className="mono" style={{ color: "var(--faint)", fontSize: 9.5 }}>
                    {" "}
                    M{motorTarget + 1}
                  </span>
                )}
              </span>
              <span className={`sev ${f.severity}`}>{f.severity.toUpperCase()}</span>
            </div>

            {openId === id && (
              <dl className="fault-detail">
                <dt>EFFECT</dt>
                <dd>{f.effect}</dd>
                <dt>WHAT THE STUDENT SEES</dt>
                <dd>{f.symptom}</dd>
                <dt>CORRECT FIX</dt>
                <dd>{f.fix}</dd>
                {f.tree && (
                  <>
                    <dt>DIAGRAM</dt>
                    <dd>
                      <button
                        className="btn sm"
                        style={{ marginTop: 4 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenTree(f.tree);
                        }}
                      >
                        Open the {f.tree.toUpperCase()} logic tree
                      </button>
                    </dd>
                  </>
                )}
              </dl>
            )}
          </div>
        );
      })}

      <div className="cat-row">
        Multi-rotor failure model &mdash; {frame.label}
      </div>
      <div style={{ padding: "4px 12px 16px" }}>
        {(FAILURE_MODEL[frame.id] || []).map((entry) => (
          <div key={entry.key} style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <b style={{ fontSize: 11.5 }}>{entry.title}</b>
              <span className={`sev ${entry.severity}`}>{entry.severity.toUpperCase()}</span>
            </div>
            <div className="chain">
              {entry.chain.map((c) => (
                <div className="chain-item" key={c}>
                  {c}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
