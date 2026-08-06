"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Shell from "../../components/Shell.jsx";
import { api } from "../../lib/api.js";
import { HeroDrone, Icon, Loader, Skeleton } from "../../components/DroneArt.jsx";
import { simulatorUrl, openSimulator } from "../../lib/simulator.js";

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
  if (!data) return <Loader label="Loading your progress" />;

  const { summary, modules } = data;
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
                  your school can see your progress.
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
                <a className="btn primary" href={simulatorUrl()} onClick={openSimulator}>
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

      <AskForHelp modules={modules} joined={Boolean(me.school)} />

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

/**
 * ASKING FOR HELP
 * ===============
 * The school panel has a "May need help" list. Until now the only way onto it
 * was to go quiet for a week and let the system guess — which is a strange way
 * to run a classroom, because the student who knows exactly what is wrong had
 * no way to say so.
 *
 * One open request at a time, replaceable. A student who is stuck is stuck on
 * one thing; letting them queue five makes the teacher's list longer without
 * making it more informative.
 */
function AskForHelp({ modules, joined }) {
  const [state, setState] = useState(null); // { requests, open }
  const [message, setMessage] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api.help.mine().then(setState).catch(() => setState({ requests: [], open: null }));
  }, []);

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.help.ask(message.trim(), moduleId || null);
      setState(await api.help.mine());
      setMessage("");
      setEditing(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id) {
    setBusy(true);
    setErr(null);
    try {
      await api.help.withdraw(id);
      setState(await api.help.mine());
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const answered = state.requests.filter((r) => r.status === "answered" && r.reply).slice(0, 2);
  const open = state.open;

  return (
    <>
      <h2>Stuck on something?</h2>

      {err && <div className="note bad" style={{ marginBottom: 12 }}>{err}</div>}

      {open && !editing ? (
        <div className="card help-card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <span className="pill warn">Waiting for your teacher</span>
              <p className="help-quote">{open.message}</p>
              <div className="sub" style={{ margin: 0, fontSize: 12.5 }}>
                {open.module_id ? `About ${labelFor(modules, open.module_id)} · ` : ""}
                sent {new Date(open.created_at).toLocaleDateString()}
              </div>
            </div>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <button
                className="btn small"
                disabled={busy}
                onClick={() => {
                  setMessage(open.message);
                  setModuleId(open.module_id ?? "");
                  setEditing(true);
                }}
              >
                Edit
              </button>
              <button className="btn small" disabled={busy} onClick={() => withdraw(open.id)}>
                I sorted it
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form className="card help-card" onSubmit={send}>
          <p className="sub" style={{ marginTop: 0 }}>
            {joined
              ? "Describe what is going wrong and your teacher will see it on their panel. Be specific — which part, which step, what happened."
              : "Join your school with its code first, so your question reaches someone."}
          </p>

          <div className="field">
            <label htmlFor="hm">Which module?</label>
            <select id="hm" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
              <option value="">Not about a particular module</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.number}. {m.title}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="hx">What do you need help with?</label>
            <textarea
              id="hx"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. The motors spin up but two of them turn the wrong way and I can't work out which wires to swap."
              maxLength={1000}
            />
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            {editing && (
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
            <button className="btn primary" disabled={busy || !joined || message.trim().length < 5}>
              {busy ? "Sending…" : editing ? "Update my question" : "Ask for help"}
            </button>
          </div>
        </form>
      )}

      {answered.length > 0 && (
        <div className="card help-card answered">
          <strong style={{ fontSize: 14 }}>Replies from your school</strong>
          {answered.map((r) => (
            <div key={r.id} className="help-reply">
              <p className="help-quote small">{r.message}</p>
              <p className="help-answer">{r.reply}</p>
              <div className="sub" style={{ margin: 0, fontSize: 12 }}>
                {r.answered_at ? new Date(r.answered_at).toLocaleDateString() : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function labelFor(modules, id) {
  const m = modules.find((x) => x.id === id);
  return m ? `module ${m.number}` : id;
}
