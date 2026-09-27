import { describe, it, expect } from "vitest";
import { VT_MAX_DELAY_MS, VT_FRAME_GAP_MS, shouldStartViewTransition, isSlowViewTransition } from "./viewTransition.js";

describe("shouldStartViewTransition", () => {
  const ok = { structural: true, available: true, busy: false, slow: false, frameGapMs: 16 };

  it("zmiana fazy, API dostępne, płynne klatki → przejście", () => {
    expect(shouldStartViewTransition(ok)).toBe(true);
    expect(shouldStartViewTransition({ ...ok, frameGapMs: 33 })).toBe(true); // 30 Hz
    expect(shouldStartViewTransition({ ...ok, frameGapMs: VT_FRAME_GAP_MS })).toBe(true);
  });

  it("sam tik sekund / brak API / trwające przejście → bez przejścia", () => {
    expect(shouldStartViewTransition({ ...ok, structural: false })).toBe(false);
    expect(shouldStartViewTransition({ ...ok, available: false })).toBe(false);
    expect(shouldStartViewTransition({ ...ok, busy: true })).toBe(false);
  });

  it("wolny render (wcześniejsze przekroczenie limitu albo zdławione klatki) → bez przejścia", () => {
    expect(shouldStartViewTransition({ ...ok, slow: true })).toBe(false);
    // 06-17 przebieg 05, t2 q2: rAF wykrył start pytania 145 ms po granicy planu.
    expect(shouldStartViewTransition({ ...ok, frameGapMs: 145 })).toBe(false);
    expect(shouldStartViewTransition({ ...ok, frameGapMs: VT_FRAME_GAP_MS + 1 })).toBe(false);
  });
});

describe("isSlowViewTransition", () => {
  it("callback w limicie → nie wolne; ponad limit → wolne", () => {
    expect(isSlowViewTransition(20)).toBe(false);
    expect(isSlowViewTransition(VT_MAX_DELAY_MS)).toBe(false);
    expect(isSlowViewTransition(VT_MAX_DELAY_MS + 1)).toBe(true);
    expect(isSlowViewTransition(546)).toBe(true); // 06-17 przebieg 05, t2 q2
  });
});
