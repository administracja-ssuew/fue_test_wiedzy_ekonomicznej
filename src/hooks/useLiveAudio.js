import { useEffect, useRef, useState } from "react";

// Audio TYLKO dla Live View (projektor) — nie obciąża telefonów uczestników.
// Pliki w public/audio/ (wrzuć własne royalty-free). Brak pliku = dany dźwięk po
// prostu nie zagra (graceful). Autoplay przeglądarki wymaga gestu — stąd przycisk
// 🔊/🔇 (kliknięcie operatora odblokowuje dźwięk).
const FILES = {
  bg:        "/audio/bg.mp3",        // zapętlone tło
  countdown: "/audio/countdown.mp3", // odliczanie przed pytaniem
  reveal:    "/audio/reveal.mp3",    // odsłonięcie poprawnej odpowiedzi
  podium:    "/audio/podium.mp3",    // fanfary na podium
};

export default function useLiveAudio() {
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem("fue_audio") === "1"; } catch { return false; } });
  const bgRef  = useRef(null);
  const sfxRef = useRef({});

  useEffect(() => {
    const bg = new Audio(FILES.bg); bg.loop = true; bg.volume = 0.22; bg.preload = "auto"; bgRef.current = bg;
    for (const k of ["countdown", "reveal", "podium"]) {
      const a = new Audio(FILES[k]); a.volume = 0.55; a.preload = "auto"; sfxRef.current[k] = a;
    }
    return () => { try { bg.pause(); } catch (_) {} };
  }, []);

  useEffect(() => {
    try { localStorage.setItem("fue_audio", enabled ? "1" : "0"); } catch (_) {}
    const bg = bgRef.current; if (!bg) return;
    if (enabled) bg.play().catch(() => {}); else bg.pause();
  }, [enabled]);

  const play = (k) => {
    if (!enabled) return;
    const a = sfxRef.current[k];
    if (a) { try { a.currentTime = 0; a.play().catch(() => {}); } catch (_) {} }
  };

  return { enabled, toggle: () => setEnabled((e) => !e), play };
}
