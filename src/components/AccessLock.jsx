import React from "react";
import { hasPortal, portalUrl, goToPortal } from "../lib/portal.js";
import { DENIED } from "../lib/useSchoolAccess.js";

/**
 * THE LOCK SCREEN
 * ===============
 * Shown instead of the simulator when the person at the keyboard may not use
 * it — because they are signed out, not yet approved, or their school's
 * subscription has ended.
 *
 * INSTEAD OF, NOT OVER
 * --------------------
 * The workshop is never constructed, so there is no three.js scene running
 * behind a modal that a curious student could reveal by deleting one element in
 * the inspector. An overlay looks like a lock and is a curtain.
 *
 * ONE SCREEN, SEVERAL REASONS
 * ---------------------------
 * Each reason gets its own words, because each has a different remedy and
 * sending someone to the wrong person is worse than saying nothing. "Sign in"
 * and "your school's licence lapsed" are not variations of one message.
 *
 * Nothing here blames the reader. In every one of these cases they have done
 * nothing wrong, and most of them cannot fix it themselves.
 */

function copyFor(reason, schoolName, endsAt) {
  const school = schoolName || "your school";
  const ended = endsAt
    ? new Date(endsAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  switch (reason) {
    case DENIED.SIGNED_OUT:
      return {
        title: "Sign in to fly",
        lead: "The simulator is part of your school's DroneLab subscription, so it needs to know who you are before it opens.",
        note: "Signing in is also what saves your work. Your drone, your progress and every flight follow your account, not the machine you happen to be sitting at.",
        sub: "Use the account your school gave you. If you have not joined a school yet, sign in and enter your join code first.",
        cta: "Sign in",
      };

    case DENIED.NO_SCHOOL:
      return {
        title: "Enter your join code",
        lead: "Your account is not attached to a school yet, and the simulator opens once it is.",
        note: "Your teacher has a join code for your class. It looks like ABCD-2345, and you enter it once — on your profile page in the portal.",
        sub: "If you do not have the code, ask your teacher for it. It is circulated to the whole class.",
        cta: "Go to the portal",
      };

    case DENIED.PENDING:
      return {
        title: "Waiting for approval",
        lead: `Your code was accepted and you are attached to ${school}. An administrator checks each student before the simulator is unlocked.`,
        note: "Nothing else to do, and nothing to re-enter. This is usually settled within one school day.",
        sub: "The portal shows where you are in the queue, and lets you in as soon as the decision lands.",
        cta: "Go to the portal",
      };

    case DENIED.REJECTED:
      return {
        title: "Your request was not approved",
        lead: `An administrator reviewed your request to join ${school} and did not approve it.`,
        note: "Making a second account will not change this — the decision is attached to your school membership, not to this login.",
        sub: "If you think it is a mistake, speak to your teacher. They can ask the administrator to look again.",
        cta: "Go to the portal",
      };

    case DENIED.SCHOOL_INACTIVE:
      return {
        title: "This school is not active",
        lead: `${school} is not currently active on DroneLab, so the simulator is closed.`,
        note: "Nothing has been lost. Every build, every completed module and every flight is still recorded against each account.",
        sub: "Your school arranges this with a DroneLab administrator. There is nothing to do from here.",
        cta: "Go to the portal",
      };

    case DENIED.EXPIRED:
    default:
      return {
        title: "Subscription ended",
        lead: ended
          ? `${school}'s DroneLab subscription ended on ${ended}. The simulator is closed until it is renewed.`
          : `${school}'s DroneLab subscription has ended. The simulator is closed until it is renewed.`,
        note: "Nothing has been lost. Your drone, your finished modules and every flight are still saved against your account, exactly as you left them. They come back untouched the moment it is renewed.",
        sub: "Only a DroneLab administrator can extend it, and your school arranges that. There is nothing to do from here, and nothing you have done wrong.",
        cta: "Go to the portal",
      };
  }
}

export default function AccessLock({ reason, schoolName, endsAt }) {
  const { title, lead, note, sub, cta } = copyFor(reason, schoolName, endsAt);

  /* Signed out, the useful destination is the login page rather than the portal
     root — which would only bounce them there anyway, one redirect later. */
  const signIn = () => {
    const base = portalUrl() || "/";
    window.location.assign(reason === DENIED.SIGNED_OUT ? `${base.replace(/\/$/, "")}/login` : base);
  };

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <img className="lock-mark" src={`${import.meta.env.BASE_URL}brand/logo-mark.png`} alt="" />

        <h1>{title}</h1>
        <p className="lock-lead">{lead}</p>

        {/* The reassurance is the one thing given a box: a student's first
            thought on being stopped is that their work has gone. */}
        <div className="lock-note">{note}</div>

        <p className="lock-sub">{sub}</p>

        <div className="lock-actions">
          {hasPortal() && (
            <button
              className="btn primary"
              onClick={reason === DENIED.SIGNED_OUT ? signIn : goToPortal}
            >
              {cta}
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
