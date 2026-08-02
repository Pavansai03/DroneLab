/**
 * DRONE ARTWORK
 * =============
 * Every drone on this site is drawn here, as vector art, rather than
 * photographed or downloaded.
 *
 * That is a deliberate choice, not a limitation. Stock photography would mean
 * either paying for licences forever or quietly using images belonging to
 * somebody else; and a photograph of a DJI Mavic sitting above a page about
 * building your own 450-class quadcopter teaches the wrong thing. These are
 * drawn to match the aircraft students actually assemble in the simulator —
 * four arms, exposed electronics, a visible flight controller.
 *
 * Vectors also stay sharp on a projector at the front of a classroom, animate
 * without a video file, recolour with the theme, and add about 4 kB to the page
 * instead of two megabytes.
 */

/* ------------------------------------------------------------------ hero */
/**
 * A quadcopter seen from three-quarters above — the angle that reads as "drone"
 * fastest, because you can see all four rotors at once and the body still has
 * depth. Propellers spin via CSS, so the page is alive without a video.
 */
export function HeroDrone({ className = "" }) {
  const arm = (rot, key) => (
    <g key={key} transform={`rotate(${rot} 200 150)`}>
      {/* arm */}
      <rect x="196" y="60" width="8" height="92" rx="4" fill="url(#armGrad)" />
      {/* motor bell */}
      <ellipse cx="200" cy="62" rx="17" ry="10" fill="#2a3140" />
      <ellipse cx="200" cy="58" rx="17" ry="10" fill="url(#motorGrad)" />
      <ellipse cx="200" cy="57" rx="7" ry="4" fill="#0e1219" />
      {/* propeller disc — the blur a spinning prop actually makes */}
      <g className="prop">
        <ellipse cx="200" cy="53" rx="62" ry="15" fill="url(#propGrad)" opacity="0.34" />
        <ellipse cx="200" cy="53" rx="62" ry="15" fill="none" stroke="var(--accent)" strokeWidth="1" opacity="0.5" />
      </g>
    </g>
  );

  return (
    <svg viewBox="0 0 400 300" className={className} role="img" aria-label="Quadcopter">
      <defs>
        <linearGradient id="armGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3c4657" />
          <stop offset="100%" stopColor="#232a36" />
        </linearGradient>
        <linearGradient id="motorGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6e7b8f" />
          <stop offset="100%" stopColor="#39424f" />
        </linearGradient>
        <radialGradient id="propGrad">
          <stop offset="40%" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.9" />
        </radialGradient>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2b3342" />
          <stop offset="100%" stopColor="#161c26" />
        </linearGradient>
        <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ground shadow, so it reads as hovering rather than floating in a void */}
      <ellipse cx="200" cy="258" rx="86" ry="13" fill="#000" opacity="0.35" />

      <g className="drone-body">
        {[45, 135, 225, 315].map((r, i) => arm(r, i))}

        {/* centre stack: battery under, frame plate, flight controller on top */}
        <rect x="168" y="128" width="64" height="46" rx="9" fill="url(#bodyGrad)" />
        <rect x="174" y="134" width="52" height="12" rx="3" fill="#3d4757" />
        <rect x="176" y="152" width="48" height="18" rx="3" fill="#11161e" />
        {/* FC status LEDs */}
        <circle cx="186" cy="161" r="3.2" fill="var(--accent)" filter="url(#glow)" />
        <circle cx="200" cy="161" r="3.2" fill="#ffab4a" opacity="0.85" />
        <circle cx="214" cy="161" r="3.2" fill="#ff5c62" className="blink" />
        {/* GPS mast */}
        <rect x="198.5" y="112" width="3" height="18" fill="#4a5464" />
        <circle cx="200" cy="110" r="7" fill="#59637a" />
        <circle cx="200" cy="110" r="3" fill="var(--accent)" opacity="0.8" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------- silhouettes */
/**
 * A flat top-down silhouette, for scattering across a background at low
 * opacity. Deliberately simple: at 40px and 8% opacity, detail is wasted bytes.
 */
export function DroneMark({ size = 40, className = "", style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <g fill="currentColor">
        <rect x="29" y="22" width="6" height="20" rx="3" transform="rotate(45 32 32)" />
        <rect x="29" y="22" width="6" height="20" rx="3" transform="rotate(-45 32 32)" />
        <rect x="24" y="24" width="16" height="16" rx="4" />
        {[
          [16, 16],
          [48, 16],
          [16, 48],
          [48, 48],
        ].map(([cx, cy], i) => (
          <g key={i}>
            <circle cx={cx} cy={cy} r="4" />
            <circle cx={cx} cy={cy} r="12" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * The animated backdrop: a slow grid, a couple of colour blooms, and drone
 * silhouettes drifting across at different speeds.
 *
 * Parallax by speed rather than by scroll listener — nothing here reacts to
 * input, so it costs no JavaScript at all once painted, and it keeps moving on
 * a page the student is reading rather than scrolling.
 */
export function DroneBackdrop({ dense = false }) {
  const marks = dense
    ? [
        { top: "8%", left: "6%", size: 54, dur: 34, delay: 0, op: 0.07 },
        { top: "22%", left: "78%", size: 78, dur: 46, delay: -8, op: 0.06 },
        { top: "58%", left: "14%", size: 42, dur: 40, delay: -16, op: 0.05 },
        { top: "72%", left: "66%", size: 64, dur: 52, delay: -24, op: 0.06 },
        { top: "40%", left: "44%", size: 34, dur: 38, delay: -4, op: 0.045 },
      ]
    : [
        { top: "14%", left: "10%", size: 48, dur: 38, delay: 0, op: 0.055 },
        { top: "64%", left: "80%", size: 66, dur: 48, delay: -12, op: 0.05 },
        { top: "42%", left: "52%", size: 36, dur: 42, delay: -22, op: 0.04 },
      ];

  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-grid" />
      <div className="bloom bloom-a" />
      <div className="bloom bloom-b" />
      {marks.map((m, i) => (
        <DroneMark
          key={i}
          size={m.size}
          className="drift"
          style={{
            top: m.top,
            left: m.left,
            opacity: m.op,
            animationDuration: `${m.dur}s`,
            animationDelay: `${m.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- icons */
export const Icon = {
  Rocket: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M5 13c0-5 3.5-9 7-11 3.5 2 7 6 7 11l-3 3H8l-3-3z" />
      <circle cx="12" cy="9" r="2.2" />
      <path d="M9 19l-2 3M15 19l2 3M12 19v4" />
    </svg>
  ),
  School: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 10l9-6 9 6" />
      <path d="M5 10v10h14V10" />
      <path d="M9 20v-6h6v6" />
    </svg>
  ),
  Shield: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  Chart: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  ),
  Users: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" />
      <path d="M16 5.5a3.2 3.2 0 010 5.4M18 20c0-2.4-.8-4-2-5" />
    </svg>
  ),
  Play: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none" />
    </svg>
  ),
  External: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
    </svg>
  ),
  Bolt: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  ),
};
