import React from "react";

/**
 * MOTOR ORDER & DIRECTION
 * The inset diagram from the course wiring sheet, drawn live for whichever
 * airframe is selected. Dead motors go red; the nose arrow always points up.
 */
export default function MotorMap({ frame, deadMotors = [], motorOut = [], size = 210 }) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.33;
  const dead = new Set(deadMotors);

  return (
    <div>
      <svg className="motor-map" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Nose marker */}
        <path
          d={`M ${cx} ${cy - R - 26} l 7 12 h -14 z`}
          fill="var(--cyan)"
          opacity="0.9"
        />
        <text
          x={cx}
          y={cy - R - 30}
          textAnchor="middle"
          fill="var(--cyan)"
          fontSize="9"
          fontFamily="JetBrains Mono, monospace"
          letterSpacing="1.4"
        >
          FRONT
        </text>

        {/* Arms */}
        {frame.motors.map((m) => {
          const a = ((m.angle - 90) * Math.PI) / 180;
          const x = cx + Math.cos(a) * R;
          const y = cy + Math.sin(a) * R;
          return (
            <line
              key={`arm${m.index}`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke={dead.has(m.index) ? "var(--red)" : "var(--pad-idle)"}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          );
        })}

        {/* Hub */}
        <circle cx={cx} cy={cy} r={size * 0.075} fill="var(--panel3)" stroke="var(--pad-idle)" strokeWidth="1.5" />

        {/* Motors */}
        {frame.motors.map((m) => {
          const a = ((m.angle - 90) * Math.PI) / 180;
          const x = cx + Math.cos(a) * R;
          const y = cy + Math.sin(a) * R;
          const isDead = dead.has(m.index);
          const isCw = m.spin === 1;
          /* Green for clockwise, blue for counter-clockwise — the colours used on
             the printed wiring sheets. They used to be blue for CW, which put the
             screen and the diagram in direct contradiction on the one detail a
             student is most likely to check between them. */
          const col = isDead ? "var(--red)" : isCw ? "var(--green)" : "var(--info)";
          const out = motorOut[m.index] ?? 0;
          const rMotor = size * 0.072;

          return (
            <g key={m.index}>
              {/* Thrust ring — grows with the motor's live output */}
              {out > 0.01 && (
                <circle
                  cx={x}
                  cy={y}
                  r={rMotor + 3 + out * 9}
                  fill="none"
                  stroke={col}
                  strokeWidth="1.5"
                  opacity="0.35"
                />
              )}
              <circle
                cx={x}
                cy={y}
                r={rMotor}
                fill={isDead ? "rgba(255,92,98,0.18)" : "rgba(255,255,255,0.05)"}
                stroke={col}
                strokeWidth="2"
              />
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                fill={col}
                fontSize="11"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
              >
                {m.index + 1}
              </text>
              {/* Direction arc */}
              <path
                d={arcPath(x, y, rMotor + 6, isCw)}
                fill="none"
                stroke={col}
                strokeWidth="1.6"
                opacity="0.85"
                markerEnd=""
              />
              <text
                x={x + Math.cos(a) * (rMotor + 17)}
                y={y + Math.sin(a) * (rMotor + 17) + 3}
                textAnchor="middle"
                fill={col}
                fontSize="8"
                fontFamily="JetBrains Mono, monospace"
              >
                {m.spinLabel}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="motor-legend">
        <span>
          <i style={{ background: "var(--green)" }} />
          CW
        </span>
        <span>
          <i style={{ background: "var(--info)" }} />
          CCW
        </span>
        {deadMotors.length > 0 && (
          <span>
            <i style={{ background: "var(--red)" }} />
            Failed
          </span>
        )}
      </div>
    </div>
  );
}

/** Three-quarter arc showing rotation sense. */
function arcPath(cx, cy, r, cw) {
  const start = cw ? -140 : -40;
  const end = cw ? 100 : -260;
  const p = (deg) => {
    const a = (deg * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const [x0, y0] = p(start);
  const [x1, y1] = p(end);
  const large = 1;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${cw ? 1 : 0} ${x1} ${y1}`;
}
