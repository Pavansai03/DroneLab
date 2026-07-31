import React from "react";
import { FLIGHT_FIELDS } from "../three/environments.js";

/**
 * Which world to fly in.
 *
 * The two fields are not cosmetic variants: the forest is open with soft,
 * forgiving obstacles, and the city is full of hard vertical surfaces and moving
 * traffic. Which one a student picks changes how much room for error they have,
 * so the descriptions say that plainly rather than just listing scenery.
 */
export default function FieldPicker({ fieldId, onPick, disabled }) {
  return (
    <div>
      <div className="sect-note">
        Both fields are built to real scale — a storey is 3.2 m, a car is 4.4 m, a
        person is 1.7 m. That is what lets you judge your height by eye instead of
        reading the altimeter.
      </div>

      <div className="frame-picker">
        {FLIGHT_FIELDS.map((f) => (
          <button
            key={f.id}
            className={`frame-card ${fieldId === f.id ? "on" : ""}`}
            onClick={() => onPick(f.id)}
            disabled={disabled}
            title={disabled ? "Land and return to the hangar to change field" : undefined}
          >
            <div className="t">
              <b>{f.label}</b>
              <span>{f.id === "forest" ? "EASIER" : "HARDER"}</span>
            </div>
            <p>{f.blurb}</p>
            <div className="mono" style={{ fontSize: 9.5, color: "var(--faint)", marginTop: 7 }}>
              {f.detail}
            </div>
          </button>
        ))}
      </div>

      {disabled && (
        <div className="tip">
          You are airborne. Head back to the hangar before switching field — the
          scenery is rebuilt from scratch, which would drop the drone mid-flight.
        </div>
      )}
    </div>
  );
}
