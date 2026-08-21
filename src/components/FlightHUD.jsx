import React from "react";
import { BATTERY_SPEC, ESC_LIMIT_C } from "../sim/physics.js";


/** Flight instruments, drawn over the 3D view. */
export default function FlightHUD({ telemetry, diagnostics, frame, keys }) {
  const t = telemetry;
  if (!t) return null;

  const socPct = t.soc * 100;
  const socTone = socPct > 40 ? "ok" : socPct > 20 ? "warn" : "bad";
  const vTone =
    t.voltage >= BATTERY_SPEC.vNominal
      ? "ok"
      : t.voltage >= BATTERY_SPEC.vCutoff
        ? "warn"
        : "bad";
  const tempTone = t.maxEscTemp > ESC_LIMIT_C ? "bad" : t.maxEscTemp > 70 ? "warn" : "ok";

  const modeLabel = {
    disarmed: "DISARMED",
    manual: "MANUAL",
    gps: "GPS",
    poshold: "POSITION HOLD",
    rth: "RETURN TO HOME",
    failsafe: "FAILSAFE",
  }[t.flightMode] || t.flightMode.toUpperCase();

  /* Which leg of the return it is on. Worth naming: the first thing RTH does is
     climb, and an aircraft going UP when the pilot asked it to come home looks
     like a malfunction unless something says otherwise. */
  const rthLeg =
    t.rthActive && t.rthPhase
      ? {
          climb: `CLIMBING TO ${Math.round(t.rthCruiseAlt ?? 0)} M`,
          cruise: "FLYING HOME",
          descend: t.rthHasFix ? "LANDING ON THE PAD" : "LANDING — NO GPS FIX",
        }[t.rthPhase] ?? null
      : null;

  /* The pill mirrors the buzzer exactly — same urgency, same trigger — because a
     build with no buzzer fitted has nothing else to fly by, and two warnings that
     disagreed would be worse than one. Distance is measured to the propeller disc
     and can go slightly negative on contact, so it is clamped before display.  */
  const obstacleWarn =
    t.obstacleUrgency > 0
      ? {
          metres: Math.max(0, t.obstacleDistance).toFixed(1),
          contact: t.obstacleDistance <= 0,
          eta: t.obstacleEta,
          tone: t.obstacleUrgency > 0.55 ? "bad" : "warn",
        }
      : null;

  const modeTone =
    t.flightMode === "failsafe"
      ? "bad"
      : t.flightMode === "rth"
        ? "warn"
        : t.flightMode === "poshold" || t.flightMode === "gps"
          ? "ok"
          : "warn";

  return (
    <>
      <div className="hud top-left">
        <span className={`mode-pill ${t.crashed ? "bad" : modeTone}`}>
          {t.crashed ? "CRASHED" : modeLabel}
        </span>
        {!t.crashed && rthLeg && <span className="mode-pill warn">{rthLeg}</span>}
        {/* The buzzer is the primary proximity warning, but it is silent on a
            build with no buzzer fitted — which is most of Module 1 and 2. This
            pill is what a student without one has to fly by, so it carries the
            same information: what is close, and how close. */}
        {!t.crashed && obstacleWarn && (
          <span className={`mode-pill ${obstacleWarn.tone} proximity`}>
            {obstacleWarn.contact
              ? `IMPACT — ${t.obstacleLabel ?? "obstacle"}`
              : obstacleWarn.eta != null
                ? `PULL UP — ${t.obstacleLabel ?? "obstacle"} in ${obstacleWarn.eta.toFixed(1)}s`
                : `${t.obstacleLabel ?? "OBSTACLE"} ${obstacleWarn.metres} m`}
          </span>
        )}
        {!t.crashed && t.overCeiling && (
          <span className="mode-pill bad proximity">
            ABOVE {t.altitudeLimit} m — LEGAL CEILING
          </span>
        )}
        {t.deadMotors.length > 0 && (
          <span className="mode-pill bad">
            MOTOR{t.deadMotors.length > 1 ? "S" : ""}{" "}
            {t.deadMotors.map((i) => i + 1).join(",")} DEAD
          </span>
        )}
        {diagnostics?.authority && !diagnostics.authority.fullAuthority && (
          <span className="mode-pill bad">
            NO {diagnostics.authority.lostAxes.join("/").toUpperCase()} AUTHORITY
          </span>
        )}
      </div>

      <div className="hud top-right">
        <div className="hud-card">
          <Item k="ALT" v={t.altitude.toFixed(1)} u="m" c="var(--cyan)" />
          <Item k="SPD" v={t.groundSpeed.toFixed(1)} u="m/s" c="var(--amber)" />
          <Item k="V/S" v={t.verticalSpeed.toFixed(1)} u="m/s" c="var(--blue)" />
          <Item k="HDG" v={t.heading.toFixed(0)} u="deg" c="var(--text)" />
        </div>

        <div className="hud-card">
          <Item
            k="BATT"
            v={socPct.toFixed(0)}
            u="%"
            c={socTone === "ok" ? "var(--ok)" : socTone === "warn" ? "var(--warn)" : "var(--bad)"}
          />
          <Item
            k="VOLTS"
            v={t.voltage.toFixed(2)}
            u="V"
            c={vTone === "ok" ? "var(--ok)" : vTone === "warn" ? "var(--warn)" : "var(--bad)"}
          />
          <Item k="AMPS" v={t.currentA.toFixed(1)} u="A" c="var(--violet)" />
          <Item
            k="ESC MAX"
            v={t.maxEscTemp.toFixed(0)}
            u="degC"
            c={tempTone === "ok" ? "var(--ok)" : tempTone === "warn" ? "var(--warn)" : "var(--bad)"}
          />
        </div>

        <div className="hud-card">
          <Item
            k="SATS"
            v={t.satellites}
            u=""
            c={t.satellites >= 8 ? "var(--ok)" : t.satellites > 0 ? "var(--warn)" : "var(--bad)"}
          />
          <Item k="GATES" v={`${t.gatesPassed}/${t.gatesTotal}`} u="" c="var(--amber)" />
          <Item k="DIST" v={t.distanceFlown.toFixed(0)} u="m" c="var(--text)" />
        </div>

        {/* Per-motor thrust bars — the mixer made visible */}
        <div className="hud-card" style={{ flexDirection: "column", gap: 5 }}>
          <div className="hud-item">
            <div className="k">MOTOR OUTPUT</div>
          </div>
          {frame.motors.map((m) => {
            const out = t.motorOut[m.index] ?? 0;
            const thrust = t.motorThrust[m.index] ?? 0;
            const isDead = t.deadMotors.includes(m.index);
            const negative = thrust < -0.01;
            return (
              <div
                key={m.index}
                style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 168 }}
              >
                <span
                  className="mono"
                  style={{ fontSize: 9.5, width: 20, color: "var(--dim)" }}
                >
                  {m.id}
                </span>
                <div className="bar" style={{ flex: 1, marginTop: 0 }}>
                  <i
                    style={{
                      width: `${Math.min(100, Math.abs(out) * 100)}%`,
                      background: isDead
                        ? "var(--faint)"
                        : negative
                          ? "var(--red)"
                          : m.spin === 1
                            ? "var(--info)"
                            : "var(--amber)",
                    }}
                  />
                </div>
                <span
                  className="mono"
                  style={{
                    fontSize: 9.5,
                    width: 40,
                    textAlign: "right",
                    color: negative ? "var(--red)" : "var(--dim)",
                  }}
                >
                  {thrust.toFixed(1)}N
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="keycaps">
        <Cap on={keys.KeyW}>W <b>forward</b></Cap>
        <Cap on={keys.KeyS}>S <b>back</b></Cap>
        <Cap on={keys.KeyA || keys.ArrowLeft}>A / &larr; <b>turn LEFT</b></Cap>
        <Cap on={keys.KeyD || keys.ArrowRight}>D / &rarr; <b>turn RIGHT</b></Cap>
        <Cap on={keys.KeyQ}>Q <b>slide L</b></Cap>
        <Cap on={keys.KeyE}>E <b>slide R</b></Cap>
        <Cap on={keys.Space}>SPACE <b>up</b></Cap>
        <Cap on={keys.KeyZ}>Z <b>down</b></Cap>
      </div>
    </>
  );
}

function Item({ k, v, u, c }) {
  return (
    <div className="hud-item">
      <div className="k">{k}</div>
      <div className="v" style={{ color: c }}>
        {v}
        {u && <small> {u}</small>}
      </div>
    </div>
  );
}

function Cap({ children, on }) {
  return <span className={`keycap ${on ? "on" : ""}`}>{children}</span>;
}
