
import { useState, useEffect } from "react";
import { getModule, moduleQuestions } from "../lib/gameLogic.js";
import { useModules } from "../context/ModulesContext.jsx";

const W = {
  wrap: {
    minHeight: "100vh",
    background: "var(--fue-bg)",
    display: "flex", justifyContent: "center",
    fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE",
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
    fontFamily: '"Space Grotesk",sans-serif', ...extra,
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

export default function ModuleIntro({ currentMod, onStart }) {
  const MODULES = useModules();
  const mod = getModule(currentMod, MODULES);
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    if (countdown <= 0) { onStart(); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  return (
    <div style={W.wrap}>
      <div className="fue-page" style={{ justifyContent: "center", alignItems: "center", padding: "40px 28px", textAlign: "center" }}>
        <div style={W.blob("20%", "10%", 250, `${mod?.color || "#6B21E8"}22`)} />
        <div className="pi" style={{ fontSize: 72, marginBottom: 16 }}>{mod?.icon}</div>
        <div style={{ display: "inline-block", background: `${mod?.color || "#6B21E8"}22`, border: `1px solid ${mod?.color || "#6B21E8"}44`, borderRadius: 20, padding: "4px 14px", fontSize: 11, fontWeight: 600, color: "#C4B5FD", marginBottom: 12 }}>
          MODUŁ {currentMod} / {MODULES.length}
        </div>
        <h2 className="su" style={{ fontFamily: '"Bebas Neue"', fontSize: 56, letterSpacing: 2, color: "#fff", animationDelay: ".05s" }}>
          {mod?.name}
        </h2>
        <p className="su" style={{ color: "#9B89CC", fontSize: 14, marginTop: 8, animationDelay: ".1s" }}>
          {moduleQuestions(currentMod).length} pytań · {mod?.timePerQ} sekund na odpowiedź
        </p>
        <p className="su" style={{ color: "#9B89CC", fontSize: 14, marginTop: 4, animationDelay: ".14s" }}>
          {mod?.desc}
        </p>
        <div className="su" style={{ marginTop: 40, animationDelay: ".2s" }}>
          <p style={{ fontSize: 13, color: "#9B89CC", marginBottom: 8 }}>Start za</p>
          <p style={{ fontFamily: '"Bebas Neue"', fontSize: 96, color: mod?.color || "#6B21E8", lineHeight: 1, transition: "color .3s" }}>
            {countdown}
          </p>
        </div>
      </div>
    </div>
  );
}
