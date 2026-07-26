import React from "react";
import { Check } from "./Icons.jsx";

/**
 * The module's task chain, exactly as printed in the course notes. Each item
 * ticks itself when the student's build or flight genuinely satisfies it.
 */
export default function TaskChecklist({ module, progress, actions }) {
  return (
    <div>
      <div className="panel-head">
        <h3>
          Module {module.number} &middot; {progress.doneCount}/{progress.total}
        </h3>
        <div className="progress-track">
          <div
            className={`progress-fill ${progress.complete ? "done" : ""}`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      <div className="sect-note">
        <b style={{ color: "var(--text)" }}>Objective:</b> {module.objective}
      </div>

      <div className="task-list">
        {progress.tasks.map((t, i) => {
          const isCurrent = i === progress.currentIndex;
          return (
            <div
              key={t.id}
              className={`task ${t.done ? "done" : ""} ${isCurrent ? "current" : ""}`}
            >
              <span className="task-mark">{t.done ? <Check size={11} /> : i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div className="task-label">{t.label}</div>
                {isCurrent && <div className="task-hint">{t.hint}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {actions?.length > 0 && (
        <>
          <div className="cat-row">Bench actions</div>
          <div style={{ padding: "8px 10px 14px", display: "grid", gap: 6 }}>
            {actions.map((a) => (
              <button
                key={a.id}
                className={`btn wide ${a.tone || ""}`}
                disabled={a.disabled}
                onClick={a.onClick}
                title={a.title}
              >
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
