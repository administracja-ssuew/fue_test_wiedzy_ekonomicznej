import { CITIES, MODULES } from "../data/questions.js";

export const ANSWER_BG = ["#C2185B", "#1565C0", "#2E7D32", "#E65100"];
export const ANSWER_LABELS = ["A", "B", "C", "D"];

// Seconds the correct answer is shown after the timer hits 0, before advancing.
// Single source of truth so participant, LiveView and the admin ghost view all
// count down for exactly the same window and stay in sync.
// 6 s reveal + 4 s pre-question countdown (PRE_QUESTION_LEAD) = 10 s przerwy
// między pytaniami — wbudowane w plan sesji przy starcie (src/lib/plan.js).
export const REVEAL_SECONDS = 6;

// Długość zapowiedzi modułu (ekran "Moduł X" przed pierwszym pytaniem modułu).
// Wbudowana w plan sesji jako wydłużony lead pierwszego pytania modułu, więc jest
// zsynchronizowana między uczestnikiem a Live View.
export const MODULE_INTRO_SECONDS = 30;

// Lead zwykłego pytania — okno na odliczanie 3-2-1 przed pokazaniem treści.
export const PRE_QUESTION_LEAD = 4;

// Przejścia pytań wykonuje zamiatacz w bazie (faza 6, advance_due_sessions);
// projekcja stanu rozgrywki: src/lib/plan.js.

// ── Wcześniejsze zakończenie pytania ────────────────────────────────────────
// Historia (23.09.2026): poprzednia wersja miała DWA wyzwalacze bez dolnej granicy
// czasu — 8 s ciszy („plateau") albo osiągnięcie progu równego maksimum odpowiedzi
// z wcześniejszych pytań. To zamykało pętlę dodatnią: pytanie ucięte przy 60/500
// odpowiedziach ustawiało próg na 60, więc KAŻDE kolejne pytanie też kończyło się
// przy 60 — 440 osób nie zdążyło odpowiedzieć na nic poza pierwszym pytaniem.
// Symulacja tego przebiegu jest w gameLogic.test.js jako test regresyjny.
//
// Dlatego teraz decyzja ma twardą podłogę czasu. Podłoga jest tym, co rozrywa pętlę:
// pytanie zawsze trwa na tyle długo, żeby wolniejsi zdążyli odpowiedzieć, więc próg
// frekwencji sam wraca do prawdziwej liczby uczestników zamiast zostać zatruty.

// Minimalny czas trwania pytania, zanim wolno je skrócić — 60% czasu modułu.
// Podłoga jest PROPORCJONALNA, nie stała: pytania TWE mają trwać maksymalnie 20 s,
// więc stałe minimum 20 s równałoby się całemu czasowi pytania i skrót nigdy by nie
// zadziałał. Dolne 8 s chroni tylko przed absurdem przy bardzo krótkich modułach.
//   20 s → 12 s   30 s → 18 s   60 s → 36 s   90 s → 54 s
// Chodzi o egzamin: szybki uczestnik nie może odbierać czasu wolniejszemu.
export function earlySkipFloorSeconds(timePerQ) {
  return Math.max(8, Math.round(0.6 * timePerQ));
}

// Cisza wymagana do uznania, że odpowiedzi przestały napływać — ale nie dłuższa niż
// połowa czasu pytania, bo przy 20-sekundowych pytaniach stałe 12 s oznaczałoby, że
// plateau nie zdąży się nigdy odpalić. 8 s (poprzednia wartość) było za mało przy
// długich pytaniach: przerwa między falą szybkich a wolniejszych bywa dłuższa.
export const ANSWER_PLATEAU_MS = 12000;
export function answerPlateauMs(timePerQ) {
  return Math.min(ANSWER_PLATEAU_MS, Math.max(4000, Math.round(timePerQ * 500)));
}

/**
 * Czy wolno zakończyć pytanie przed czasem.
 * @param total      liczba odpowiedzi na BIEŻĄCE pytanie
 * @param expected   szacowana frekwencja (max odpowiedzi z dotychczasowych pytań)
 * @param issued     liczba wydanych kodów (fallback, gdy brak historii)
 * @param elapsedS   ile sekund trwa już pytanie (od q_started_at)
 * @param timePerQ   czas modułu na pytanie
 * @param sinceLastAnswerMs  ile ms minęło od ostatniej nowej odpowiedzi
 */
// Automatyczny skrót ma sens tylko przy DŁUGICH pytaniach. Pomiar na symulacji przy
// pytaniach 20-sekundowych (docelowy format TWE): skrót oszczędza 2–3 sekundy, bo
// podłoga i tak wypada na 12 s, a okno reveal trwa 6 s. Za taką oszczędność nie warto
// płacić ryzykiem ucięcia komuś odpowiedzi — przy 90-sekundowych obliczeniach owszem,
// bo tam oszczędność to kilkadziesiąt sekund na pytanie.
// Prowadzący ZAWSZE ma ręczny przycisk „⏭ Następne", niezależnie od tego progu.
export const AUTO_SKIP_MIN_TPQ = 45;

export function shouldEndEarly({ total, expected, issued, elapsedS, timePerQ, sinceLastAnswerMs }) {
  if (!total) return false;
  if (timePerQ < AUTO_SKIP_MIN_TPQ) return false;
  // Podłoga czasu — bez niej próg frekwencji potrafi się zatruć i pętla się zamyka.
  if (elapsedS < earlySkipFloorSeconds(timePerQ)) return false;
  const denom = expected > 0 ? expected : issued;
  if (denom > 0 && total >= denom) return true;
  return sinceLastAnswerMs >= answerPlateauMs(timePerQ);
}

export const cityInfo = (n) => CITIES.find((c) => c.name === n) || { abbr: "?", color: "#888" };
// Accepts optional modules array (from context); falls back to hardcoded MODULES
export const getModule = (id, modules = MODULES) => modules.find((m) => m.id === id);
