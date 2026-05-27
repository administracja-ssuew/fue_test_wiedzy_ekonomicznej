// Pełnoekranowe odliczanie 3→2→1→START! wyświetlane przed startem quizu.
// num: 3, 2, 1 = cyfra; 0 = "START!"; null = ukryte (nie renderuj tego komponentu)
export default function Countdown({ num }) {
  const isGo = num === 0;
  const color = isGo ? "#10D9A0" : num === 1 ? "#E8376B" : num === 2 ? "#FF9A3C" : "#F5C518";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "var(--fue-bg, linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%))",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: '"Bebas Neue", sans-serif',
      overflow: "hidden",
    }}>
      {/* Pulsing ring behind the number */}
      <div key={`ring-${num}`} style={{
        position: "absolute",
        width: "min(60vw, 60vh)", height: "min(60vw, 60vh)",
        borderRadius: "50%",
        border: `3px solid ${color}`,
        opacity: 0,
        animation: "cdring 1s ease-out forwards",
      }} />
      {/* The number / GO text */}
      <span key={num} style={{
        fontSize: isGo ? "clamp(72px, 16vw, 140px)" : "clamp(120px, 28vw, 260px)",
        color,
        textShadow: `0 0 80px ${color}60, 0 0 160px ${color}30`,
        animation: "cdnum 1s ease-out forwards",
        lineHeight: 1,
        userSelect: "none",
        letterSpacing: isGo ? "0.08em" : "normal",
      }}>
        {isGo ? "START!" : num}
      </span>
      <p style={{
        position: "absolute", bottom: 32, fontSize: 11,
        color: "rgba(155,137,204,.3)", letterSpacing: 1,
      }}>Forum Uczelni Ekonomicznych</p>
    </div>
  );
}
