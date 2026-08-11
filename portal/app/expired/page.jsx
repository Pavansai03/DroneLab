"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase.js";
import { api } from "../../lib/api.js";
import Brand from "../../components/Brand.jsx";
import { DroneBackdrop, HeroDrone, Icon, Loader } from "../../components/DroneArt.jsx";

/**
 * The chrome around every state of this page.
 *
 * MODULE SCOPE, NOT INSIDE THE COMPONENT. Declared inside, it is a new
 * component type on every render, so React discards the whole subtree and
 * rebuilds it whenever state changes. This screen polls every twenty seconds,
 * so that was the animated backdrop being torn down and its animation
 * restarted four times a minute, for nothing.
 *
 * The same shape on the password reset screen was worse: it destroyed the
 * inputs on every keystroke. See scripts/test-components.mjs, which now
 * refuses it everywhere.
 */
function Frame({ onLeave, children }) {
  return (
    <>
      <DroneBackdrop />
      <div className="shell">
        <header className="topbar">
          <Brand />
          <div className="spacer" />
          <button className="btn small" onClick={onLeave}>
            Sign out
          </button>
        </header>
        <main style={{ maxWidth: 760 }}>{children}</main>
      </div>
    </>
  );
}

/**
 * SUBSCRIPTION ENDED
 * ==================
 * Where a school and its students land once the licence has run out.
 *
 * The tone matters more than it usually would. Nobody here has done anything
 * wrong — a date passed — and the reader is most likely a teacher mid-lesson
 * with a room of students, or a student who has just been stopped in the middle
 * of a module. So it says plainly what happened, that nothing has been lost,
 * and exactly who can undo it. No warnings, no red, no suggestion of fault.
 *
 * It polls. An administrator extending the date is the entire remedy, and when
 * they do, everyone sitting on this screen should be let back in without being
 * told to reload — which they would not think to do, having been given no
 * reason to expect it.
 */
export default function ExpiredPage() {
  const router = useRouter();
  const [me, setMe] = useState(undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const {
          data: { session },
        } = await supabase().auth.getSession();
        if (!session) return router.replace("/login");

        const data = await api.me();
        if (!alive) return;

        /* Extended while this was open — or never expired at all, if someone
           reached this page by typing the URL. Either way, back to work. */
        if (!data.subscription?.expired) {
          return router.replace(data.role === "student" ? "/student" : "/");
        }
        /* An administrator is never held here, even when their own school's
           licence has lapsed. This screen's whole message is "someone else must
           fix this" — and for them there is no someone else. The button is on
           /admin, so that is where they go. */
        if (data.role === "admin") return router.replace("/admin");
        setMe(data);
      } catch (e) {
        if (alive) setError(e.message);
      }
    };

    load();
    const id = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [router]);

  async function leave() {
    await supabase().auth.signOut();
    router.replace("/login");
  }

  if (error) {
    return (
      <Frame onLeave={leave}>
        <div className="note bad">{error}</div>
      </Frame>
    );
  }
  if (me === undefined) {
    return (
      <Frame onLeave={leave}>
        <Loader label="Checking your school's subscription" />
      </Frame>
    );
  }

  const ended = me.subscription?.endsAt ? new Date(me.subscription.endsAt) : null;
  const isStaff = me.role === "school" || me.role === "teacher";

  return (
    <Frame onLeave={leave}>
      <section className="hero rise">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="pill warn">Subscription ended</span>
            <h1 style={{ marginTop: 14 }}>{me.school?.name}</h1>
            <p>
              {ended
                ? `This school's DroneLab subscription ended on ${ended.toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}.`
                : "This school's DroneLab subscription has ended."}{" "}
              The simulator is closed until it is renewed.
            </p>
          </div>
          <div className="hero-art">
            <HeroDrone />
          </div>
        </div>
      </section>

      <div className="steps rise d1">
        <Step
          done
          icon={<Icon.Shield />}
          title="Nothing has been lost"
          body="Every build, every completed module and every flight is still recorded against each student's account, exactly as they left it. Renewing brings all of it back untouched."
        />
        <Step
          active
          icon={<Icon.School />}
          title={isStaff ? "Contact your DroneLab administrator" : "Your teacher needs to arrange this"}
          body={
            isStaff
              ? "Only a DroneLab administrator can extend the subscription. Once they set a new end date, this page lets everyone back in on its own — nobody needs to sign in again."
              : "There is nothing you can do from here, and nothing you have done wrong. Your school arranges the renewal with DroneLab."
          }
        />
        <Step
          icon={<Icon.Rocket />}
          title="Back to flying"
          body="Access returns the moment the new date is saved. This screen checks every few seconds, so you can leave it open."
        />
      </div>

      <div className="note" style={{ marginTop: 20 }}>
        You can close this page. Nothing is lost by signing out, and nothing needs re-entering when you
        come back.
      </div>
    </Frame>
  );
}

function Step({ icon, title, body, done, active }) {
  return (
    <div className={`step ${done ? "done" : ""} ${active ? "active" : ""}`}>
      <div className="step-ico">{done ? <Icon.Shield /> : icon}</div>
      <div>
        <strong>{title}</strong>
        <div className="sub" style={{ margin: "4px 0 0", fontSize: 13 }}>
          {body}
        </div>
      </div>
    </div>
  );
}
