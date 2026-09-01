import React from "react";
import { AIRFRAME_LIST } from "../data/airframes.js";

/**
 * A compact airframe chooser for the working panels.
 *
 * The full cards live on the Airframe tab, where a student picks a copter by
 * reading about it. This is the other half of that: once you are deep in the
 * tasks, the parts tray, the wiring bench or the health panel, switching copter
 * should not mean walking back to a different tab and losing your place. Every
 * one of those panels shows something that genuinely differs per airframe — six
 * task ticks instead of four, six ESC harnesses, a different hover trim — so the
 * dropdown is not navigation, it is the control for what the panel is about.
 *
 * Switching parks the current aircraft and brings out the other one exactly as
 * it was left; see sim/workspaces.js. `onPick` still confirms first, because
 * the whole workspace changing under someone who brushed the scroll wheel is
 * disorienting even when nothing is lost.
 */
export default function AirframeSelect({ frameId, onPick, disabled, label = "Airframe" }) {
  return (
    <label className="airframe-select">
      <span>{label}</span>
      <select
        value={frameId}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value !== frameId) onPick(e.target.value);
        }}
        title={
          disabled
            ? "Land first — the airframe cannot be changed in flight"
            : "Switch airframe. Your current build is parked and waiting when you come back."
        }
      >
        {AIRFRAME_LIST.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label} — {f.motorCount} motors
          </option>
        ))}
      </select>
    </label>
  );
}
