import { CITIES, MODULES, QUESTIONS } from "../data/questions.js";

export const ADMIN_CODE = "FUE2025";
export const ANSWER_BG = ["#C2185B", "#1565C0", "#2E7D32", "#E65100"];
export const ANSWER_LABELS = ["A", "B", "C", "D"];

export const cityInfo = (n) => CITIES.find((c) => c.name === n) || { abbr: "?", color: "#888" };
export const calcPts = (timeLeft, maxTime, correct) =>
  correct ? Math.round(500 + (timeLeft / maxTime) * 500) : 0;
// Accepts optional modules array (from context); falls back to hardcoded MODULES
export const getModule = (id, modules = MODULES) => modules.find((m) => m.id === id);
export const moduleQuestions = (mod) => QUESTIONS.filter((q) => q.module === mod);
