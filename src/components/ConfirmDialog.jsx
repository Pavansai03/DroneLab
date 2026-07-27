import React from "react";

/**
 * A small confirmation dialog for anything destructive.
 *
 * Stripping a build throws away everything the student wired and calibrated, so it
 * should never happen on a stray click — and the message says exactly what is about
 * to be lost rather than a generic "are you sure?".
 */
export default function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onCancel,
}) {
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 style={{ color: tone === "danger" ? "var(--red)" : "var(--text)" }}>
            {title}
          </h2>
          <p>{message}</p>
        </div>

        {detail && (
          <div className="modal-body">
            <div
              style={{
                fontSize: 11.5,
                lineHeight: 1.6,
                color: "var(--dim)",
                background: "var(--panel2)",
                border: "1px solid var(--border)",
                borderRadius: 9,
                padding: "10px 12px",
              }}
            >
              {detail}
            </div>
          </div>
        )}

        <div className="modal-foot">
          <button className="btn" onClick={onCancel} autoFocus>
            {cancelLabel}
          </button>
          <button
            className={`btn ${tone === "danger" ? "danger" : "primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
