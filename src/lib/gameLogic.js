import { CITIES, MODULES, QUESTIONS } from "../data/questions.js";

export const ANSWER_BG = ["#C2185B", "#1565C0", "#2E7D32", "#E65100"];
export const ANSWER_LABELS = ["A", "B", "C", "D"];

// Seconds the correct answer is shown after the timer hits 0, before advancing.
// Single source of truth so participant, LiveView and the admin ghost view all
// count down for exactly the same window and stay in sync.
export const REVEAL_SECONDS = 5;

export const cityInfo = (n) => CITIES.find((c) => c.name === n) || { abbr: "?", color: "#888" };
export const calcPts = (timeLeft, maxTime, correct) =>
  correct ? Math.round(500 + (timeLeft / maxTime) * 500) : 0;
// Accepts optional modules array (from context); falls back to hardcoded MODULES
export const getModule = (id, modules = MODULES) => modules.find((m) => m.id === id);
export const moduleQuestions = (mod) => QUESTIONS.filter((q) => q.module === mod);

// Pure projection of a quiz session into spectator UI state (used by LiveView and
// the admin ghost embed via useLiveProjection). Deriving everything from the DB
// timestamp guarantees all spectators + participants stay in sync.
//
// Returns { phase, idx, timer, autoSec, cdNum }:
//   phase  "waiting" | "paused" | "quiz" | "reveal"
//   cdNum  3/2/1/0(START!) during the pre-question countdown, else null
//   timer  seconds left on the current question (quiz phase)
//   autoSec seconds left of the reveal window before the next question
export function projectLiveState({ session: s, questions: qs, modules, now = Date.now() }) {
  const idle = { phase: "waiting", idx: 0, timer: 0, autoSec: REVEAL_SECONDS, cdNum: null };
  if (!s || !qs?.length || s.status === "waiting" || s.status === "ended" || s.status === "results") {
    return idle;
  }
  const idx = Math.min(s.current_question_idx || 0, qs.length - 1);
  const q   = qs[idx];
  const m   = (modules || []).find((mm) => mm.id === q?.module);
  const tpq = m?.timePerQ || 60;

  if (s.status === "paused")  return { phase: "paused", idx, timer: tpq, autoSec: REVEAL_SECONDS, cdNum: null };
  if (!s.q_started_at)        return { phase: "quiz",   idx, timer: tpq, autoSec: REVEAL_SECONDS, cdNum: null };

  const elapsed = (now - new Date(s.q_started_at).getTime()) / 1000;
  if (elapsed < 0) {
    return { phase: "quiz", idx, timer: tpq, autoSec: REVEAL_SECONDS, cdNum: Math.max(0, Math.ceil(-elapsed) - 1) };
  }
  if (elapsed < tpq) {
    return { phase: "quiz", idx, timer: Math.max(0, Math.ceil(tpq - elapsed)), autoSec: REVEAL_SECONDS, cdNum: null };
  }
  return { phase: "reveal", idx, timer: 0, autoSec: Math.max(0, Math.ceil(tpq + REVEAL_SECONDS - elapsed)), cdNum: null };
}
