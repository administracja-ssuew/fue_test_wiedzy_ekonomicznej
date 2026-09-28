// ─── View Transitions uczestnika — decyzja „animować czy nie” (06-16 H2, 06-17 debug) ─
// Czyste funkcje (testowalne bez przeglądarki).
//
// Po document.startViewTransition() przeglądarka najpierw przechwytuje stary ekran; do końca
// przechwycenia render strony jest zamrożony, a skipTransition() NIE przyspiesza callbacku
// (eksperyment headless Chromium: timer 150 ms odpalił na czas, callback dopiero po 24 s przy
// ciężkim rastrze; w innej próbie wątek główny stał — timer odpalił po 37 s). Limit
// VT_MAX_DELAY_MS nie ratuje więc fazy na wolnym renderze. Jedyna skuteczna ochrona: nie
// zaczynać przejścia, gdy render jest wolny — zmiana fazy ma pierwszeństwo przed animacją.

// Maksymalne opóźnienie zmiany fazy przez przejście: po nim widok ustawiany wprost.
// Callback wolniejszy niż ten próg = urządzenie/render wolny → dalsze przejścia wyłączone.
export const VT_MAX_DELAY_MS = 150;
// Przerwa między klatkami rAF, od której render uznajemy za zdławiony (60 Hz = 17 ms,
// tryb oszczędzania energii 30 Hz = 33 ms).
export const VT_FRAME_GAP_MS = 100;

// ─── P7-VT-SMOOTH (07-RESEARCH Wzorzec 4) ────────────────────────────────────────
// Zamiast „po pierwszym wolnym przejściu VT wyłączone na zawsze” (06-17): licznik porażek.
// Po 1. porażce VT wraca po VT_STABLE_FRAMES kolejnych płynnych klatkach rAF; po
// VT_MAX_STRIKES porażkach — wyłączone do końca życia hooka.
export const VT_STABLE_FRAMES = 120;   // ~2 s płynnych klatek przy 60 Hz
export const VT_STABLE_GAP_MS = 34;    // klatka „stabilna” (30 Hz w trybie oszczędzania mieści się)
export const VT_MAX_STRIKES = 2;       // po 2. wolnym przejściu VT wyłączone do końca życia hooka
export const VT_INITIAL = Object.freeze({ strikes: 0, stableFrames: 0 });
// Start pytania (countdown/intro → quiz) jest mierzony sondą (devDom) — nigdy przez VT.
// Wejście pytania animuje CSS (keyframes fi na .fue-quiz-main), co nie opóźnia zmiany DOM.
const NO_VT_INTO_QUIZ = new Set(["countdown", "intro"]);

// ev: { type: "slow" } — przejście przekroczyło limit; { type: "frame", gapMs } — klatka rAF.
// Zwraca TEN SAM obiekt, gdy nic się nie zmieniło (ticker rAF bez alokacji).
export function nextVtState(s, ev) {
  const cur = s || VT_INITIAL;
  if (ev?.type === "slow") return { strikes: cur.strikes + 1, stableFrames: 0 };
  if (ev?.type === "frame") {
    if (cur.strikes === 0) return cur;             // bez porażek nic nie liczymy (zero alokacji w rAF)
    const stable = Number(ev.gapMs) < VT_STABLE_GAP_MS;
    const stableFrames = stable ? cur.stableFrames + 1 : 0;
    return stableFrames === cur.stableFrames ? cur : { strikes: cur.strikes, stableFrames };
  }
  return cur;
}

export function isVtSuppressed(s) {
  const cur = s || VT_INITIAL;
  if (cur.strikes >= VT_MAX_STRIKES) return true;
  return cur.strikes > 0 && cur.stableFrames < VT_STABLE_FRAMES;
}

// structural — zmiana fazy/pytania (nie sam tik sekund); available — API jest, karta widoczna,
// brak prefers-reduced-motion; busy — poprzednie przejście jeszcze trwa; slow — VT wyłączone
// po wolnym przejściu (isVtSuppressed); frameGapMs — przerwa od ostatniej klatki;
// fromPhase/toPhase (opcjonalne) — granica faz; countdown/intro → quiz nigdy przez VT.
export function shouldStartViewTransition({ structural, available, busy = false, slow = false, frameGapMs = 0, fromPhase, toPhase }) {
  if (!structural || !available || busy || slow) return false;
  if (toPhase === "quiz" && NO_VT_INTO_QUIZ.has(fromPhase)) return false;
  return !(Number(frameGapMs) > VT_FRAME_GAP_MS);
}

// Czas od wywołania startViewTransition do callbacku (albo do zadziałania limitu bez callbacku).
export function isSlowViewTransition(callbackDelayMs) {
  return Number(callbackDelayMs) > VT_MAX_DELAY_MS;
}
