import { createContext, useContext, useState, useEffect, useRef } from "react";
import { MODULES } from "../data/questions.js";
import { fetchModules } from "../lib/supabase.js";

const Ctx = createContext(MODULES);

// Moduły niosą `timePerQ`, czyli czas na odpowiedź. Jeśli uczestnik dostanie tu
// wartości inne niż reszta sali, jego test przestaje być porównywalny z innymi.
//
// ZMIERZONE 24.09.2026 sondą pełnej ścieżki: poprzednia wersja robiła JEDNĄ próbę
// pobrania i przy niepowodzeniu milcząco zostawała na zaszytym fallbacku
// (90/30/60/75/45 s). Na tym samym pytaniu jeden telefon odliczał od 70, drugi od
// 15 — i nic tego nie korygowało do końca testu, bo nie było ani ponowienia, ani
// sygnału o błędzie. Objaw zgłoszony jako „czasy rozjeżdżają się na telefonie".
//
// Dlatego: ponawiamy z narastającym odstępem, dopóki nie dostaniemy odpowiedzi
// z bazy, i odświeżamy po powrocie karty na pierwszy plan (telefon po odblokowaniu
// mógł przespać wszystkie próby).
const RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];

export function ModulesProvider({ children }) {
  const [modules, setModules] = useState(MODULES);
  const [loadedFromDb, setLoadedFromDb] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timers = [];

    const attempt = async (i) => {
      if (cancelled || doneRef.current) return;
      // try/catch jest tu KONIECZNE, nie ostrożnościowe: rzucony wyjątek zabijał całą
      // pętlę ponowień i uczestnik zostawał na czasach awaryjnych bez żadnego sygnału.
      let fromDb = false, m = null;
      try {
        ({ modules: m, fromDb } = await fetchModules());
      } catch (e) {
        console.error("[ModulesProvider] próba pobrania modułów rzuciła wyjątek:", e?.message || e);
      }
      if (cancelled) return;
      if (fromDb) {
        doneRef.current = true;
        if (m?.length) setModules(m);
        setLoadedFromDb(true);
        return;
      }
      // Nie udało się — spróbuj ponownie. Ostatni odstęp powtarzamy w nieskończoność,
      // bo jazda na złych czasach jest gorsza niż jedno zapytanie na 30 s.
      const wait = RETRY_MS[Math.min(i, RETRY_MS.length - 1)];
      timers.push(setTimeout(() => attempt(i + 1), wait));
    };

    attempt(0);

    // Telefon z zablokowanym ekranem usypia timery — po powrocie sprawdzamy od nowa.
    const onVisible = () => { if (!document.hidden && !doneRef.current) attempt(0); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <Ctx.Provider value={modules}>
      {children}
      {/* Widoczny sygnał, że czasy pytań mogą być inne niż u pozostałych. Bez tego
          uczestnik i prowadzący nie mieli SZANSY zauważyć rozjazdu — a to właśnie
          on sprawiał, że jeden telefon odliczał 70 s, a drugi 15 s. */}
      {!loadedFromDb && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9998,
          background: "rgba(232,55,107,.95)", color: "#fff", textAlign: "center",
          padding: "8px 14px", fontSize: 12, fontWeight: 600,
          fontFamily: '"Space Grotesk",sans-serif',
        }}>
          ⚠️ Brak połączenia z konfiguracją testu — czasy pytań mogą być nieprawidłowe.
          Zgłoś to organizatorowi.
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useModules   = ()  => useContext(Ctx);
export const useGetModule = ()  => { const m = useModules(); return (id) => m.find((x) => x.id === id); };
