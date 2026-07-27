import React from "react";
import { AIRFRAMES } from "../data/airframes.js";

/**
 * Airframe selection.
 *
 * The course builds a quadcopter, so that is the single option and it is selected
 * by default. The mixer, failure model and physics are all written for N rotors, so
 * re-introducing larger airframes later is a data change rather than a code change.
 */
export default function FramePicker({ frameId, onPick }) {
  const f = AIRFRAMES.quad;

  return (
    <div>
      <div className="sect-note">
        This build is a quadcopter: four motors in an X, with the diagonal pairs
        spinning the same way so their torques cancel.
      </div>

      <div className="frame-picker">
        <button
          className={`frame-card ${frameId === f.id ? "on" : ""}`}
          onClick={() => onPick(f.id)}
        >
          <div className="t">
            <b>{f.label}</b>
            <span>{f.motorCount} MOTORS</span>
          </div>
          <p>{f.blurb}</p>
          <span className="redundancy">NO REDUNDANCY</span>
          <div
            className="mono"
            style={{ fontSize: 9.5, color: "var(--faint)", marginTop: 7 }}
          >
            {f.armLength * 1000} mm arms &middot; {f.dryMassKg} kg dry &middot;{" "}
            {f.recommendedKv} KV &middot; {f.recommendedEscA} A ESC &middot; max{" "}
            {f.maxPayloadKg} kg payload
          </div>
        </button>
      </div>

      <div className="teach" style={{ marginTop: 0 }}>
        <h4>MOTOR ORDER &amp; DIRECTION</h4>
        <p>
          M1 front right (CW), M2 rear right (CCW), M3 rear left (CW), M4 front left
          (CCW) — exactly as the wiring diagram specifies.
        </p>
        <p className="why">
          The diagonal pairs share a direction. That is what cancels the yaw torque in
          a hover, and it is also how the flight controller steers in yaw: it simply
          lets one diagonal pair win.
        </p>
      </div>
    </div>
  );
}
