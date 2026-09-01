import React from "react";
import { AIRFRAME_LIST } from "../data/airframes.js";

/**
 * Airframe selection.
 *
 * The mixer, failure model, physics, wiring loom and 3D geometry are all written
 * for N rotors, so all three airframes are genuinely simulated rather than being
 * a quadcopter with extra arms drawn on: a hexacopter really does survive a motor
 * failure the quad cannot, because the mixer really does re-solve the hover trim.
 *
 * Changing airframe strips the build. That is not a limitation, it is the truth —
 * the arms, the pack and the motors are all different parts, and pretending a
 * half-built quad can become a half-built octo would teach the wrong thing. The
 * caller confirms before it happens.
 */
export default function FramePicker({ frameId, onPick }) {
  return (
    <div>
      <div className="sect-note">
        Pick the airframe you are building. More motors means more lift and more
        redundancy, but also more mass, more current and a bigger battery — which
        is the trade every real drone designer starts from.
      </div>

      <div className="frame-picker">
        {AIRFRAME_LIST.map((f) => {
          const pack = f.recommendedPack;
          return (
            <button
              key={f.id}
              className={`frame-card ${frameId === f.id ? "on" : ""}`}
              onClick={() => onPick(f.id)}
              aria-pressed={frameId === f.id}
            >
              <div className="t">
                <b>{f.label}</b>
                <span>{f.motorCount} MOTORS</span>
              </div>
              <p>{f.blurb}</p>
              <span className="redundancy">
                {f.redundantMotors === 0
                  ? "NO REDUNDANCY"
                  : `SURVIVES ${f.redundantMotors} MOTOR FAILURE${f.redundantMotors > 1 ? "S" : ""}`}
              </span>
              <div
                className="mono"
                style={{ fontSize: 9.5, color: "var(--faint)", marginTop: 7 }}
              >
                {f.armLength * 1000} mm arms &middot; {f.dryMassKg} kg dry &middot;{" "}
                {f.recommendedKv} KV &middot; {f.recommendedEscA} A ESC &middot;{" "}
                {pack.cells}S {pack.capacityMah} mAh &middot; max {f.maxPayloadKg} kg
                payload
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
