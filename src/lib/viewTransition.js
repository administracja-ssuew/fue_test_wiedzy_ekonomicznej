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

// structural — zmiana fazy/pytania (nie sam tik sekund); available — API jest, karta widoczna,
// brak prefers-reduced-motion; busy — poprzednie przejście jeszcze trwa; slow — któreś
// wcześniejsze przejście przekroczyło limit; frameGapMs — przerwa od ostatniej klatki.
export function shouldStartViewTransition({ structural, available, busy = false, slow = false, frameGapMs = 0 }) {
  if (!structural || !available || busy || slow) return false;
  return !(Number(frameGapMs) > VT_FRAME_GAP_MS);
}

// Czas od wywołania startViewTransition do callbacku (albo do zadziałania limitu bez callbacku).
export function isSlowViewTransition(callbackDelayMs) {
  return Number(callbackDelayMs) > VT_MAX_DELAY_MS;
}
