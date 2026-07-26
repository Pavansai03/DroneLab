import React from "react";

/* Simple line icons, one per component, so a part is recognisable in the tray. */

const S = ({ children, size = 18 }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

export const PART_ICONS = {
  frame: (
    <S>
      <path d="M5 5l5 5M19 5l-5 5M5 19l5-5M19 19l-5-5" />
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="4.5" cy="4.5" r="1.6" />
      <circle cx="19.5" cy="4.5" r="1.6" />
      <circle cx="4.5" cy="19.5" r="1.6" />
      <circle cx="19.5" cy="19.5" r="1.6" />
    </S>
  ),
  battery: (
    <S>
      <rect x="3" y="7" width="15" height="10" rx="2" />
      <path d="M18 10h2.5v4H18" />
      <path d="M11 9l-2 3.4h2.4L9 17" />
    </S>
  ),
  pdb: (
    <S>
      <rect x="4" y="8" width="16" height="8" rx="1.6" />
      <circle cx="15.5" cy="12" r="2.4" />
      <path d="M7 10v4M9.5 10v4" />
    </S>
  ),
  esc: (
    <S>
      <rect x="4" y="7" width="16" height="10" rx="1.6" />
      <path d="M7 12h2l1-3 2 6 1-3h4" />
    </S>
  ),
  motor: (
    <S>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
    </S>
  ),
  propeller: (
    <S>
      <ellipse cx="12" cy="7" rx="2.4" ry="4.8" transform="rotate(18 12 7)" />
      <ellipse cx="12" cy="17" rx="2.4" ry="4.8" transform="rotate(18 12 17)" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </S>
  ),
  fc: (
    <S>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </S>
  ),
  imu: (
    <S>
      <path d="M12 3v18M3 12h18" opacity="0.4" />
      <circle cx="12" cy="12" r="6.5" />
      <path d="M8.5 14.5a5 5 0 007 -5" />
    </S>
  ),
  compass: (
    <S>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.8 9.2l-2 5.6-5.6 2 2-5.6z" />
    </S>
  ),
  barometer: (
    <S>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 12l4-3" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </S>
  ),
  gps: (
    <S>
      <path d="M12 21s6.5-5.6 6.5-10.2A6.5 6.5 0 005.5 10.8C5.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.6" r="2.4" />
    </S>
  ),
  receiver: (
    <S>
      <rect x="4" y="11" width="16" height="7" rx="1.6" />
      <path d="M8 11V7M16 11V5" />
    </S>
  ),
  transmitter: (
    <S>
      <rect x="4" y="8" width="16" height="11" rx="2" />
      <circle cx="8.5" cy="13.5" r="1.6" />
      <circle cx="15.5" cy="13.5" r="1.6" />
      <path d="M17 8V4" />
    </S>
  ),
  telemetry: (
    <S>
      <rect x="5" y="12" width="14" height="7" rx="1.6" />
      <path d="M12 12V6" />
      <path d="M8.5 5.5a5 5 0 017 0" />
      <path d="M6 3a9 9 0 0112 0" />
    </S>
  ),
  buzzer: (
    <S>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 4.5v2M12 17.5v2" />
    </S>
  ),
};

export const Check = ({ size = 13 }) => (
  <S size={size}>
    <path d="M4.5 12.5l5 5 10-11" />
  </S>
);

export const Lock = ({ size = 13 }) => (
  <S size={size}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V7.5a3.5 3.5 0 017 0v3" />
  </S>
);

export const Arrow = ({ size = 14 }) => (
  <S size={size}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </S>
);

export const ArrowLeft = ({ size = 14 }) => (
  <S size={size}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </S>
);

export const Reset = ({ size = 14 }) => (
  <S size={size}>
    <path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.7L3 8" />
    <path d="M3 3v5h5" />
  </S>
);

export const Warn = ({ size = 14 }) => (
  <S size={size}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17v.5" />
  </S>
);

export const Bolt = ({ size = 14 }) => (
  <S size={size}>
    <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
  </S>
);
