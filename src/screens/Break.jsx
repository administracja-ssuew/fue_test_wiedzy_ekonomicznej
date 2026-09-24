import { useState, useEffect } from "react";

// Ekran pauzy — czysto prezentacyjny (Faza 6). Wznowienie przychodzi z projekcji planu
// w useParticipantGame (App przełącza ekran), więc bez własnego kanału i polla.
// eslint-disable-next-line no-unused-vars
export default function Break({ participant, nextModule, isAdminPause }) {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const t = setInterval(() => setDots((d) => d.length >= 3 ? "." : d + "."), 600);
    return () => clearInterval(t);
  }, []);

  const isResults     = !nextModule && !isAdminPause;
  const isAdminPauseMode = isAdminPause;

  return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE" }}>
      <div style={{ textAlign: "center", padding: "40px 28px", maxWidth: 420 }}>
        <div style={{ fontSize: 64, marginBottom: 20, animation: "bd 2s ease-in-out infinite" }}>
          {isResults ? "🏆" : isAdminPauseMode ? "⏸️" : "☕"}
        </div>
        <h2 style={{ fontFamily: '"Bebas Neue"', fontSize: 52, letterSpacing: 2, color: isResults ? "#F5C518" : isAdminPauseMode ? "#F5C518" : "#EDE9FE", marginBottom: 8 }}>
          {isResults ? "Chwila!" : isAdminPauseMode ? "Wstrzymano" : "Przerwa"}
        </h2>
        <p style={{ fontSize: 16, color: "#9B89CC", lineHeight: 1.7, marginBottom: 28 }}>
          {isResults
            ? "Zaraz nastąpi ogłoszenie wyników końcowych."
            : isAdminPauseMode
            ? "Quiz został chwilowo wstrzymany przez administratora."
            : <>Moduł {nextModule} rozpocznie się za chwilę.<br />Zrób sobie chwilę przerwy.</>}
        </p>
        <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 14, padding: "16px 24px", display: "inline-flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#F5C518", animation: "pulse 1.5s infinite" }} />
          <span style={{ fontSize: 13, color: "#9B89CC" }}>Oczekiwanie na administratora{dots}</span>
        </div>
        <p style={{ fontSize: 11, color: "rgba(155,137,204,.3)", marginTop: 28 }}>Forum Uczelni Ekonomicznych</p>
      </div>
    </div>
  );
}
