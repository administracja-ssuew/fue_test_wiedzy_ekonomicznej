// Pełnoekranowa zapowiedź modułu (30 s) — wspólna dla uczestnika i Live View.
// Sterowana liczbą sekund do startu (z q_started_at), więc jest zsynchronizowana.
export default function ModuleIntroFS({ mod, secondsLeft }) {
  const color = mod?.color || "#6B21E8";
  const s = Math.max(0, secondsLeft ?? 0);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "var(--fue-bg,linear-gradient(160deg,#070215,#0E0435,#070215))",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE", textAlign: "center", padding: 28,
    }}>
      <p style={{ fontSize: 13, letterSpacing: 3, textTransform: "uppercase", color: "#9B89CC", marginBottom: 18 }}>Następny moduł</p>
      {mod?.icon ? <div style={{ fontSize: 72, marginBottom: 10 }}>{mod.icon}</div> : null}
      <h1 style={{
        fontFamily: '"Bebas Neue",sans-serif', fontSize: "clamp(40px,9vw,90px)", letterSpacing: 2,
        lineHeight: 1.05, color, margin: 0, textShadow: `0 0 40px ${color}55`,
      }}>
        {mod?.name || "Moduł"}
      </h1>
      {mod?.desc ? <p style={{ fontSize: "clamp(14px,2.4vw,20px)", color: "#9B89CC", marginTop: 14, maxWidth: 620 }}>{mod.desc}</p> : null}
      <div style={{ marginTop: 34, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: "clamp(48px,12vw,110px)", color: s <= 3 ? "#10D9A0" : "#F5C518", lineHeight: 1 }}>
          {s > 0 ? s : "START!"}
        </span>
        {s > 0 && <span style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#9B89CC" }}>start za</span>}
      </div>
    </div>
  );
}
