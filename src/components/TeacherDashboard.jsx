import React, { useCallback, useEffect, useState } from "react";
import { fetchRoster } from "../lib/useCloudSync.js";
import { MODULES } from "../data/curriculum.js";

/**
 * Teacher roster: who is in the class, how far they have got, and where they are
 * stuck right now.
 *
 * This reads the `class_roster` view, which has security_invoker on — so if a
 * student somehow opened this panel they would see exactly one row, their own.
 * The gate below is convenience, not the security boundary.
 */
export default function TeacherDashboard({ auth }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { rows: r, error: e } = await fetchRoster();
    setRows(r);
    setError(e);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (auth.isTeacher) load();
  }, [auth.isTeacher, load]);

  if (!auth.enabled) {
    return (
      <div className="empty">
        The teacher dashboard needs Supabase configured.
        <br />
        Progress is currently kept in this browser only.
      </div>
    );
  }

  if (!auth.user) {
    return <div className="empty">Sign in on the Account tab to see your class.</div>;
  }

  if (!auth.isTeacher) {
    return (
      <div>
        <div className="empty">
          This account is a student account, so there is no class to show.
        </div>
        <div className="sect-note">
          Teacher access is granted in Supabase Studio by inserting a row into{" "}
          <b className="mono">user_roles</b> — deliberately not something the app
          can do, or any student could promote themselves. The exact statement is
          at the bottom of <b className="mono">supabase/schema.sql</b>.
        </div>
      </div>
    );
  }

  const total = MODULES.length;

  return (
    <div>
      <div className="panel-head" style={{ borderTop: "1px solid var(--border)" }}>
        <h3>Class roster &middot; {rows.length}</h3>
        <button className="btn sm" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="tip" style={{ borderColor: "rgba(255,92,98,0.4)", background: "rgba(255,92,98,0.08)", color: "#ffc7c9" }}>
          {error}
        </div>
      )}

      {!error && rows.length === 0 && !loading && (
        <div className="empty">
          No students yet. They appear here as soon as they create an account.
        </div>
      )}

      {rows.map((r) => {
        const done = r.modules_completed ?? 0;
        const pct = Math.round((done / total) * 100);
        return (
          <div key={r.user_id} className="roster-row">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="roster-name">{r.full_name || "(no name given)"}</div>
              <div className="roster-meta">
                {r.class_code ? `${r.class_code} · ` : ""}
                {done === total
                  ? "All modules complete"
                  : r.stuck_on
                    ? `Working on ${r.stuck_on}`
                    : "Not started"}
              </div>
              {r.last_active && (
                <div className="roster-meta mono" style={{ opacity: 0.7 }}>
                  last active {new Date(r.last_active).toLocaleString()}
                </div>
              )}
            </div>
            <div style={{ width: 84, flexShrink: 0 }}>
              <div className="mono" style={{ fontSize: 10.5, color: done === total ? "var(--ok)" : "var(--amber)", textAlign: "right" }}>
                {done}/{total}
              </div>
              <div className="progress-track" style={{ marginTop: 4 }}>
                <div className={`progress-fill ${done === total ? "done" : ""}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        );
      })}

      <div className="sect-note">
        Rows update as students work. Row level security means a student querying
        the same view only ever sees themselves.
      </div>
    </div>
  );
}
