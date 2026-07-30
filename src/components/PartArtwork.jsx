import React from "react";

/**
 * PART ARTWORK
 * ============
 * Technical illustrations of each component, for the wiring dialog.
 *
 * Drawn rather than photographed, deliberately:
 *   - stock product photos are copyrighted, and this gets handed to a class
 *   - a drawing can highlight the pads and connectors that actually matter,
 *     which a photo of a black PCB on a black mat does not
 *   - vector stays sharp on a projector and costs a few KB
 *
 * To use photographs of YOUR OWN kit instead, pass `src`:
 *     <PartArtwork part="esc" src="/img/my-esc.jpg" />
 * Anything passed that way replaces the drawing entirely. Photographing the
 * actual hardware the students will handle beats any stock image.
 */

const BOARD = "#12161d";
const BOARD_EDGE = "#2b3542";
const PCB = "#0f3d28";
const PCB_BLUE = "#123a5c";
const METAL = "#8b93a1";
const METAL_DARK = "#4b5462";
const COPPER = "#b8733a";
const GOLD = "#d4af37";
const RED = "#e5484d";
const BLACK = "#1b1f26";
const YELLOW = "#ffd23b";
const WHITE = "#dfe6ee";
const CARBON = "#22262e";

/* ------------------------------------------------------------------ */
/* One drawing per component. All share a 0 0 140 100 viewBox so the   */
/* cards line up.                                                      */
/* ------------------------------------------------------------------ */

