"use client";

import { useState } from "react";

/**
 * A PASSWORD BOX YOU CAN LOOK INSIDE
 * ==================================
 * One field, used everywhere a password is typed, so the behaviour is the same
 * on the login form, the sign-up form and the reset screen.
 *
 * WHY THE TOGGLE IS WORTH HAVING
 * ------------------------------
 * The people using this are children on shared classroom keyboards, and school
 * password policies produce exactly the strings that are hardest to type blind.
 * A masked field that rejects them twice with "wrong password" teaches nothing
 * except that the computer is against them. Being able to check what you typed
 * turns a dead end into a typo.
 *
 * It starts masked, always. Someone standing behind you is the reason masking
 * exists, and the student decides when that risk is worth taking — not us.
 *
 * THE ICON IS ONE DRAWING, NOT TWO
 * --------------------------------
 * An eye whose pupil narrows while a line is drawn across it, rather than two
 * images swapped on click. Swapping reads as a glitch at this size; a stroke
 * that draws in over a quarter of a second reads as the same object changing
 * state, which is what actually happened. Both halves are plain CSS transitions
 * on an inline SVG, so there is nothing to load and nothing to run.
 *
 * Masked shows an open eye — "press this to look". Visible shows the eye
 * crossed out — "it is being shown; press to hide it again".
 *
 * The button is `type="button"`. Inside a <form>, a button without that is a
 * submit button, so revealing your password would have submitted the form.
 */
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = "current-password",
  minLength = 6,
  required = true,
  hint = null,
  after = null,
  autoFocus = false,
}) {
  const [shown, setShown] = useState(false);

  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        {after}
      </div>
      <div className="pw-wrap">
        <input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          minLength={minLength}
          required={required}
          autoFocus={autoFocus}
          /* Off on every one of these: a browser that helpfully capitalises or
             autocorrects a password produces a wrong password and no clue why. */
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="pw-eye"
          data-shown={shown ? "true" : "false"}
          onClick={() => setShown((s) => !s)}
          /* aria-pressed rather than a changing label alone, so a screen reader
             announces this as a toggle that is on or off rather than as two
             different buttons appearing in the same place. */
          aria-pressed={shown}
          aria-controls={id}
          aria-label={shown ? "Hide password" : "Show password"}
          title={shown ? "Hide password" : "Show password"}
          /* Not reachable by Tab. Someone tabbing through a login form is
             heading for the submit button, and a stop in between is a snag for
             everyone to serve a control most people never touch. Still fully
             usable by pointer, and by keyboard once focused. */
          tabIndex={-1}
        >
          <EyeGlyph />
        </button>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/**
 * The eye. Everything that moves is driven by `data-shown` on the button, so
 * the markup is static and the animation lives entirely in the stylesheet.
 *
 * The slash is drawn twice: once thick in the field's own background colour to
 * cut a clean channel through the eye beneath it, then once in the ink colour.
 * Without the first pass the line and the eyelid overlap into a smudge at the
 * 19 pixels this is actually rendered at.
 *
 * `pathLength="1"` normalises the line's length so the dash offset that draws
 * it is 1 → 0 regardless of its real geometry.
 */
function EyeGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <g
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path className="pw-lid" d="M1.8 12S5.4 5.4 12 5.4 22.2 12 22.2 12 18.6 18.6 12 18.6 1.8 12 1.8 12Z" />
        <circle className="pw-pupil" cx="12" cy="12" r="3.1" />
      </g>
      <line className="pw-slash-cut" x1="4" y1="3.6" x2="20" y2="20.4" pathLength="1" />
      <line className="pw-slash" x1="4" y1="3.6" x2="20" y2="20.4" pathLength="1" />
    </svg>
  );
}
