import React from "react";
import { MODULES } from "../data/curriculum.js";
import { performanceSummary, BATTERY_SPEC } from "../sim/physics.js";

const M4 = MODULES.find((m) => m.id === "m4");

/**
 * Module 4's environment console. Every slider feeds the real physics model, and
 * the performance block underneath recomputes instantly so students can see the
 * cause and effect for themselves.
 */
export default function EnvironmentPanel({ env, onChange, frame, build, telemetry }) {
  const perf = performanceSummary({
    frame,
    kv: build.motorKv || frame.recommendedKv,
    capacityMah: build.capacityMah || 4200,
    payloadKg: env.payload,
    soc: telemetry?.soc ?? 1,
    env,
  });

  const effects = M4.effects.filter((e) => {
    if (e.id === "strongWind") return env.wind >= 8;
    if (e.id === "heavyPayload") return env.payload >= frame.maxPayloadKg * 0.4;
    if (e.id === "lowBattery") return (telemetry?.soc ?? 1) < 0.25;
    if (e.id === "highTemperature") return env.temperature >= 38;
    if (e.id === "lowTemperature") return env.temperature <= 5;
    if (e.id === "highAltitude") return env.altitude >= 1500;
    return false;
  });

  return (
    <div>
      <div className="sect-note">
        Change a condition and watch the performance figures move. Nothing here is
        cosmetic — these numbers drive the flight model.
      </div>

      {M4.controls.map((c) => (
        <div className="slider-row" key={c.id}>
          <div className="slider-head">
            <b>{c.label}</b>
            <span>
              {Number(env[c.id]).toFixed(c.step < 1 ? 2 : 0)} {c.unit}
            </span>
          </div>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={env[c.id]}
            onChange={(e) => onChange(c.id, Number(e.target.value))}
          />
          <div className="slider-teach">{c.teaches}</div>
        </div>
      ))}

      <div className="cat-row">Predicted performance</div>
      <div className="stat-grid">
        <Stat
          k="Thrust : Weight"
          v={perf.thrustToWeight.toFixed(2)}
          unit="x"
          tone={perf.thrustToWeight > 1.6 ? "ok" : perf.thrustToWeight > 1.15 ? "warn" : "bad"}
        />
        <Stat
          k="Hover throttle"
          v={(perf.hoverThrottle * 100).toFixed(0)}
          unit="%"
          tone={perf.hoverThrottle < 0.55 ? "ok" : perf.hoverThrottle < 0.75 ? "warn" : "bad"}
        />
        <Stat k="All-up mass" v={perf.massKg.toFixed(2)} unit="kg" tone="info" />
        <Stat k="Air density" v={perf.densityPct.toFixed(0)} unit="% ISA" tone="info" />
        <Stat
          k="Hover current"
          v={perf.hoverCurrentA.toFixed(1)}
          unit="A"
          tone={perf.hoverCurrentA > 40 ? "bad" : perf.hoverCurrentA > 25 ? "warn" : "ok"}
        />
        <Stat
          k="Flight time"
          v={perf.flightMinutes.toFixed(1)}
          unit="min"
          tone={perf.flightMinutes > 10 ? "ok" : perf.flightMinutes > 5 ? "warn" : "bad"}
        />
        <Stat k="Wind lean angle" v={perf.windTiltDeg.toFixed(0)} unit="deg" tone={perf.windTiltDeg > 30 ? "bad" : perf.windTiltDeg > 18 ? "warn" : "ok"} />
        <Stat k="Max thrust" v={perf.totalMaxThrustN.toFixed(1)} unit="N" tone="cyan" />
      </div>

      <div className="teach">
        <h4>WHAT THE NUMBERS MEAN</h4>
        <p>{perf.verdict}</p>
        <p className="why">
          Air density is at {perf.densityPct.toFixed(0)}% of sea-level standard, so each
          propeller makes {perf.densityPct.toFixed(0)}% of the thrust it would at sea
          level on a 15 degC day. That is why high-altitude flying needs bigger props or
          more motors.
        </p>
      </div>

      {effects.length > 0 && (
        <>
          <div className="cat-row">Active environment effects</div>
          {effects.map((e) => (
            <div className="check-row" key={e.id}>
              <span className="check-dot fail" />
              <div>
                <div className="check-label">{e.label}</div>
                <div className="check-detail">{e.detail}</div>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="cat-row">Battery reference — 3S Li-Po</div>
      <div style={{ padding: "8px 12px 16px", fontSize: 11, color: "var(--dim)", lineHeight: 1.7 }}>
        <div>Full charge &mdash; <b className="mono">{BATTERY_SPEC.vFull.toFixed(1)} V</b> (4.20 V per cell)</div>
        <div>Nominal &mdash; <b className="mono">{BATTERY_SPEC.vNominal.toFixed(1)} V</b> (3.70 V per cell)</div>
        <div>Land now &mdash; <b className="mono">{BATTERY_SPEC.vCutoff.toFixed(1)} V</b> (3.50 V per cell)</div>
        <div>Cell damage &mdash; <b className="mono">{BATTERY_SPEC.vCritical.toFixed(1)} V</b> (3.30 V per cell)</div>
        <div style={{ marginTop: 8 }}>
          At {env.temperature} degC this pack delivers about{" "}
          <b>{capacityPct(env.temperature).toFixed(0)}%</b> of its rated capacity.
        </div>
      </div>
    </div>
  );
}

function capacityPct(tempC) {
  if (tempC >= 20) return 100;
  return Math.max(55, 100 - (20 - tempC) * 1.2);
}

function Stat({ k, v, unit, tone }) {
  return (
    <div className={`stat ${tone || ""}`}>
      <div className="k">{k}</div>
      <div className="v">
        {v}
        <small>{unit}</small>
      </div>
    </div>
  );
}
