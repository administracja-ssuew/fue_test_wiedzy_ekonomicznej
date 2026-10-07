import { useState, useEffect } from "react";

// Ekran pauzy - czysto prezentacyjny (Faza 6). Wznowienie przychodzi z projekcji planu
// w useParticipantGame (App przełącza ekran), więc bez własnego kanału i polla.
// Dwa tryby:
//  • isAdminPause - ręczna pauza admina („Wstrzymano”),
//  • przerwa planowa (06-12, po module 3 - sekcja 46; plany sprzed 46: 2 i 4) - „Przerwa” + następny moduł. Widoczna od
//    chwili kotwica + r z projekcji lokalnej, zanim zamiatacz zapisze pauzę w bazie.
// Koniec gry obsługuje wyłącznie Ended („Koniec testu”).
// eslint-disable-next-line no-unused-vars
export default function Break({ participant, nextModule, nextModuleName, nextModuleIcon, isAdminPause }) {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const t = setInterval(() => setDots((d) => d.length >= 3 ? "." : d + "."), 600);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE" }}>
      <div style={{ textAlign: "center", padding: "40px 28px", maxWidth: 420 }}>
        <div style={{ fontSize: 64, marginBottom: 20, animation: "bd 2s ease-in-out infinite" }}>
          {isAdminPause ? "⏸️" : "☕"}
        </div>
        <h2 style={{ fontFamily: '"Bebas Neue"', fontSize: 52, letterSpacing: 2, color: isAdminPause ? "#F5C518" : "#EDE9FE", marginBottom: 8 }}>
          {isAdminPause ? "Wstrzymano" : "Przerwa"}
        </h2>
        {isAdminPause ? (
          <p style={{ fontSize: 16, color: "#9B89CC", lineHeight: 1.7, marginBottom: 28 }}>
            Quiz został chwilowo wstrzymany przez administratora.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 17, color: "#EDE9FE", fontWeight: 600, lineHeight: 1.6, marginBottom: 8 }}>
              {nextModuleIcon ? `${nextModuleIcon} ` : ""}Moduł {nextModule}{nextModuleName ? ` - ${nextModuleName}` : ""} rozpocznie się po przerwie.
            </p>
            <p style={{ fontSize: 15, color: "#9B89CC", lineHeight: 1.7, marginBottom: 28 }}>
              Zrób sobie chwilę przerwy - quiz wznowi prowadzący.
            </p>
          </>
        )}
        <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 14, padding: "16px 24px", display: "inline-flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#F5C518", animation: "pulse 1.5s infinite" }} />
          <span style={{ fontSize: 13, color: "#9B89CC" }}>{isAdminPause ? "Oczekiwanie na administratora" : "Czekamy na wznowienie"}{dots}</span>
        </div>
        <p style={{ fontSize: 11, color: "rgba(155,137,204,.3)", marginTop: 28 }}>Forum Uczelni Ekonomicznych</p>
      </div>
    </div>
  );
}
