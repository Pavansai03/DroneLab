import React from "react";
import { hasPortal, goToPortal } from "../lib/portal.js";

/**
 * THE LOCK SCREEN
 * ===============
 * Shown instead of the simulator when the signed-in account belongs to a school
 * whose subscription has ended.
 *
 * Instead of, not over: the workshop is never constructed, so there is no
 * three.js scene running behind a modal that a browser's element inspector
 * would let a curious student delete. An overlay looks like a lock and is a
 * curtain.
 *
 * The wording assumes nobody has done anything wrong, because nobody has. A
 * date passed. The reader is a student who was part-way through a module, or a
 * teacher in front of a class, and neither of them can fix it — so the screen's
 * job is to say what happened, that their work is safe, and who to ask.
 */
export default function SubscriptionLock({ schoolName, endsAt }) {
  const ended = endsAt
    ? new Date(endsAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <img className="lock-mark" src={`${import.meta.env.BASE_URL}brand/logo-mark.png`} alt="" />

        <h1>Subscription ended</h1>
        <p className="lock-lead">
          {schoolName ? <strong>{schoolName}</strong> : "This school"}
          {ended ? `'s DroneLab subscription ended on ${ended}.` : "'s DroneLab subscription has ended."}{" "}
          The simulator is closed until it is renewed.
        </p>

        <div className="lock-note">
          <strong>Nothing has been lost.</strong> Your drone, your finished modules and every flight
          are still saved against your account, exactly as you left them. They come back untouched
          the moment the subscription is renewed.
        </div>

        <p className="lock-sub">
          Only a DroneLab administrator can extend it. Your school arranges that — there is nothing
          to do from here, and nothing you have done wrong.
        </p>

        <div className="lock-actions">
          {hasPortal() && (
            <button className="btn primary" onClick={goToPortal}>
              Back to the portal
            </button>
          )}
          <button className="btn" onClick={() => window.location.reload()}>
            Check again
          </button>
        </div>
      </div>
    </div>
  );
}
