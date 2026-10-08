import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Supabase podmieniony w całości; lista pytań sterowana kolejnymi odpowiedziami getQuestions.
vi.mock("../lib/supabase.js", () => {
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  return {
    DEMO: false,
    supabase: { channel: () => channel, removeChannel: () => {} },
    getSessionForCity: vi.fn(),
    getCityBg: vi.fn(async () => null),
    getQuestions: vi.fn(),
    getSessionPlan: vi.fn(),
    getLiveQuestionStats: vi.fn(async () => ({ answers: [], total: 0, correct: 0 })),
    getLiveAnswerCount: vi.fn(async () => 0),
    getParticipantCount: vi.fn(async () => 0),
    getAnswerSummaryV2: vi.fn(async () => ({ total: 0, correct: 0, ans: null })),
  };
});

import useLiveProjection from "./useLiveProjection.js";
import { getSessionForCity, getQuestions, getSessionPlan } from "../lib/supabase.js";

const Q = (id, module = 1) => ({ id, module, q: `Treść ${id}`, opts: ["a", "b", "c", "d"] });
const PLAN = [
  { i: 0, id: "q1", m: 1, tpq: 20, lead: 10, o: 10000, c: 30000, r: 41500 },
  { i: 1, id: "qNEW", m: 2, tpq: 20, lead: 10, o: 45500, c: 65500, r: 77000 },
];

const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(1_000_000);
  // Trwa pytanie nr 2 planu (o = 45,5 s, c = 65,5 s od kotwicy).
  const anchor = new Date(Date.now() - 50000).toISOString();
  getSessionForCity.mockResolvedValue({ id: "S1", city: "Kraków", status: "running", plan_anchor_at: anchor, plan_paused_at: null, plan_hold_idx: null });
  getSessionPlan.mockResolvedValue(PLAN);
  getQuestions.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useLiveProjection - pytanie spoza listy otwartej przy starcie projektora", () => {
  it("nie pokazuje pytania spod indeksu planu i doładowuje listę", async () => {
    // Przy otwarciu projektora pytania qNEW jeszcze nie było; pod indeksem 1 leży inne pytanie.
    getQuestions.mockResolvedValueOnce([Q("q1"), Q("qX")]);
    getQuestions.mockResolvedValue([Q("q1"), Q("qX"), Q("qNEW", 2)]);

    const hook = renderHook(() => useLiveProjection("Kraków"));
    await tick(500);

    expect(hook.result.current.phase).toBe("quiz");
    expect(hook.result.current.currentQ).toBeUndefined(); // nie "qX"
    expect(hook.result.current.qNum).toBe(2);
    expect(hook.result.current.qTotal).toBe(2);
    expect(hook.result.current.mod?.id).toBe(2); // moduł z planu, mimo braku pytania

    await tick(2500);

    expect(getQuestions.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(hook.result.current.currentQ?.id).toBe("qNEW");
    expect(hook.result.current.qNum).toBe(2);
    hook.unmount();
  });

  it("nie odpytuje listy w kółko, gdy pytanie z planu jest na liście", async () => {
    getQuestions.mockResolvedValue([Q("q1"), Q("qNEW", 2)]);

    const hook = renderHook(() => useLiveProjection("Kraków"));
    await tick(10000);

    expect(hook.result.current.currentQ?.id).toBe("qNEW");
    expect(getQuestions).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});
