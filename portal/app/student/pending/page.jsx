"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase.js";
import { api } from "../../../lib/api.js";
import Brand from "../../../components/Brand.jsx";
import { DroneBackdrop, HeroDrone, Icon, Loader } from "../../../components/DroneArt.jsx";

/**
 * WAITING TO BE LET IN
 * ====================
 * A student has entered a valid join code. That attaches them to a school; it
 * does not admit them. An administrator decides.
 *
 * The screen's job is to remove doubt. Someone who cannot tell whether anything
 * is happening assumes it is broken — they re-enter the code, then make a
 * second account, and now there are two records to reconcile. So it says what
 * has happened, who is deciding and roughly when, and it polls: an approval
 * that lands while the tab is open moves them on without a reload.
 *
 * Built from the same parts as the school's pending screen on purpose. The two
 * are the same situation seen from either end, and a student who has watched a
 * teacher wait on this exact layout knows what they are looking at.
 */
export default function StudentPendingPage() {
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

        // Approved while this was open, or never needed this page at all.
        if (data.admitted) return router.replace("/student");
        // No code entered yet — the join screen is where they belong.
        if (!data.school) return router.replace("/student/join");

        setMe(data);
      } catch (e) {
        if (alive) setError(e.message);
      }
    };

    load();
    /* Every 20 seconds, matching the school's pending screen. Often enough that
       an approval feels immediate to someone sitting watching it, rare enough
       to be invisible on a server bill. */
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

  const Frame = ({ children }) => (
    <>
      <DroneBackdrop />
      <div className="shell">
        <header className="topbar">
          <Brand />
          <div className="spacer" />
          <button className="btn small" onClick={leave}>
            Sign out
          </button>
        </header>
        <main style={{ maxWidth: 760 }}>{children}</main>
      </div>
    </>
  );

  if (error) {
    return (
      <Frame>
        <div className="note bad">{error}</div>
      </Frame>
    );
  }
  if (me === undefined) {
    return (
      <Frame>
        <Loader label="Checking your place in the queue" />
      </Frame>
    );
  }

  const rejected = me.approval?.status === "rejected";

  return (
    <Frame>
      <section className="hero rise">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className={`pill ${rejected ? "bad" : "warn"}`}>
              {rejected ? "Not approved" : "Awaiting approval"}
            </span>
            <h1 style={{ marginTop: 14 }}>{me.school?.name}</h1>
            <p>
              {rejected
                ? "An administrator reviewed your request to join this school and did not approve it."
                : "Your join code was accepted. An administrator checks each student before the simulator is unlocked."}
            </p>
          </div>
          <div className="hero-art">
            <HeroDrone />
          </div>
        </div>
      </section>

      {rejected ? (
        <>
          {me.approval?.note && (
            <div className="note bad" style={{ marginBottom: 16 }}>
              <strong>Reason given:</strong> {me.approval.note}
            </div>
          )}
          <div className="note">
            If you think this is a mistake, speak to your teacher — they can ask the administrator to
            look again. Do not make a second account: the decision is attached to your school
            membership, not to this login, so a new account would land in exactly the same place.
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn" onClick={leave}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="steps rise d1">
            <Step
              done
              icon={<Icon.School />}
              title="Join code accepted"
              body={
                me.approval?.joinedAt
                  ? `You joined ${me.school?.name} on ${new Date(me.approval.joinedAt).toLocaleString()}.`
                  : `You are attached to ${me.school?.name}.`
              }
            />
            <Step
              active
              icon={<Icon.Shield />}
              title="An administrator is reviewing your request"
              body="Every student is checked before the simulator is unlocked, because a join code gets circulated and cannot prove who is holding it. This is usually within one school day."
            />
            <Step
              icon={<Icon.Rocket />}
              title="The simulator unlocks"
              body="Your progress starts saving to your school's dashboard from your first flight."
            />
          </div>

          <div className="note" style={{ marginTop: 20 }}>
            Nothing else to do, and nothing to re-enter. You can close this page — your place in the
            queue is attached to your account, not to this tab, and this screen moves you on by
            itself when the decision lands.
          </div>

          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn" onClick={leave}>
              Sign out
            </button>
          </div>
        </>
      )}
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
