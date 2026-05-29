import { Component } from "react";
import { recordClientError } from "../lib/supabase.js";

// Catches render/runtime errors anywhere in the tree so a single bug can't
// blank the whole app for a participant during the live event. Shows a
// friendly recovery screen with a reload button and logs the error for triage.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Best-effort remote log — never throws (recordClientError swallows failures).
    recordClientError({
      where: "ErrorBoundary",
      message: error?.message || String(error),
      stack: (info?.componentStack || error?.stack || "").slice(0, 2000),
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        minHeight: "100vh", background: "var(--fue-bg,#070215)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE", padding: 28, textAlign: "center",
      }}>
        <div style={{ maxWidth: 380, width: "100%" }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>😵‍💫</div>
          <h2 style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: 38, letterSpacing: 1, color: "#F5C518", marginBottom: 12 }}>
            Coś poszło nie tak
          </h2>
          <p style={{ color: "#9B89CC", fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
            Aplikacja napotkała nieoczekiwany błąd. Odśwież stronę — Twój kod uczestnika
            i postęp w quizie pozostają zapisane.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", border: "none",
              borderRadius: 12, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer",
              fontFamily: '"Space Grotesk",sans-serif', boxShadow: "0 8px 28px rgba(107,33,232,.4)",
            }}>
            🔄 Odśwież stronę
          </button>
        </div>
      </div>
    );
  }
}
