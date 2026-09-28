import { useEffect, useRef, useState } from "react";
import { recordViolation } from "../lib/supabase.js";

// Do bazy piszemy najwyżej 1 wiersz / 10 s / typ. Bez tego jedno zablokowanie
// i odblokowanie ekranu telefonu potrafi wygenerować serię wierszy, a przy 500
// uczestnikach przez godzinę tabela violations rośnie do tysięcy rekordów, które
// panel admina odpytuje co kilka sekund. Zdarzenia z okna deduplikacji NIE giną:
// planujemy jeden zapis na koniec okna (i natychmiast przy odmontowaniu), który
// niesie AKTUALNE liczniki — ostatni wiersz w bazie zawsze ma stan końcowy.
// (iOS wstrzymuje JS po wyjściu z aplikacji, więc zapis z handlera dojdzie po
// powrocie — dosłanie po oknie to pokrywa.)
const DEDUPE_MS = 10000;
const TYPES = ["tab_switch", "screenshot_attempt"];
const ZERO = () => ({ total: 0, tab_switch: 0, screenshot_attempt: 0 });

// Licznik w localStorage = „licznik na telefonie”: ciągły przez moduły, przerwy
// (Quiz jest odmontowywany w intro/countdown/przerwie) i refresh — per sesja + kod.
const storageKey = (sessionId, participantCode) =>
  `fue_viol_${sessionId || "none"}_${participantCode || "none"}`;

function load(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return ZERO();
    const o = JSON.parse(raw) || {};
    const c = ZERO();
    for (const k of ["total", ...TYPES]) c[k] = Math.max(0, Number(o[k]) || 0);
    return c;
  } catch {
    return ZERO();
  }
}

function save(key, c) {
  try { localStorage.setItem(key, JSON.stringify(c)); } catch { /* tryb prywatny / brak miejsca — licznik zostaje w pamięci */ }
}

export default function useAntiCheat({ active, participantCode, sessionId }) {
  const key = storageKey(sessionId, participantCode);
  const [violations, setViolations]     = useState(() => load(key).total);
  const [showWarning, setShowWarning]   = useState(false);
  const [lastType, setLastType]         = useState("");
  const countsRef = useRef(null);         // { total, tab_switch, screenshot_attempt } dla bieżącego klucza
  const keyRef = useRef(null);
  const lastSentRef = useRef({});         // type → timestamp ostatniego ZAPISU do bazy
  const pendingRef = useRef({});          // type → timer dosłania

  // Klucz zmienił się (inna sesja / inny kod) → wczytaj jego licznik. Ten efekt jest
  // zadeklarowany przed efektem nasłuchów, więc countsRef jest gotowy, zanim ruszą.
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    countsRef.current = load(key);
    lastSentRef.current = {};
    setViolations(countsRef.current.total);
  }, [key]);

  useEffect(() => {
    if (!active) return;

    const send = (type) => {
      lastSentRef.current[type] = Date.now();
      const c = countsRef.current;
      recordViolation({ participantCode, sessionId, type, count: c.total, typeCount: c[type] });
    };

    const bump = (type) => {
      const c = countsRef.current;
      c[type] += 1;
      c.total += 1;
      save(key, c);
      setViolations(c.total);
    };

    const trigger = (type) => {
      bump(type);
      setLastType(type);
      setShowWarning(true);
      const since = Date.now() - (lastSentRef.current[type] || 0);
      if (since >= DEDUPE_MS) { send(type); return; }
      if (!pendingRef.current[type]) {
        pendingRef.current[type] = setTimeout(() => { pendingRef.current[type] = null; send(type); }, DEDUPE_MS - since);
      }
    };

    // Tab switch / minimise
    const onVisibility = () => {
      if (document.hidden) trigger("tab_switch");
    };

    // PrintScreen key
    const onKey = (e) => {
      if (e.key === "PrintScreen") {
        e.preventDefault();
        trigger("screenshot_attempt");
      }
      // Cmd+Shift+3/4/5 on macOS (screenshots)
      if (e.metaKey && e.shiftKey && ["3","4","5"].includes(e.key)) {
        e.preventDefault();
        trigger("screenshot_attempt");
      }
      // Deterrent only (no violation logged): block print / save / copy shortcuts.
      const k = String(e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ["p", "s", "c", "u"].includes(k)) {
        e.preventDefault();
      }
    };

    // Deterrents — silently block right-click menu, copy and text selection.
    // These are friction, not violations (would be far too noisy to record).
    const block = (e) => e.preventDefault();

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", block);
    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    return () => {
      // Zaległe dosłania wysyłamy od razu — odmontowanie (koniec modułu, refresh
      // w SPA, zmiana sesji) nie może zgubić ostatniego stanu licznika.
      for (const type of TYPES) {
        if (pendingRef.current[type]) {
          clearTimeout(pendingRef.current[type]);
          pendingRef.current[type] = null;
          send(type);
        }
      }
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
    };
  }, [active, participantCode, sessionId, key]);

  return { violations, showWarning, lastType, dismiss: () => setShowWarning(false) };
}
