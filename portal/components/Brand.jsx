"use client";

/**
 * THE BRAND LOCKUP
 * ================
 * RajUddan's mark, plus the product name it belongs to.
 *
 * Two names, deliberately. RajUddan is the company; DroneLab is the thing the
 * student is using. A logo alone in the top bar tells a first-time visitor who
 * made this and not what they are looking at, and the product name alone throws
 * away the identity the whole portal was themed around. Every school
 * prospectus, kit box and pit-lane hoarding does the same thing for the same
 * reason.
 *
 * WHY AN <img> AND NOT next/image
 * -------------------------------
 * next/image wants a configured loader and gives back optimisation this does
 * not need: one small asset, served from the same origin, shown at two fixed
 * sizes. The plain tag also degrades in the one way that matters — if the file
 * is missing, `onError` drops it and the wordmark carries on alone, rather than
 * leaving a broken-image glyph in the top bar of every page.
 */

import { useState } from "react";

/** Derived from the supplied artwork by scripts/make-logo-mark.py. */
const MARK = "/brand/logo-mark.png";

export default function Brand({ size = 32, showName = true, stacked = false }) {
  const [broken, setBroken] = useState(false);

  return (
    <div className={`brand ${stacked ? "stacked" : ""}`}>
      {!broken && (
        <img
          className="brand-mark"
          src={MARK}
          alt="RajUddan"
          width={size}
          height={size}
          style={{ height: size }}
          onError={() => setBroken(true)}
        />
      )}
      {showName && (
        <span className="brand-name">
          DRONE<em>LAB</em>
        </span>
      )}
    </div>
  );
}
