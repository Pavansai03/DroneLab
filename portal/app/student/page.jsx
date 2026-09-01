"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "../../components/Shell.jsx";
import { api } from "../../lib/api.js";
import { ExportStudent } from "../../components/Export.jsx";
import CopterSelect from "../../components/CopterSelect.jsx";
import { FRAMES, frameLabel } from "../../lib/frames.js";
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
  /* Which copter the page is about. "all" is the whole course — three modules
     on each of three aircraft — and is what the ring has always been trying to
     show; it just used to have one aircraft to show it about. */
  const [frame, setFrame] = useState("all");

  useEffect(() => {
    api.progress().then(setData).catch((e) => setError(e.message));
  }, []);

  /* Hooks must not sit behind the early returns below. */
  const view = useMemo(() => (data ? viewFor(data, frame) : null), [data, frame]);

  if (error) return <div className="note bad">{error}</div>;
  if (!data || !view) return <Loader label="Loading your progress" />;

  const { summary, modules } = view;
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
                  {summary.modulesCompleted} of {summary.modulesTotal} modules
                  {frame === "all" ? " across all three copters" : ` on the ${frameLabel(frame).toLowerCase()}`}.
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

      {/* The copter picker sits with the figures it governs, not in the header.
          Every number below this line changes when it changes, and a filter
          that lives somewhere else is one a reader stops connecting to what it
          filters. */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", margin: "4px 0 -6px" }}>
        <CopterSelect value={frame} onChange={setFrame} />
        <span className="cell-sub">
          {frame === "all"
            ? "Each copter is built from Module 1 — the course is three modules on each of three aircraft."
            : `Showing the ${frameLabel(frame).toLowerCase()} only.`}
        </span>
      </div>

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
                  {next.frameLabel ? `${next.frameLabel} · ` : ""}Module {next.number} — {next.title}
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

      <AskForHelp modules={view.sections[0]?.modules ?? modules} joined={Boolean(me.school)} />

      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <h2 style={{ marginBottom: 0 }}>
          {frame === "all" ? "All modules, copter by copter" : `${frameLabel(frame)} modules`}
        </h2>
        {/* A student's own report, built from the data already on this page —
            no extra request, and nothing in it they cannot already see.
            The whole payload goes in, not the current filter: a report that
            silently omitted two of the three copters because of a dropdown
            someone left set would be the worst kind of wrong. */}
        <ExportStudent
          small
          label="Export my report"
          name={me.profile?.full_name}
          data={{
            student: {
              full_name: me.profile?.full_name,
              email: me.email,
              class_code: me.profile?.class_code,
              student_status: me.approval?.status,
              joined_at: me.approval?.joinedAt,
              decided_at: me.approval?.decidedAt,
            },
            school: me.school,
            byFrame: data.byFrame,
            overall: data.overall,
            unattributed: data.unattributed,
            modules: data.modules,
            activity: data.activity,
          }}
        />
      </div>

      {/* Grouped by aircraft even when only one is shown, so the heading always
          says which copter these three modules belong to. A tick with no
          aircraft against it is the ambiguity this whole change removes. */}
      {view.sections.map((s) => (
        <div key={s.frame.id}>
          {view.sections.length > 1 && (
            <div className="frame-heading">
              <h3>{s.frame.label}</h3>
              <span className="cell-sub">
                {s.summary.modulesCompleted}/{s.summary.modulesTotal} modules
                {s.summary.flights
                  ? ` · ${s.summary.flights} flight${s.summary.flights === 1 ? "" : "s"}`
                  : ""}
              </span>
            </div>
          )}
          <div className="grid cols-2">
            {s.modules.map((m) => {
              const pct = m.tasksTotal
                ? Math.round((m.tasksDone / m.tasksTotal) * 100)
                : m.completed
                  ? 100
                  : 0;
              return (
                <div className="card hover" key={`${s.frame.id}:${m.id}`}>
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
        </div>
      ))}

      {/* Practice logged before flights were recorded against an aircraft.
          Shown rather than folded into the quadcopter's total, which would be a
          number invented to look tidy. */}
      {frame === "all" && (data.unattributed?.flights ?? 0) > 0 && (
        <div className="note" style={{ marginTop: 16 }}>
          {data.unattributed.flights} earlier flight
          {data.unattributed.flights === 1 ? "" : "s"} were logged before the simulator
          recorded which copter flew them. They count in your totals but are not shown against
          any one aircraft.
        </div>
      )}
    </>
  );
}

/**
 * WHAT THIS PAGE IS SHOWING, GIVEN THE DROPDOWN.
 *
 * One copter narrows to that copter's three modules and its own flights. "All
 * copters" is the whole course: nine modules, laid out aircraft by aircraft
 * rather than added into a single list, because "Module 2" means nothing
 * without saying Module 2 of what.
 *
 * The fallback matters. A browser holding this page against an API that has not
 * been redeployed gets no `byFrame`, and the honest thing is to show the one
 * unlabelled course it does have rather than an empty page.
 */
function viewFor(data, frame) {
  const byFrame = data.byFrame;

  if (!byFrame) {
    const modules = data.modules ?? [];
    return {
      summary: data.summary ?? { modulesCompleted: 0, modulesTotal: 0, percent: 0, flights: 0, streak: 0 },
      modules,
      sections: [{ frame: { id: "quad", label: "Your copter" }, modules, summary: data.summary ?? {} }],
    };
  }

  if (frame !== "all" && byFrame[frame]) {
    const f = byFrame[frame];
    return {
      summary: f.summary,
      modules: f.modules,
      sections: [{ frame: f.frame, modules: f.modules, summary: f.summary }],
    };
  }

  const sections = FRAMES.filter((f) => byFrame[f.id]).map((f) => ({
    frame: f,
    modules: byFrame[f.id].modules,
    summary: byFrame[f.id].summary,
  }));

  return {
    summary: data.overall ?? data.summary,
    /* Flattened only so "pick up where you left off" can find the first
       unfinished thing; each entry carries the copter it belongs to. */
    modules: sections.flatMap((s) =>
      s.modules.map((m) => ({ ...m, frameId: s.frame.id, frameLabel: s.frame.label }))
    ),
    sections,
  };
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
