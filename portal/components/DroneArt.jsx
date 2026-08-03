/**
 * DRONE ARTWORK
 * =============
 * Every drone on this site is drawn here, as vector art, rather than
 * photographed or downloaded. Stock photography would mean licensing images
 * forever or quietly using someone else's; and a photograph of a consumer
 * drone above a page about assembling your own 450-class quadcopter teaches
 * the wrong thing.
 *
 * WHAT MAKES THIS ONE READ AS REAL
 * --------------------------------
 * The previous version was a flat schematic — a top-down cross with ellipses
 * for propellers — and it looked like a diagram because it *was* one. Four
 * things change that, and none of them is detail for its own sake:
 *
 *   1. PERSPECTIVE. Seen from three-quarters above, the two near arms are
 *      longer and lower on the canvas than the two far ones. Equal arms are the
 *      single biggest giveaway of a flat drawing.
 *   2. SHADING ALONG THE FORM. Every cylinder carries a gradient across its
 *      width, light on one side and dark on the other. A flat-filled cylinder
 *      reads as a rectangle no matter how well it is proportioned.
 *   3. REAL BLADES. Propellers are tapered aerofoils with curve, not ellipses.
 *      Three near-transparent copies at different angles, over a blur disc,
 *      give the smear a spinning prop actually produces.
 *   4. CONTACT SHADOW. A soft ellipse under the aircraft, offset toward the
 *      light. Without it the drone floats in a void rather than hovering over
 *      something.
 *
 * It stays sharp on a projector, animates without a video file, recolours with
 * the theme, and costs about 8 kB.
 */

