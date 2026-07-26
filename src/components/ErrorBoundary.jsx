import React from "react";

/**
 * A blank screen is the worst thing that can happen in the middle of a lesson.
 * If anything throws, show what broke and offer a reload rather than nothing.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Keep the real stack in the console for whoever is debugging.
    console.error("DroneLab crashed:", error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#0b0e13",
          color: "#e7ecf2",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 620,
            border: "1px solid #262d39",
            borderRadius: 16,
            background: "#12161d",
            padding: "22px 26px",
          }}
        >
          <h2 style={{ margin: 0, color: "#ff5c62", fontSize: 18 }}>
            DroneLab hit an unexpected error
          </h2>
          <p style={{ color: "#8a94a6", fontSize: 13, lineHeight: 1.6 }}>
            The simulator stopped rather than showing you something wrong. Reloading
            starts a fresh build; your progress in this session is not saved.
          </p>
          <pre
            style={{
              background: "#0b0e13",
              border: "1px solid #262d39",
              borderRadius: 9,
              padding: 12,
              fontSize: 11,
              color: "#ffc7c9",
              overflowX: "auto",
              maxHeight: 220,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {String(error?.stack || error)}
            {info?.componentStack ? `\n${info.componentStack}` : ""}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 12,
              padding: "9px 16px",
              borderRadius: 8,
              border: "1px solid #ffab4a",
              background: "#ffab4a",
              color: "#1a1204",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Reload the simulator
          </button>
        </div>
      </div>
    );
  }
}
