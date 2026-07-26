import React from "react";
import { AIRFRAME_LIST } from "../data/airframes.js";

/**
 * Choose the airframe. Locked in Modules 1-2 (the course builds a quad first),
 * free from Module 3 onward so students can compare redundancy for themselves.
 */
export default function FramePicker({ frameId, lockedTo, onPick }) {
  return (
    <div>
      <div className="sect-note">
        The number of motors is the single biggest design decision on a drone. It sets
        your redundancy, your payload and your cost.
      </div>
      <div className="frame-picker">
        {AIRFRAME_LIST.map((f) => {
          const locked = lockedTo && lockedTo !== f.id;
          return (
            <button
              key={f.id}
              className={`frame-card ${frameId === f.id ? "on" : ""}`}
              disabled={locked}
              onClick={() => onPick(f.id)}
            >
              <div className="t">
                <b>{f.label}</b>
                <span>{f.motorCount} MOTORS</span>
              </div>
              <p>{f.blurb}</p>
              <span className="redundancy">
                {f.redundantMotors === 0
                  ? "NO REDUNDANCY"
                  : `TOLERATES ${f.redundantMotors} MOTOR FAILURE${
                      f.redundantMotors > 1 ? "S" : ""
                    }`}
              </span>
              <div
                className="mono"
                style={{ fontSize: 9.5, color: "var(--faint)", marginTop: 7 }}
              >
                {f.armLength * 1000} mm arms &middot; {f.dryMassKg} kg dry &middot;{" "}
                {f.recommendedKv} KV &middot; {f.recommendedEscA} A ESC &middot; max{" "}
                {f.maxPayloadKg} kg payload
              </div>
              {locked && (
                <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 6 }}>
                  This module builds a quadcopter. Unlocked from Module 3.
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