/* ------------------------------------------------------------------ hero */
export function HeroDrone({ className = "" }) {
  /* Arm geometry, in draw order back-to-front so the near arms overlap the
     body and the far ones sit behind it. `s` scales everything on that arm:
     the far pair are smaller because they are further away. */
  const arms = [
    { x: 148, y: 150, s: 0.78, back: true }, // far left
    { x: 372, y: 150, s: 0.78, back: true }, // far right
    { x: 108, y: 236, s: 1.0, back: false }, // near left
    { x: 412, y: 236, s: 1.0, back: false }, // near right
  ];

  return (
    <svg viewBox="0 0 520 400" className={className} role="img" aria-label="Quadcopter">
      <defs>
        {/* Carbon fibre shell: dark, with a cool highlight along the top-left */}
        <linearGradient id="shell" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#4a5769" />
          <stop offset="38%" stopColor="#2a3341" />
          <stop offset="100%" stopColor="#141a23" />
        </linearGradient>
        <linearGradient id="shellTop" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#67768c" />
          <stop offset="55%" stopColor="#394453" />
          <stop offset="100%" stopColor="#222a35" />
        </linearGradient>
        {/* Arms are tubes: light edge, mid, dark edge — the gradient runs ACROSS
            the tube, which is what makes it look round rather than flat. */}
        <linearGradient id="tube" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5d6b7f" />
          <stop offset="30%" stopColor="#39434f" />
          <stop offset="72%" stopColor="#1c232c" />
          <stop offset="100%" stopColor="#2b3440" />
        </linearGradient>
        <linearGradient id="bell" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8b97a8" />
          <stop offset="42%" stopColor="#5a6675" />
          <stop offset="100%" stopColor="#2e3641" />
        </linearGradient>
        <linearGradient id="bellTop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#aab5c4" />
          <stop offset="100%" stopColor="#5b6675" />
        </linearGradient>
        <linearGradient id="blade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8e9bad" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#4a5462" stopOpacity="0.25" />
        </linearGradient>
        <radialGradient id="disc">
          <stop offset="55%" stopColor="#9fb0c4" stopOpacity="0" />
          <stop offset="88%" stopColor="#9fb0c4" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#9fb0c4" stopOpacity="0.03" />
        </radialGradient>
        <radialGradient id="lensGrad">
          <stop offset="0%" stopColor="#0b1420" />
          <stop offset="62%" stopColor="#16283d" />
          <stop offset="100%" stopColor="#3d5871" />
        </radialGradient>
        <radialGradient id="shadowGrad">
          <stop offset="0%" stopColor="#000" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="ledGlow" x="-300%" y="-300%" width="700%" height="700%">
          <feGaussianBlur stdDeviation="3.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Contact shadow, offset away from the key light */}
      <ellipse cx="268" cy="356" rx="132" ry="22" fill="url(#shadowGrad)" />

      <g className="drone-body">
        {/* ---- far arms and rotors, drawn first so the body overlaps them ---- */}
        {arms.filter((a) => a.back).map((a, i) => (
          <Rotor key={"b" + i} {...a} bodyX={260} bodyY={196} />
        ))}

        {/* ------------------------------- fuselage ------------------------------- */}
        {/* Lower shell */}
        <path
          d="M198 196 L238 172 L282 172 L322 196 L322 216 L282 240 L238 240 L198 216 Z"
          fill="url(#shell)"
        />
        {/* Top plate, lifted so the shell edge below stays visible as thickness */}
        <path d="M198 190 L238 166 L282 166 L322 190 L282 214 L238 214 Z" fill="url(#shellTop)" />
        {/* Specular line along the leading edge */}
        <path d="M238 167 L282 167 L318 189" fill="none" stroke="#93a2b6" strokeWidth="1.6" opacity="0.55" />

        {/* Flight controller stack, visible through the top plate cutout */}
        <path d="M240 186 L280 186 L266 194 L254 194 Z" fill="#0d131b" />
        <rect x="248" y="187" width="6" height="2.6" rx="1" fill="var(--accent)" filter="url(#ledGlow)" />
        <rect x="258" y="187" width="6" height="2.6" rx="1" fill="#ffb648" opacity="0.9" />
        <rect x="268" y="187" width="5" height="2.6" rx="1" fill="#ff5c62" className="blink" />

        {/* GPS mast */}
        <rect x="258" y="150" width="4" height="18" rx="2" fill="#3f4a58" />
        <ellipse cx="260" cy="149" rx="13" ry="5" fill="#5e6b7d" />
        <ellipse cx="260" cy="147.5" rx="13" ry="5" fill="#79899d" />
        <circle cx="260" cy="147" r="2.6" fill="var(--accent)" opacity="0.85" />

        {/* ---- near arms and rotors, over the body ---- */}
        {arms.filter((a) => !a.back).map((a, i) => (
          <Rotor key={"f" + i} {...a} bodyX={260} bodyY={210} />
        ))}

        {/* ------------------------------- camera -------------------------------- */}
        <path d="M247 236 L273 236 L270 250 L250 250 Z" fill="#222b36" />
        <circle cx="260" cy="256" r="13" fill="#2c3644" />
        <circle cx="260" cy="256" r="10.5" fill="url(#lensGrad)" />
        <circle cx="260" cy="256" r="5" fill="#0a121c" />
        {/* Two highlights: a hard glint and a soft sky reflection. One alone
            reads as a sticker; two make it read as glass. */}
        <ellipse cx="256" cy="251" rx="3.4" ry="2.2" fill="#dceaf7" opacity="0.75" transform="rotate(-28 256 251)" />
        <ellipse cx="264" cy="261" rx="2" ry="1.3" fill="#7fd7ff" opacity="0.4" />

        {/* ------------------------------- landing legs -------------------------- */}
        {[
          [222, 232, 200, 300],
          [298, 232, 320, 300],
        ].map(([x1, y1, x2, y2], i) => (
          <g key={i}>
            <path
              d={`M${x1} ${y1} Q${x1 + (x2 - x1) * 0.35} ${y1 + 46} ${x2} ${y2}`}
              stroke="url(#tube)"
              strokeWidth="7"
              fill="none"
              strokeLinecap="round"
            />
            <ellipse cx={x2} cy={y2 + 2} rx="13" ry="4.5" fill="#1b222c" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * One arm, motor and propeller.
 *
 * Drawn as its own group so the near and far pairs can be composited on either
 * side of the fuselage — which is the whole trick to the perspective.
 */
function Rotor({ x, y, s, bodyX, bodyY }) {
  const bellH = 17 * s;
  const bladeLen = 74 * s;

  return (
    <g>
      {/* Arm, from the shell out to the motor */}
      <path
        d={`M${bodyX} ${bodyY} L${x} ${y}`}
        stroke="url(#tube)"
        strokeWidth={13 * s}
        strokeLinecap="round"
      />

      {/* Motor: bell side, then the top face as an ellipse */}
      <rect x={x - 15 * s} y={y - bellH} width={30 * s} height={bellH} rx={3 * s} fill="url(#bell)" />
      <ellipse cx={x} cy={y - bellH} rx={15 * s} ry={5.5 * s} fill="url(#bellTop)" />
      <ellipse cx={x} cy={y - bellH} rx={6 * s} ry={2.2 * s} fill="#111820" />
      {/* Stator slots — three short darker bands read as windings at this size */}
      {[-8, 0, 8].map((o) => (
        <rect key={o} x={x + o * s - 1 * s} y={y - bellH + 4 * s} width={1.8 * s} height={bellH - 6 * s} fill="#1e2530" opacity="0.55" />
      ))}

      {/* Propeller: blur disc, then three ghosted blades at different angles */}
      <g className="prop" style={{ transformOrigin: `${x}px ${y - bellH - 4 * s}px` }}>
        <ellipse cx={x} cy={y - bellH - 4 * s} rx={bladeLen} ry={bladeLen * 0.2} fill="url(#disc)" />
        {[0, 62, 124].map((a, i) => (
          <g key={a} transform={`rotate(${a} ${x} ${y - bellH - 4 * s})`} opacity={0.5 - i * 0.13}>
            {/* A tapered, curved blade — the leading edge bows, the tip narrows */}
            <path
              d={`M${x} ${y - bellH - 4 * s}
                  q ${bladeLen * 0.5} ${-7 * s} ${bladeLen} ${-1 * s}
                  q ${-bladeLen * 0.5} ${5 * s} ${-bladeLen} ${1 * s} Z`}
              fill="url(#blade)"
            />
            <path
              d={`M${x} ${y - bellH - 4 * s}
                  q ${-bladeLen * 0.5} ${7 * s} ${-bladeLen} ${1 * s}
                  q ${bladeLen * 0.5} ${-5 * s} ${bladeLen} ${-1 * s} Z`}
              fill="url(#blade)"
            />
          </g>
        ))}
        {/* Prop nut */}
        <ellipse cx={x} cy={y - bellH - 4 * s} rx={4.5 * s} ry={2 * s} fill="#8d99a9" />
      </g>
    </g>
  );
}

/* ------------------------------------------------------- silhouettes */
/**
 * A flat top-down silhouette, for scattering across a background at low
 * opacity. Deliberately simple: at 40px and 6% opacity, detail is wasted bytes.
 */
export function DroneMark({ size = 40, className = "", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} style={style} aria-hidden="true">
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
 * The animated backdrop: a slow grid, colour blooms, and drone silhouettes
 * drifting across at different speeds.
 *
 * Parallax by speed rather than by scroll listener — nothing reacts to input,
 * so it costs no JavaScript once painted and keeps moving on a page the student
 * is reading rather than scrolling.
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

/* ============================================================== loading */
/**
 * A hovering drone with spinning rotors, instead of the word "Loading".
 *
 * Text tells you the page is busy. A drone that is visibly *flying* tells you
 * the same thing and says what the product is while it does it — and on a slow
 * cold start, which this deployment has, that is several seconds of screen time
 * that would otherwise be a dead word.
 */
export function Loader({ label = "Loading", size = 88 }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <svg width={size} height={size * 0.72} viewBox="0 0 120 86" aria-hidden="true">
        <defs>
          <linearGradient id="ldTube" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5d6b7f" />
            <stop offset="70%" stopColor="#1e252f" />
          </linearGradient>
        </defs>
        <ellipse className="loader-shadow" cx="60" cy="79" rx="26" ry="4.5" fill="#000" opacity="0.4" />
        <g className="loader-craft">
          {[
            [24, 30],
            [96, 30],
            [24, 52],
            [96, 52],
          ].map(([x, y], i) => (
            <g key={i}>
              <path d={`M60 44 L${x} ${y}`} stroke="url(#ldTube)" strokeWidth="5" strokeLinecap="round" />
              <rect x={x - 6} y={y - 8} width="12" height="8" rx="2" fill="#5a6675" />
              <ellipse cx={x} cy={y - 8} rx="6" ry="2.4" fill="#8996a8" />
              <ellipse
                className="loader-prop"
                cx={x}
                cy={y - 10}
                rx="21"
                ry="3.6"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                opacity="0.75"
                style={{ transformOrigin: `${x}px ${y - 10}px` }}
              />
            </g>
          ))}
          <path d="M42 44 L52 36 L68 36 L78 44 L68 52 L52 52 Z" fill="#39434f" />
          <path d="M42 44 L52 36 L68 36 L78 44" fill="none" stroke="#8996a8" strokeWidth="1.2" opacity="0.6" />
          <circle cx="60" cy="44" r="3.4" fill="var(--accent)" />
        </g>
      </svg>
      <span>{label}</span>
    </div>
  );
}

/**
 * A shimmering placeholder in the shape of the thing that is coming.
 *
 * Used where the layout is known in advance — stat tiles, table rows. Holding
 * the space stops the page jumping when data lands, which is more valuable than
 * any spinner: a spinner says "wait", a skeleton says "wait, and it will look
 * like this".
 */
export function Skeleton({ rows = 3, height = 74, className = "" }) {
  return (
    <div className={`grid ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
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
  /* Google's mark, in its own colours. Drawn rather than loaded so the button
     works offline and adds no request; the four-colour form is the recognisable
     part and rendering it monochrome would look like a mistake. */
  Google: (p) => (
    <svg viewBox="0 0 48 48" {...p}>
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l6.9 5.3c4.1-3.8 6.6-9.4 6.6-15.6z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10z" />
      <path fill="#EA4335" d="M24 10.6c3.2 0 5.4 1.4 6.7 2.6l6.1-6C33 3.8 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14l7.1 5.5c1.8-5.3 6.7-8.9 12.5-8.9z" />
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
