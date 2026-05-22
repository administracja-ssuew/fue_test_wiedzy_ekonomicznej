import { useState, useEffect, useRef } from "react";
import { supabase, DEMO, getSessionForCity } from "../lib/supabase.js";

export default function WaitingResults({ participant, onReveal }) {
  const [dots, setDots]   = useState(".");
  const pollRef           = useRef(null);
  const city              = participant?.city;

  useEffect(() => {
    const t = setInterval(() => setDots((d) => d.length >= 3 ? "." : d + "."), 600);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!city) return;
    const check = async () => {
      const s = await getSessionForCity(city);
      if (s?.status === "results" || s?.status === "ended") {
        clearInterval(pollRef.current);
        onReveal();
      }
    };
    check();
    pollRef.current = setInterval(check, 3000);
    return () => clearInterval(pollRef.current);
  }, [city]);

  useEffect(() => {
    if (DEMO || !supabase || !city) return;
    const ch = supabase.channel(`results-${city}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "quiz_sessions", filter: `city=eq.${city}` },
        ({ new: s }) => {
          if (s.status === "results" || s.status === "ended") {
            clearInterval(pollRef.current);
            onReveal();
          }
        })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [city]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Jost",sans-serif', color: "#EDE9FE" }}>
      <div style={{ textAlign: "center", padding: "40px 28px", maxWidth: 420 }}>
        <div style={{ fontSize: 72, marginBottom: 24, animation: "glow 2s ease-in-out infinite" }}>🏆</div>
        <h2 style={{ fontFamily: '"Bebas Neue"', fontSize: 52, letterSpacing: 2, color: "#F5C518", marginBottom: 12 }}>
          Koniec testu!
        </h2>
        <p style={{ fontSize: 16, color: "#9B89CC", lineHeight: 1.7, marginBottom: 32 }}>
          Wszystkie pytania zostały zadane.<br />
          Za chwilę administrator ogłosi wyniki.
        </p>
        <div style={{ background: "rgba(245,197,24,.08)", border: "1px solid rgba(245,197,24,.2)", borderRadius: 14, padding: "16px 24px", display: "inline-flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#F5C518", animation: "pulse 1.5s infinite" }} />
          <span style={{ fontSize: 13, color: "#9B89CC" }}>Oczekiwanie na ogłoszenie{dots}</span>
        </div>
        <p style={{ fontSize: 11, color: "rgba(155,137,204,.3)", marginTop: 28 }}>🐐 Forum Uczelni Ekonomicznych</p>
      </div>
    </div>
  );
}
