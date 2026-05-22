const W = {
  wrap: {
    minHeight: "100vh",
    background: "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)",
    display: "flex", justifyContent: "center",
    fontFamily: '"Outfit",sans-serif', color: "#EDE9FE",
  },
  card: (extra = {}) => ({
    background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 16, ...extra,
  }),
  btn: (v = "primary", extra = {}) => ({
    ...(v === "primary" ? { background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", boxShadow: "0 8px 28px rgba(107,33,232,.4)" }
      : v === "gold" ? { background: "linear-gradient(135deg,#F5C518,#E5A800)", color: "#07021A", boxShadow: "0 8px 28px rgba(245,197,24,.4)" }
      : v === "danger" ? { background: "linear-gradient(135deg,#E8376B,#B01A4E)", color: "#fff" }
      : { background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", color: "#C4B5FD" }),
    border: v !== "ghost" ? "none" : undefined,
    borderRadius: 12, padding: "15px 20px", fontSize: 15, fontWeight: 700,
    cursor: "pointer", width: "100%", transition: "transform .15s,opacity .15s",
    fontFamily: '"Outfit",sans-serif', ...extra,
  }),
  label: { fontSize: 11, fontWeight: 600, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 8 },
  blob: (t, l, size, color) => ({
    position: "absolute", top: t, left: l, width: size, height: size,
    borderRadius: "50%", background: `radial-gradient(circle,${color} 0%,transparent 70%)`, pointerEvents: "none", zIndex: 0,
  }),
  back: (onClick) => (
    <button onClick={onClick} style={{ background: "none", border: "none", color: "#9B89CC", fontSize: 22, padding: "0 0 24px", cursor: "pointer", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8 }}>
      ← <span style={{ fontSize: 14, fontWeight: 600 }}>Wróć</span>
    </button>
  ),
};

export default function Pending({ onGoHome, onPractice }) {
  return (
    <div style={W.wrap}>
      <div className="fue-page" style={{ padding: "44px 28px", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={W.blob("30%", "20%", 260, "rgba(245,197,24,.08)")} />
        <div className="pi" style={{ fontSize: 64, marginBottom: 20 }}>⏳</div>
        <h2 className="su" style={{ fontFamily: '"Bebas Neue"', fontSize: 48, letterSpacing: 1.5, animationDelay: ".05s" }}>Oczekiwanie</h2>
        <p className="su" style={{ color: "#9B89CC", fontSize: 15, marginTop: 10, lineHeight: 1.7, animationDelay: ".12s", maxWidth: 320 }}>
          Twoje konto czeka na weryfikację przez administratora.<br />
          <br />
          Administrator sprawdzi Twoją przynależność do uczelni i aktywuje konto.
        </p>
        <div className="su" style={{ ...W.card({ padding: "20px", marginTop: 28, borderColor: "rgba(107,33,232,.3)" }), animationDelay: ".2s", width: "100%", maxWidth: 320 }}>
          <p style={{ fontSize: 12, color: "#9B89CC" }}>Co możesz zrobić teraz?</p>
          <button style={{ ...W.btn("ghost", { marginTop: 12, padding: "12px 16px", fontSize: 13 }) }} onClick={() => onPractice()}>
            📖 Przeglądaj przykładowe pytania
          </button>
        </div>
        <button onClick={() => onGoHome()} style={{ marginTop: 24, background: "none", border: "none", color: "#9B89CC", fontSize: 14, cursor: "pointer", textDecoration: "underline" }}>
          Wróć do strony głównej
        </button>
      </div>
    </div>
  );
}
