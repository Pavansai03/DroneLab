"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase.js";
import { api } from "../../../lib/api.js";
import { DroneBackdrop, HeroDrone, Icon, Loader } from "../../../components/DroneArt.jsx";

/**
 * APPROVAL PENDING
 * ================
 * Where a school waits.
 *
 * The hard part of this screen is not the waiting, it is the uncertainty: an
 * applicant who cannot tell whether anything is happening assumes it is broken
 * and applies again. So it states what has happened, what happens next, and
 * what to do meanwhile — and it polls, so an approval that lands while the tab
 * is open turns into the join code without anyone reloading.
 */
export default function PendingPage() {
  const router = useRouter();
  const [app, setApp] = useState(undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data: { session } } = await supabase().auth.getSession();
        if (!session) return router.replace("/login");
        const { application } = await api.school.application();
        if (alive) setApp(application);
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    load();
    /* Every 20 seconds. Frequent enough that an approval feels immediate to
       someone watching, rare enough to be invisible on a server bill. */
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [router]);

  if (error) return <main><div className="note bad">{error}</div></main>;
  if (app === undefined) return <main><Loader label="Checking your application" /></main>;

  if (!app) {
    return (
      <main style={{ maxWidth: 640 }}>
        <h1>No application found</h1>
        <p className="sub">This account has not registered a school.</p>
        <a className="btn primary" href="/login">Back to sign in</a>
      </main>
    );
  }

  const approved = app.status === "approved";
  const rejected = app.status === "rejected";

  return (
    <>
      <DroneBackdrop />
      <main style={{ maxWidth: 760 }}>
        <section className="hero rise">
          <div className="hero-inner">
            <div className="hero-copy">
              <span className={`pill ${approved ? "ok" : rejected ? "bad" : "warn"}`}>
                {approved ? "Approved" : rejected ? "Not approved" : "Awaiting review"}
              </span>
              <h1 style={{ marginTop: 14 }}>{app.name}</h1>
              <p>
                {approved
                  ? "Your school is live. Share the join code below with your students."
                  : rejected
                    ? "This application was not approved."
                    : "Your application has been received and is with our team."}
              </p>
            </div>
            <div className="hero-art"><HeroDrone /></div>
          </div>
        </section>

        {approved ? (
          <>
            <div className="joincode-card rise d1">
              <small>Your join code</small>
              <b className="mono">{app.join_code}</b>
              <p>
                Students enter this once, after signing up. Until they do, they can sign in but the
                simulator stays locked — so this code is what puts them on your dashboard.
              </p>
              <button
                className="btn"
                onClick={() => navigator.clipboard?.writeText(app.join_code)}
              >
                Copy code
              </button>
            </div>
            <div className="note" style={{ margin: "18px 0" }}>
              Treat it like a door key: anyone holding it can join your school and appear on your
              roster. Circulate it within the school only.
            </div>
            <a className="btn primary" href="/school">Go to my school dashboard</a>
          </>
        ) : rejected ? (
          <>
            {app.decision_note && (
              <div className="note bad" style={{ marginBottom: 16 }}>
                <strong>Reason given:</strong> {app.decision_note}
              </div>
            )}
            <div className="note">
              If you think this is a mistake, reply to the email we sent to{" "}
              <b>{app.contact_email}</b> and we will take another look.
            </div>
          </>
        ) : (
          <>
            <div className="steps rise d1">
              <Step done icon={<Icon.School />} title="Application received"
                body={`Submitted ${new Date(app.applied_at).toLocaleString()}.`} />
              <Step active icon={<Icon.Shield />} title="Under review"
                body="An administrator checks that the school is genuine. This is usually within one working day." />
              <Step icon={<Icon.Users />} title="Join code issued"
                body={`We email it to ${app.contact_email}. Give it to your students and they are in.`} />
            </div>
            <div className="note" style={{ marginTop: 20 }}>
              You can close this page. This screen updates on its own, and the code arrives by email
              either way — nothing is lost if you sign out.
            </div>
          </>
        )}
      </main>
    </>
  );
}

function Step({ icon, title, body, done, active }) {
  return (
    <div className={`step ${done ? "done" : ""} ${active ? "active" : ""}`}>
      <div className="step-ico">{done ? <Icon.Shield /> : icon}</div>
      <div>
        <strong>{title}</strong>
        <div className="sub" style={{ margin: "4px 0 0", fontSize: 13 }}>{body}</div>
      </div>
    </div>
  );
}
