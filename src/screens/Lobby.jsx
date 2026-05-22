import { useState, useEffect, useRef } from "react";
import { MODULES } from "../data/questions.js";
import { moduleQuestions } from "../lib/gameLogic.js";
import { supabase, DEMO, getSessionForCity } from "../lib/supabase.js";

const CITY_ICONS = { Kraków: "🏰", Warszawa: "🏛️", Poznań: "🐐", Wrocław: "🦌", Katowice: "⚙️" };
const CITY_COLORS = { Kraków: "#FFA653", Warszawa: "#FF6B6B", Poznań: "#4ECDC4", Wrocław: "#45B7D1", Katowice: "#FF6B9D" };

export default function Lobby({ participant, isDesktop, isPractice, onStartQuiz, onPractice }) {
  const [session, setSession]   = useState(null);
  const [dots, setDots]         = useState(".");
  const pollRef                 = useRef(null);
  const city                    = participant?.city;
  const color                   = CITY_COLORS[city] || "#6B21E8";

  // Animate waiting dots
  useEffect(() => {
    const t = setInterval(() => setDots((d) => d.length >= 3 ? "." : d + "."), 600);
    return () => clearInterval(t);
  }, []);

  // Poll session status every 3s (works in DEMO + production fallback)
  useEffect(() => {
    if (!city) return;
    const check = async () => {
      const s = await getSessionForCity(city);
      setSession(s);
      if (s?.status === "running") {
        clearInterval(pollRef.current);
        onStartQuiz(s);
      }
    };
    check();
    pollRef.current = setInterval(check, 3000);
    return () => clearInterval(pollRef.current);
  }, [city]);

  // Supabase Realtime subscription (instant, no polling delay)
  useEffect(() => {
    if (DEMO || !supabase || !city) return;
    const channel = supabase.channel(`lobby-${city}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "quiz_sessions",
        filter: `city=eq.${city}`,
      }, ({ new: s }) => {
        setSession(s);
        if (s.status === "running") {
          clearInterval(pollRef.current);
          onStartQuiz(s);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [city]);

  const statusMsg = !session
    ? { icon: "🔍", text: "Łączenie z sesją" + dots, color: "#9B89CC" }
    : session.status === "waiting"
    ? { icon: "⏳", text: "Oczekiwanie na start" + dots, color: "#9B89CC" }
    : session.status === "paused"
    ? { icon: "⏸️", text: "Quiz wstrzymany przez administratora", color: "#F5C518" }
    : session.status === "running"
    ? { icon: "🚀", text: "Startujemy!", color: "#10D9A0" }
    : { icon: "🏁", text: "Sesja zakończona", color: "#E8376B" };

  return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE" }}>
      <div className="fue-page" style={{ padding: isDesktop ? "40px 0 48px" : "40px 24px 32px", position: "relative" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <div>
            {isPractice && (
              <span style={{ background: "rgba(16,217,160,.2)", border: "1px solid rgba(16,217,160,.4)", borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 700, color: "#10D9A0", display: "inline-block", marginBottom: 6 }}>
                🔬 PRÓBNY TEST
              </span>
            )}
            <p style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", fontWeight: 600 }}>🐐 FUE QUIZ</p>
            <h2 style={{ fontFamily: '"Bebas Neue"', fontSize: isDesktop ? 48 : 34, letterSpacing: 1 }}>Test Wiedzy Ekonomicznej</h2>
          </div>
          <div style={{ background: `${color}20`, border: `1px solid ${color}40`, borderRadius: 14, padding: "10px 16px", textAlign: "center" }}>
            <p style={{ fontSize: 20 }}>{CITY_ICONS[city] || "🎓"}</p>
            <p style={{ fontSize: 12, fontWeight: 700, color, marginTop: 4 }}>{city}</p>
          </div>
        </div>

        {/* Participant card */}
        <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 16, padding: "18px 20px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: "50%", background: `${color}30`, border: `1px solid ${color}50`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color, flexShrink: 0 }}>
              {participant?.name?.[0]?.toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 700, fontSize: 15 }}>{participant?.name} {participant?.surname}</p>
              <p style={{ color: "#9B89CC", fontSize: 12, marginTop: 2 }}>
                Kod: <span style={{ fontFamily: '"Bebas Neue"', letterSpacing: 1.5, color: "#C4B5FD", fontSize: 14 }}>{participant?.code}</span>
              </p>
            </div>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10D9A0", boxShadow: "0 0 8px #10D9A0", animation: "pulse 1.5s infinite" }} />
          </div>
        </div>

        {/* Status card */}
        <div style={{ background: `${statusMsg.color}12`, border: `1px solid ${statusMsg.color}30`, borderRadius: 16, padding: "24px", marginBottom: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{statusMsg.icon}</div>
          <p style={{ fontFamily: '"Bebas Neue"', fontSize: 22, letterSpacing: 1, color: statusMsg.color }}>{statusMsg.text}</p>
          {(session?.status === "waiting" || !session) && (
            <p style={{ color: "#9B89CC", fontSize: 13, marginTop: 8 }}>
              Poczekaj — administrator zaraz rozpocznie quiz dla {city}.
            </p>
          )}
          {session?.status === "paused" && (
            <p style={{ color: "#9B89CC", fontSize: 13, marginTop: 8 }}>
              Quiz zostanie wznowiony przez administratora. Zostań na tej stronie.
            </p>
          )}
        </div>

        {/* Quiz structure */}
        <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "16px 20px", marginBottom: 16 }}>
          <p style={{ fontSize: 11, color: "#9B89CC", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 12 }}>Struktura testu</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {MODULES.map((m) => (
              <div key={m.id} style={{ background: `${m.color}12`, border: `1px solid ${m.color}25`, borderRadius: 10, padding: "10px 12px" }}>
                <span style={{ fontSize: 16 }}>{m.icon}</span>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#EDE9FE", marginTop: 4 }}>{m.name}</p>
                <p style={{ fontSize: 11, color: "#9B89CC" }}>{moduleQuestions(m.id).length} pyt. · {m.timePerQ}s</p>
              </div>
            ))}
          </div>
        </div>

        <button onClick={onPractice} style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "12px", fontSize: 13, color: "#C4B5FD", cursor: "pointer", width: "100%", fontFamily: '"Space Grotesk",sans-serif', fontWeight: 600 }}>
          📖 Przejrzyj przykładowe pytania
        </button>

        <p style={{ color: "rgba(155,137,204,.3)", fontSize: 11, textAlign: "center", marginTop: 20 }}>
          🐐 Forum Uczelni Ekonomicznych · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
