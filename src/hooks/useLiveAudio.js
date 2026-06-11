import { useEffect, useRef, useState } from "react";

// Audio TYLKO dla Live View (projektor) — nie obciąża telefonów uczestników.
// Pliki w public/audio/ (bg/countdown/reveal/podium .mp3). Brak pliku = dźwięk nie gra.
// Autoplay przeglądarki wymaga gestu — stąd przycisk 🔊/🔇.
// Suwaki: osobno głośność tła i efektów. Ducking: tło przycisza się na czas efektu.
const FILES = {
  bg:        "/audio/bg.mp3",
  countdown: "/audio/countdown.mp3",
  reveal:    "/audio/reveal.mp3",
  podium:    "/audio/podium.mp3",
};
const DUCK = 0.25; // tło na 25% podczas efektu
const lsNum = (k, d) => { try { const v = parseFloat(localStorage.getItem(k)); return isFinite(v) ? v : d; } catch { return d; } };

export default function useLiveAudio() {
  const [enabled, setEnabled] = useState(() => { try { return localStorage.getItem("fue_audio") === "1"; } catch { return false; } });
  const [bgVol,  setBgVol]    = useState(() => lsNum("fue_audio_bg", 0.22));
  const [sfxVol, setSfxVol]   = useState(() => lsNum("fue_audio_sfx", 0.55));
  const bgRef   = useRef(null);
  const sfxRef  = useRef({});
  const duckRef = useRef(null);
  const bgVolRef = useRef(bgVol);

  useEffect(() => {
    const bg = new Audio(FILES.bg); bg.loop = true; bg.preload = "auto"; bgRef.current = bg;
    for (const k of ["countdown", "reveal", "podium"]) {
      const a = new Audio(FILES[k]); a.preload = "auto"; sfxRef.current[k] = a;
    }
    return () => { try { bg.pause(); } catch (_) {} clearTimeout(duckRef.current); };
  }, []);

  // Głośność tła (z uwzględnieniem aktualnego duckingu wyłączamy — ustawiamy pełną).
  useEffect(() => {
    bgVolRef.current = bgVol;
    if (bgRef.current) bgRef.current.volume = bgVol;
    try { localStorage.setItem("fue_audio_bg", String(bgVol)); } catch (_) {}
  }, [bgVol]);
  useEffect(() => { try { localStorage.setItem("fue_audio_sfx", String(sfxVol)); } catch (_) {} }, [sfxVol]);

  useEffect(() => {
    try { localStorage.setItem("fue_audio", enabled ? "1" : "0"); } catch (_) {}
    const bg = bgRef.current; if (!bg) return;
    if (enabled) bg.play().catch(() => {}); else bg.pause();
  }, [enabled]);

  const play = (k) => {
    if (!enabled) return;
    const a = sfxRef.current[k]; if (!a) return;
    a.volume = sfxVol;
    // Ducking — przycisz tło na czas efektu, potem przywróć.
    const bg = bgRef.current;
    if (bg) {
      bg.volume = bgVolRef.current * DUCK;
      const restore = () => { if (bgRef.current) bgRef.current.volume = bgVolRef.current; };
      a.onended = restore;
      clearTimeout(duckRef.current);
      const ms = (a.duration && isFinite(a.duration) ? a.duration * 1000 : 1500) + 250;
      duckRef.current = setTimeout(restore, ms);
    }
    try { a.currentTime = 0; a.play().catch(() => {}); } catch (_) {}
  };

  return { enabled, toggle: () => setEnabled((e) => !e), play, bgVol, setBgVol, sfxVol, setSfxVol };
}
