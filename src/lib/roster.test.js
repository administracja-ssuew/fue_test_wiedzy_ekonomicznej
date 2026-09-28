import { describe, it, expect } from "vitest";
import {
  ROSTER_STATES, CONFLICT_WINDOW_MS,
  lastClosedIndex, classifyParticipant, sortRoster, summarizeRoster, conflictLabel,
} from "./roster.js";

const ITEMS = [
  { i: 0, id: "q0", c: 30000 },
  { i: 1, id: "q1", c: 70000 },
];

describe("lastClosedIndex", () => {
  it("null przed c + grace pierwszego pytania", () => {
    expect(lastClosedIndex(ITEMS, 0, null, 34000)).toBe(null);
  });
  it("0 dokładnie od c + grace pytania 0", () => {
    expect(lastClosedIndex(ITEMS, 0, null, 34500)).toBe(0);
  });
  it("1 po zamknięciu drugiego pytania", () => {
    expect(lastClosedIndex(ITEMS, 0, null, 80000)).toBe(1);
  });
  it("kotwica przesuwa czas", () => {
    expect(lastClosedIndex(ITEMS, 10000, null, 44500)).toBe(0);
    expect(lastClosedIndex(ITEMS, 10000, null, 44499)).toBe(null);
  });
  it("pauza zamraża czas", () => {
    expect(lastClosedIndex(ITEMS, 0, 20000, 999999)).toBe(null);
    expect(lastClosedIndex(ITEMS, 0, 40000, 999999)).toBe(0);
  });
  it("własny grace", () => {
    expect(lastClosedIndex(ITEMS, 0, null, 30000, 0)).toBe(0);
  });
  it("brak items / kotwicy → null", () => {
    expect(lastClosedIndex([], 0, null, 80000)).toBe(null);
    expect(lastClosedIndex(null, 0, null, 80000)).toBe(null);
    expect(lastClosedIndex(ITEMS, null, null, 80000)).toBe(null);
  });
});

describe("classifyParticipant", () => {
  const now = 10_000_000;
  it("świeży konflikt ma pierwszeństwo", () => {
    expect(classifyParticipant({ status: "running", lastClosed: "answered", conflictAt: now - 60000, nowMs: now })).toBe("conflict");
    expect(classifyParticipant({ status: "waiting", inLobby: true, conflictAt: now - 60000, nowMs: now })).toBe("conflict");
  });
  it("stary konflikt (> 5 min) ignorowany", () => {
    expect(classifyParticipant({ status: "running", lastClosed: "answered", conflictAt: now - 6 * 60000, nowMs: now })).toBe("answered");
    expect(CONFLICT_WINDOW_MS).toBe(5 * 60 * 1000);
  });
  it("waiting: presence", () => {
    expect(classifyParticipant({ status: "waiting", inLobby: true, nowMs: now })).toBe("lobby");
    expect(classifyParticipant({ status: "waiting", inLobby: null, nowMs: now })).toBe("lobby");
    expect(classifyParticipant({ status: "waiting", inLobby: false, nowMs: now })).toBe("disconnected");
  });
  it("running: wiersz w answers zamkniętego pytania", () => {
    expect(classifyParticipant({ status: "running", lastClosed: null, nowMs: now })).toBe("online");
    expect(classifyParticipant({ status: "running", lastClosed: "answered", nowMs: now })).toBe("answered");
    expect(classifyParticipant({ status: "running", lastClosed: "empty", nowMs: now })).toBe("no_answer");
    expect(classifyParticipant({ status: "running", lastClosed: "missing", nowMs: now })).toBe("disconnected");
  });
  it("paused tak samo jak running", () => {
    expect(classifyParticipant({ status: "paused", lastClosed: null, nowMs: now })).toBe("online");
    expect(classifyParticipant({ status: "paused", lastClosed: "empty", nowMs: now })).toBe("no_answer");
    expect(classifyParticipant({ status: "paused", lastClosed: "missing", nowMs: now })).toBe("disconnected");
  });
});

describe("sortRoster", () => {
  it("grupy: konflikt, rozłączony, brak odpowiedzi, reszta; w grupie po kodzie", () => {
    const rows = [
      { code: "KRK-0005", state: "online" },
      { code: "KRK-0004", state: "no_answer" },
      { code: "KRK-0003", state: "disconnected" },
      { code: "KRK-0002", state: "conflict" },
      { code: "KRK-0001", state: "answered" },
      { code: "KRK-0000", state: "disconnected" },
    ];
    expect(sortRoster(rows).map((r) => r.code)).toEqual([
      "KRK-0002", "KRK-0000", "KRK-0003", "KRK-0004", "KRK-0001", "KRK-0005",
    ]);
  });
  it("nie mutuje wejścia", () => {
    const rows = [{ code: "B", state: "online" }, { code: "A", state: "conflict" }];
    sortRoster(rows);
    expect(rows[0].code).toBe("B");
  });
});

describe("summarizeRoster", () => {
  it("liczniki stanów (online + answered = W grze)", () => {
    const rows = ["online", "answered", "no_answer", "disconnected", "disconnected", "conflict", "lobby"]
      .map((state, i) => ({ code: String(i), state }));
    expect(summarizeRoster(rows)).toEqual({ online: 2, no_answer: 1, disconnected: 2, conflict: 1, lobby: 1 });
  });
  it("pusta lista → zera", () => {
    expect(summarizeRoster([])).toEqual({ online: 0, no_answer: 0, disconnected: 0, conflict: 0, lobby: 0 });
  });
});

describe("conflictLabel / ROSTER_STATES", () => {
  const now = 10_000_000;
  it("minuty w dół", () => {
    expect(conflictLabel(now - 200000, now)).toBe("Inny telefon próbuje wejść · 3 min temu");
    expect(conflictLabel(now - 10000, now)).toBe("Inny telefon próbuje wejść · 0 min temu");
  });
  it("przyszły znacznik (dryf zegara) → 0 min", () => {
    expect(conflictLabel(now + 5000, now)).toBe("Inny telefon próbuje wejść · 0 min temu");
  });
  it("stany problemowe", () => {
    const problems = Object.entries(ROSTER_STATES).filter(([, s]) => s.problem).map(([k]) => k).sort();
    expect(problems).toEqual(["conflict", "disconnected", "no_answer"]);
  });
});