const ART = {
  battery: (
    <>
      <rect x="18" y="26" width="86" height="48" rx="5" fill="#1c5fa8" stroke={BOARD_EDGE} />
      <rect x="18" y="60" width="86" height="8" fill="#123b6b" />
      <text x="26" y="45" fill="#fff" fontSize="12" fontWeight="700" fontFamily="monospace">
        3S
      </text>
      <text x="26" y="56" fill="rgba(255,255,255,.85)" fontSize="8" fontFamily="monospace">
        11.1V LiPo
      </text>
      {/* XT60 + leads */}
      <rect x="104" y="38" width="12" height="16" rx="2" fill={YELLOW} stroke="#a8861f" />
      <path d="M116 43 h16" stroke={RED} strokeWidth="4" strokeLinecap="round" />
      <path d="M116 50 h16" stroke={BLACK} strokeWidth="4" strokeLinecap="round" />
      {/* balance lead */}
      <path d="M60 26 v-8 h14" stroke={WHITE} strokeWidth="1.6" fill="none" />
      <rect x="74" y="14" width="10" height="8" rx="1.5" fill={WHITE} />
    </>
  ),

  pdb: (
    <>
      <rect x="30" y="18" width="66" height="66" rx="4" fill={PCB} stroke="#1c6b46" />
      {/* main pads */}
      <rect x="38" y="26" width="14" height="10" rx="2" fill={GOLD} />
      <rect x="38" y="40" width="14" height="10" rx="2" fill={GOLD} />
      <text x="56" y="34" fill="#9fe6c0" fontSize="7" fontFamily="monospace">BAT+</text>
      <text x="56" y="48" fill="#9fe6c0" fontSize="7" fontFamily="monospace">BAT-</text>
      {/* output pads, one pair per ESC */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx={42 + i * 14} cy="72" r="3.4" fill={COPPER} />
          <circle cx={42 + i * 14} cy="62" r="3.4" fill={COPPER} />
        </g>
      ))}
      {/* capacitor */}
      <circle cx="84" cy="34" r="8" fill={METAL_DARK} stroke={METAL} />
      <path d="M84 26 v16" stroke={METAL} strokeWidth="1" />
      {/* BEC */}
      <rect x="70" y="46" width="20" height="9" rx="1.5" fill={BOARD} />
      <text x="72" y="53" fill={YELLOW} fontSize="6" fontFamily="monospace">BEC 5V</text>
    </>
  ),

  esc: (
    <>
      {/* heatshrink over a small board */}
      <rect x="34" y="30" width="52" height="40" rx="4" fill={BLACK} stroke={BOARD_EDGE} />
      <rect x="38" y="35" width="44" height="14" rx="2" fill="#1c1030" />
      <text x="42" y="45" fill={WHITE} fontSize="8" fontWeight="700" fontFamily="monospace">
        30A
      </text>
      <text x="40" y="61" fill="#8a94a6" fontSize="6.5" fontFamily="monospace">
        BLHeli_S
      </text>
      {/* power in, left */}
      <path d="M34 42 h-18" stroke={RED} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M34 50 h-18" stroke={BLACK} strokeWidth="3.4" strokeLinecap="round" />
      {/* three phase out, right */}
      <path d="M86 38 h20" stroke={BLACK} strokeWidth="3" strokeLinecap="round" />
      <path d="M86 45 h20" stroke={BLACK} strokeWidth="3" strokeLinecap="round" />
      <path d="M86 52 h20" stroke={BLACK} strokeWidth="3" strokeLinecap="round" />
      {/* signal */}
      <path d="M60 70 v14" stroke={YELLOW} strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),

  motor: (
    <>
      {/* bell, side view */}
      <ellipse cx="66" cy="30" rx="26" ry="7" fill={METAL} />
      <path d="M40 30 v24 a26 7 0 0 0 52 0 V30" fill={METAL_DARK} stroke={METAL} />
      <ellipse cx="66" cy="54" rx="26" ry="7" fill="#3a424e" />
      {/* stator windings peeking out */}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={46 + i * 9} y="48" width="5" height="9" fill={COPPER} />
      ))}
      {/* shaft */}
      <rect x="63" y="10" width="6" height="20" rx="1.5" fill={METAL} />
      {/* mount + 3 phase leads */}
      <rect x="52" y="60" width="28" height="6" rx="1.5" fill={BOARD} />
      <path d="M58 66 v18" stroke={BLACK} strokeWidth="3" strokeLinecap="round" />
      <path d="M66 66 v18" stroke={BLACK} strokeWidth="3" strokeLinecap="round" />
      <path d="M74 66 v18" stroke={BLACK} strokeWidth="3" strokeLinecap="round" />
    </>
  ),

  propeller: (
    <>
      <path d="M66 50 C40 34 16 36 12 46 C10 54 38 56 66 50 Z" fill={CARBON} stroke="#3a4150" />
      <path d="M74 50 C100 66 124 64 128 54 C130 46 102 44 74 50 Z" fill={CARBON} stroke="#3a4150" />
      <circle cx="70" cy="50" r="9" fill={METAL} stroke={METAL_DARK} />
      <circle cx="70" cy="50" r="3.4" fill={BOARD} />
      <text x="52" y="80" fill="#8a94a6" fontSize="8" fontFamily="monospace">10 x 4.5</text>
    </>
  ),

  fc: (
    <>
      <rect x="24" y="20" width="78" height="62" rx="5" fill={PCB_BLUE} stroke="#1d5b8c" />
      <rect x="30" y="26" width="66" height="42" rx="3" fill="#0d2a44" />
      <text x="36" y="40" fill="#9fd0ff" fontSize="9" fontWeight="700" fontFamily="monospace">
        PIXHAWK
      </text>
      {/* MCU */}
      <rect x="52" y="46" width="18" height="18" rx="2" fill={BOARD} />
      {/* nose arrow: the detail most often fitted backwards */}
      <path d="M63 14 l6 8 h-12 z" fill="#46e6cf" />
      {/* port headers down the right edge */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x="96" y={28 + i * 12} width="12" height="8" rx="1.5" fill={BOARD} stroke={METAL_DARK} />
      ))}
      {/* MAIN OUT rail along the bottom */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect key={i} x={30 + i * 8.4} y="72" width="5" height="8" fill={GOLD} />
      ))}
      <text x="30" y="92" fill="#8a94a6" fontSize="6.5" fontFamily="monospace">MAIN OUT 1-8</text>
    </>
  ),

  gps: (
    <>
      <rect x="40" y="16" width="54" height="30" rx="4" fill={WHITE} stroke="#b9c2cd" />
      <circle cx="67" cy="31" r="9" fill="#2f7d5a" />
      <text x="56" y="58" fill="#8a94a6" fontSize="7" fontFamily="monospace">M8N GNSS</text>
      {/* mast */}
      <rect x="64" y="46" width="6" height="30" fill={BOARD} />
      <rect x="52" y="76" width="30" height="6" rx="2" fill={BOARD} />
      {/* 4-wire lead */}
      <path d="M94 30 h14" stroke={RED} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M94 36 h14" stroke="#3fbf6f" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M94 42 h14" stroke="#4a8fe7" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M94 48 h14" stroke={BLACK} strokeWidth="2.6" strokeLinecap="round" />
    </>
  ),

  receiver: (
    <>
      <rect x="34" y="40" width="60" height="30" rx="3" fill={BOARD} stroke={BOARD_EDGE} />
      <text x="40" y="59" fill={WHITE} fontSize="8" fontWeight="600" fontFamily="monospace">
        FS-iA6B
      </text>
      {/* antennas */}
      <path d="M44 40 C40 26 34 20 28 16" stroke={WHITE} strokeWidth="2" fill="none" />
      <path d="M84 40 C88 26 94 20 100 16" stroke={WHITE} strokeWidth="2" fill="none" />
      {/* servo header */}
      {[0, 1, 2].map((i) => (
        <rect key={i} x={44 + i * 14} y="70" width="9" height="7" fill={GOLD} />
      ))}
      <circle cx="88" cy="46" r="2.6" fill="#39ff6a" />
    </>
  ),

  transmitter: (
    <>
      <rect x="30" y="20" width="70" height="60" rx="8" fill="#1a1d24" stroke={BOARD_EDGE} />
      <rect x="44" y="52" width="42" height="20" rx="2" fill="#2c6f5a" />
      <circle cx="46" cy="38" r="8" fill={METAL_DARK} stroke={METAL} />
      <circle cx="46" cy="38" r="3" fill={BOARD} />
      <circle cx="84" cy="38" r="8" fill={METAL_DARK} stroke={METAL} />
      <circle cx="84" cy="38" r="3" fill={BOARD} />
      <rect x="62" y="10" width="6" height="12" rx="2" fill={BOARD} />
      <text x="46" y="92" fill="#8a94a6" fontSize="7" fontFamily="monospace">2.4 GHz TX</text>
    </>
  ),

  imu: (
    <>
      <rect x="42" y="32" width="50" height="36" rx="3" fill={BOARD} stroke={BOARD_EDGE} />
      <rect x="54" y="42" width="26" height="16" rx="2" fill="#2a2f38" />
      <text x="56" y="53" fill={WHITE} fontSize="7" fontFamily="monospace">IMU</text>
      {/* the foam pad that keeps prop vibration out of the gyro */}
      <rect x="40" y="68" width="54" height="7" rx="2" fill="#3a3f4a" />
      <text x="44" y="88" fill="#8a94a6" fontSize="6.5" fontFamily="monospace">GYRO + ACCEL</text>
    </>
  ),

  compass: (
    <>
      <circle cx="67" cy="44" r="24" fill={WHITE} stroke="#b9c2cd" strokeWidth="2" />
      <path d="M67 24 l6 18 -6 -4 -6 4 z" fill={RED} />
      <path d="M67 64 l6 -18 -6 4 -6 -4 z" fill={METAL_DARK} />
      <circle cx="67" cy="44" r="2.6" fill={BOARD} />
      <text x="46" y="84" fill="#8a94a6" fontSize="6.5" fontFamily="monospace">3-AXIS MAG</text>
    </>
  ),

  barometer: (
    <>
      <rect x="46" y="34" width="42" height="32" rx="3" fill={BOARD} stroke={BOARD_EDGE} />
      <rect x="54" y="28" width="26" height="8" rx="2" fill="#4a5160" />
      <circle cx="67" cy="50" r="7" fill="#2a2f38" stroke={METAL_DARK} />
      <text x="44" y="82" fill="#8a94a6" fontSize="6.5" fontFamily="monospace">PRESSURE ALT</text>
    </>
  ),

  buzzer: (
    <>
      <circle cx="66" cy="46" r="20" fill="#0e1116" stroke={BOARD_EDGE} strokeWidth="2" />
      <circle cx="66" cy="46" r="5" fill="#2a2f38" />
      <path d="M52 46 a14 14 0 0 1 28 0" stroke={METAL_DARK} strokeWidth="1.2" fill="none" />
      <path d="M86 42 h18" stroke={RED} strokeWidth="3" strokeLinecap="round" />
      <path d="M86 50 h18" stroke={BLACK} strokeWidth="3" strokeLinecap="round" />
      <text x="48" y="82" fill="#8a94a6" fontSize="6.5" fontFamily="monospace">PIEZO ALARM</text>
    </>
  ),

  frame: (
    <>
      <path d="M28 22 L104 78 M104 22 L28 78" stroke={CARBON} strokeWidth="9" strokeLinecap="round" />
      <rect x="52" y="40" width="28" height="20" rx="3" fill={CARBON} stroke="#3a4150" />
      {[
        [28, 22],
        [104, 22],
        [28, 78],
        [104, 78],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="7" fill={METAL_DARK} stroke={METAL} strokeWidth="1.5" />
      ))}
      <text x="46" y="94" fill="#8a94a6" fontSize="6.5" fontFamily="monospace">CARBON X-450</text>
    </>
  ),
};

/**
 * @param part  component id, e.g. "esc"
 * @param src   optional photograph; replaces the drawing when given
 * @param label alt text / caption for the photo case
 */
export default function PartArtwork({ part, src, label, width = 140, height = 100 }) {
  if (src) {
    return (
      <img
        className="part-photo"
        src={src}
        alt={label || part}
        width={width}
        height={height}
        loading="lazy"
      />
    );
  }

  const art = ART[part];
  return (
    <svg
      className="part-art"
      viewBox="0 0 140 100"
      width={width}
      height={height}
      role="img"
      aria-label={label || part}
    >
      {art || (
        <>
          <rect x="30" y="26" width="80" height="48" rx="4" fill={BOARD} stroke={BOARD_EDGE} />
          <text x="70" y="54" textAnchor="middle" fill="#8a94a6" fontSize="9" fontFamily="monospace">
            {part}
          </text>
        </>
      )}
    </svg>
  );
}

export const HAS_ARTWORK = (part) => Boolean(ART[part]);
