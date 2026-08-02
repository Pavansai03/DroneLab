"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Shell from "../../components/Shell.jsx";
import { api } from "../../lib/api.js";
import { HeroDrone, Icon } from "../../components/DroneArt.jsx";
import { simulatorUrl } from "../../lib/simulator.js";

/**
 * THE STUDENT PANEL
 * =================
 * One question, answered above the fold: where am I up to, and what is next?
 *
 * Every module is listed whether or not it has been started. Showing only
 * started modules makes a fresh account look broken rather than new, and
 * hides the shape of the course from someone deciding whether to carry on.
 */
export default function StudentPage() {
  return <Shell>{(me) => <Panel me={me} />}</Shell>;
}

function Panel({ me }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.progress().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="note bad">{error}</div>;
  if (!data) return <p className="sub">Loading your progress…</p>;

  const { summary, modules, activity } = data;
  const next = modules.find((m) => !m.completed);

  return (
    <>
      {/* The hero states, in one glance, who you are and how far through you
          are. The ring is the headline because "how much is left" is the
          question a student actually opens this page with. */}
      <section className="hero rise">
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>
              Hello{me.profile?.full_name ? <>, <em>{me.profile.full_name.split(" ")[0]}</em></> : ""}
            </h1>
            <p>
              {me.school ? (
                <>
                  {me.school.name}
                  {me.profile?.class_code ? ` · class ${me.profile.class_code}` : ""} — you have finished{" "}
                  {summary.modulesCompleted} of {summary.modulesTotal} modules.
                </>
              ) : (
                <>
                  You have not joined a school yet. <Link href="/student/profile">Add your join code</Link> so
                  your teacher can see your progress.
                </>
              )}
            </p>
            <div className="row" style={{ marginTop: 22 }}>
              <div className="ring" style={{ "--pct": summary.percent }}>
                <span>{summary.percent}%</span>
              </div>
              <div>
                <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.7, marginBottom: 12 }}>
                  <strong style={{ color: "var(--text)" }}>{summary.flights}</strong> flights flown
                  <br />
                  <strong style={{ color: "var(--text)" }}>{summary.streak}</strong> day streak
                </div>
                {/* The point of the whole portal is to get someone into the
                    simulator, so it is the one primary button on the page. */}
                <a className="btn primary" href={simulatorUrl()} target="_blank" rel="noopener noreferrer">
                  <Icon.Play />
                  {next ? `Continue module ${next.number}` : "Open the simulator"}
                </a>
              </div>
            </div>
          </div>
          <div className="hero-art">
            <HeroDrone />
          </div>
        </div>
      </section>

      <div className="grid cols-4">
        <Stat icon={<Icon.Rocket />} value={`${summary.modulesCompleted}/${summary.modulesTotal}`} label="Modules complete" />
        <Stat icon={<Icon.Chart />} value={`${summary.percent}%`} label="Course progress" />
        <Stat icon={<Icon.Bolt />} value={summary.flights} label="Flights flown" />
        <Stat icon={<Icon.Shield />} value={summary.streak} label="Day streak" />
      </div>

      {next && (
        <>
          <h2>Pick up where you left off</h2>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>
                  Module {next.number} — {next.title}
                </strong>
                <div className="sub" style={{ margin: "6px 0 0" }}>
                  {next.currentTask ? `Next task: ${next.currentTask}` : "Not started yet."}
                </div>
              </div>
              <span className="pill info">
                {next.tasksDone}/{next.tasksTotal || "?"} tasks
              </span>
            </div>
          </div>
        </>
      )}

      <h2>All modules</h2>
      <div className="grid cols-2">
        {modules.map((m) => {
          const pct = m.tasksTotal ? Math.round((m.tasksDone / m.tasksTotal) * 100) : m.completed ? 100 : 0;
          return (
            <div className="card hover" key={m.id}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <strong>
                  {m.number}. {m.title}
                </strong>
                <span className={`pill ${m.completed ? "ok" : pct > 0 ? "warn" : "muted"}`}>
                  {m.completed ? "complete" : pct > 0 ? "in progress" : "not started"}
                </span>
              </div>
              <div className="bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="sub" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
                {m.tasksTotal ? `${m.tasksDone} of ${m.tasksTotal} tasks` : "No tasks recorded yet"}
                {m.updatedAt ? ` · last worked on ${new Date(m.updatedAt).toLocaleDateString()}` : ""}
              </div>
            </div>
          );
        })}
      </div>

      <h2>Recent practice</h2>
      {activity.length ? (
        <div className="card">
          <div className="spark">
            {[...activity]
              .reverse()
              .slice(-30)
              .map((d) => {
                const max = Math.max(...activity.map((x) => x.flights), 1);
                return (
                  <i
                    key={d.day}
                    style={{ height: `${Math.max(4, (d.flights / max) * 100)}%` }}
                    title={`${d.day}: ${d.flights} flights, ${d.crashes} crashes`}
                  />
                );
              })}
          </div>
          <div className="sub" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
            {summary.flights} flights and {summary.crashes} crashes over the last {activity.length} active
            days. Crashing is how the failure modules are meant to be learned — it is not a score.
          </div>
        </div>
      ) : (
        <div className="note">
          No flights recorded yet. Progress appears here once you have flown in the simulator while signed in.
        </div>
      )}
    </>
  );
}

/**
 * A stat tile. The icon carries the meaning at a glance; the number carries it
 * on a second look. Both matter — a wall of bare numbers takes real effort to
 * scan, and a wall of icons says nothing.
 */
function Stat({ icon, value, label, tone }) {
  return (
    <div className="stat">
      <i className="accentbar" />
      <div className="ico">{icon}</div>
      <b style={tone ? { color: `var(--${tone})` } : undefined}>{value}</b>
      <small>{label}</small>
    </div>
  );
}
