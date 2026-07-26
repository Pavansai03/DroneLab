import React from "react";

/**
 * CRASH REPORT — the last item in Module 5's failure list.
 * A post-mortem written the way an accident investigator would: what the aircraft
 * was doing, which components had already failed, and which decision tree predicted it.
 */
export default function CrashReport({ report, onRepair, onDismiss }) {
  if (!report) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <h2 style={{ color: "var(--red)" }}>Crash Report</h2>
          <p>
            Read it top to bottom. The primary cause is rarely the first thing that
            broke — work back up the chain to find the real fault.
          </p>
        </div>

        <div className="modal-body">
          {report.lines.map((l) => (
            <div className="kv-row" key={l.k}>
              <span className="k">{l.k}</span>
              <span className="v">{l.v}</span>
            </div>
          ))}

          {report.failureModel && (
            <>
              <div
                style={{
                  marginTop: 16,
                  fontSize: 10,
                  letterSpacing: "0.09em",
                  color: "var(--faint)",
                  fontWeight: 700,
                }}
              >
                MULTI-ROTOR FAILURE MODEL &mdash; {report.failureModel.title.toUpperCase()}
              </div>
              <div className="chain">
                {report.failureModel.chain.map((c) => (
                  <div className="chain-item" key={c}>
                    {c}
                  </div>
                ))}
              </div>
            </>
          )}

          {report.failingTrees.length > 0 && (
            <>
              <div
                style={{
                  marginTop: 16,
                  fontSize: 10,
                  letterSpacing: "0.09em",
                  color: "var(--faint)",
                  fontWeight: 700,
                }}
              >
                DECISION TREES REPORTING A FAULT
              </div>
              <div className="chain">
                {report.failingTrees.map((c) => (
                  <div className="chain-item" key={c}>
                    {c}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onDismiss}>
            Keep the wreckage (study it)
          </button>
          <button className="btn primary" onClick={onRepair}>
            Repair and reset for another flight
          </button>
        </div>
      </div>
    </div>
  );
}
