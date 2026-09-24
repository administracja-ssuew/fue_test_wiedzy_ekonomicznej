import { REVEAL_SECONDS, MODULE_INTRO_SECONDS, PRE_QUESTION_LEAD } from "./gameLogic.js";

// ─── Plan sesji (lustro SQL plan_position / sweep_decision, sekcja 39) ───────
// Cała rozgrywka to deterministyczna funkcja (items, anchorMs, pausedAtMs, nowMs).
// Plan (items) jest zamrażany przy starcie sesji: o/c/r to ms od kotwicy (anchor).
// Pauza / „Następne” / „Powtórz” przesuwają wyłącznie kotwicę — nigdy items.
// Każda zmiana tu MUSI mieć odpowiednik w SQL (fixture'y plan.fixtures.json).

export const FIRST_QUESTION_LEAD = 10;   // zapowiedź modułu 1 (jak dzisiejszy start_quiz_session: +10 s)
export const REVEAL_GATE_MS = 1500;      // bramka odsłonięcia = closes + 1,5 s (strefa tolerancji submit)

// Znacznik czasu z bazy (ISO) / liczba / brak → ms albo null.
export function toMs(ts) {
  if (ts == null) return null;
  if (typeof ts === "number") return ts;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

// questions: [{ id, module }] JUŻ posortowane (module, sort_order, id); modules: [{ id, timePerQ }].
// Czas modułu jest kopiowany do planu — późniejsza edycja modułu nie zmienia trwającej sesji.
export function buildPlanItems(questions, modules) {
  const items = [];
  (questions || []).forEach((q, i) => {
    const tpq = (modules || []).find((m) => m.id === q.module)?.timePerQ ?? 60;
    const prev = items[i - 1];
    const lead = i === 0 ? FIRST_QUESTION_LEAD : q.module !== prev.m ? MODULE_INTRO_SECONDS : PRE_QUESTION_LEAD;
    const o = (i === 0 ? 0 : prev.r) + lead * 1000;
    const c = o + tpq * 1000;
    const r = c + REVEAL_SECONDS * 1000;
    items.push({ i, id: q.id, m: q.module, tpq, lead, o, c, r });
  });
  return items;
}

// Pozycja w planie w chwili nowMs (albo zamrożona w pausedAtMs).
export function planPosition(items, anchorMs, pausedAtMs, nowMs) {
  if (!items?.length || anchorMs == null) return null;
  const t = (pausedAtMs ?? nowMs) - anchorMs;
  const last = items[items.length - 1];
  const it = items.find((x) => t < x.r) || last;
  let phase;
  if (pausedAtMs != null) phase = "paused";
  else if (t >= last.r) phase = "finished";
  else if (t < it.o) phase = it.lead >= 10 ? "intro" : "countdown";
  else if (t < it.c) phase = "quiz";
  else phase = "reveal";
  return {
    idx: it.i, phase, item: it,
    opensAt: anchorMs + it.o, closesAt: anchorMs + it.c, revealUntil: anchorMs + it.r,
  };
}

// Pełna projekcja stanu dla UI (uczestnik / Live View / panel).
export function projectPlanState({ items, anchorMs, pausedAtMs = null, status, nowMs }) {
  if (status === "waiting") return { phase: "lobby" };
  if (status === "results") return { phase: "results" };
  if (status === "ended") return { phase: "ended" };
  // Sesja uruchomiona starym panelem (bez planu) — stara ścieżka rozgrywki.
  if (anchorMs == null) return { phase: "legacy" };
  // UPDATE z Realtime niesie kotwicę wcześniej, niż dociera snapshot z planem; bez tej
  // fazy ~500 osób widziałoby na starcie komunikat „starsza wersja panelu”.
  if (!items?.length) return { phase: "plan_loading" };

  const paused = pausedAtMs != null || status === "paused";
  const effNow = paused ? (pausedAtMs ?? nowMs) : nowMs;
  const pos = planPosition(items, anchorMs, null, effNow);
  let remainingMs;
  if (pos.phase === "intro" || pos.phase === "countdown") remainingMs = pos.opensAt - effNow;
  else if (pos.phase === "quiz") remainingMs = pos.closesAt - effNow;
  else if (pos.phase === "reveal") remainingMs = pos.revealUntil - effNow;
  else remainingMs = 0;

  return {
    phase: paused ? "paused" : pos.phase,
    underPhase: pos.phase,
    idx: pos.idx, item: pos.item,
    opensAt: pos.opensAt, closesAt: pos.closesAt, revealUntil: pos.revealUntil,
    remainingMs,
    secondsLeft: Math.max(0, Math.ceil(remainingMs / 1000)),
    firstOfModule: pos.item.lead >= 10,
  };
}

// Czy wolno już pokazać poprawną odpowiedź (po strefie tolerancji submit).
export function isRevealed(item, anchorMs, pausedAtMs, nowMs) {
  return ((pausedAtMs ?? nowMs) - anchorMs) >= item.c + REVEAL_GATE_MS;
}

// Wznowienie: kotwica przesuwa się o czas trwania pauzy.
export function resumeAnchor(anchorMs, pausedAtMs, nowMs) {
  return anchorMs + (nowMs - pausedAtMs);
}

// „Następne”: skróć bieżące pytanie do teraz (wszystkie kolejne terminy przesuwają się
// o tyle samo). Tylko w fazie quiz i tylko dla oczekiwanego pytania — drugi klik = no-op.
export function skipAnchor(items, anchorMs, nowMs, expectedIdx) {
  const pos = planPosition(items, anchorMs, null, nowMs);
  if (!pos || pos.idx !== expectedIdx || pos.phase !== "quiz") return null;
  return anchorMs - (pos.closesAt - nowMs);
}

// „Powtórz”: bieżące pytanie otwiera się od nowa teraz.
export function repeatAnchor(items, anchorMs, nowMs, expectedIdx) {
  const pos = planPosition(items, anchorMs, null, nowMs);
  if (!pos || pos.idx !== expectedIdx || pos.phase !== "quiz") return null;
  return anchorMs + (nowMs - pos.opensAt);
}

// Czas odpowiedzi do punktacji; w strefie tolerancji po deadline = tpq (zero bonusu).
export function answerResponseMs(item, anchorMs, nowMs, chosen) {
  const max = item.tpq * 1000;
  if (chosen == null) return max;
  return Math.min(Math.max(0, nowMs - (anchorMs + item.o)), max);
}

// Decyzja zamiatacza (pg_cron): czy zsynchronizować wiersz sesji z planem.
// row = { status, anchorMs, pausedAtMs, curIdx, qStartedAtMs, revealedIdx }
export function sweepDecision(row, items, nowMs) {
  if (row?.status !== "running" || row.anchorMs == null || row.pausedAtMs != null || !items?.length) {
    return { action: "none" };
  }
  const pos = planPosition(items, row.anchorMs, null, nowMs);
  const t = nowMs - row.anchorMs;
  const rev = t >= pos.item.c + REVEAL_GATE_MS ? pos.idx : (pos.idx > 0 ? pos.idx - 1 : null);
  if (pos.phase === "finished") {
    return { action: "finish", status: "results", idx: pos.idx, qStartedAtMs: pos.opensAt, revealedIdx: pos.idx };
  }
  if (pos.idx !== row.curIdx || pos.opensAt !== (row.qStartedAtMs ?? null) || rev !== (row.revealedIdx ?? null)) {
    return { action: "update", status: "running", idx: pos.idx, qStartedAtMs: pos.opensAt, revealedIdx: rev };
  }
  return { action: "none" };
}
