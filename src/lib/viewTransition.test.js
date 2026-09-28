import { describe, it, expect } from "vitest";
import {
  VT_MAX_DELAY_MS, VT_FRAME_GAP_MS, shouldStartViewTransition, isSlowViewTransition,
  VT_INITIAL, VT_STABLE_FRAMES, VT_STABLE_GAP_MS, VT_MAX_STRIKES, nextVtState, isVtSuppressed,
} from "./viewTransition.js";

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

// P7-VT-SMOOTH (07-RESEARCH Wzorzec 4)
describe("shouldStartViewTransition — granica startu pytania", () => {
  const ok = { structural: true, available: true, busy: false, slow: false, frameGapMs: 16 };

  it("countdown/intro → quiz nigdy przez VT (start pytania mierzony sondą)", () => {
    expect(shouldStartViewTransition({ ...ok, fromPhase: "countdown", toPhase: "quiz" })).toBe(false);
    expect(shouldStartViewTransition({ ...ok, fromPhase: "intro", toPhase: "quiz" })).toBe(false);
  });

  it("pozostałe przejścia strukturalne dalej przez VT", () => {
    expect(shouldStartViewTransition({ ...ok, fromPhase: "quiz", toPhase: "reveal" })).toBe(true);
    expect(shouldStartViewTransition({ ...ok, fromPhase: "reveal", toPhase: "countdown" })).toBe(true);
    expect(shouldStartViewTransition({ ...ok, fromPhase: "quiz", toPhase: "quiz" })).toBe(true); // skip → następne pytanie
  });
});

describe("nextVtState / isVtSuppressed", () => {
  const frames = (s, n, gapMs = 16) => {
    let cur = s;
    for (let i = 0; i < n; i++) cur = nextVtState(cur, { type: "frame", gapMs });
    return cur;
  };

  it("stała konfiguracja", () => {
    expect(VT_STABLE_FRAMES).toBe(120);
    expect(VT_STABLE_GAP_MS).toBe(34);
    expect(VT_MAX_STRIKES).toBe(2);
  });

  it("stan początkowy → VT dozwolone; klatki bez porażek nie zmieniają stanu", () => {
    expect(isVtSuppressed(VT_INITIAL)).toBe(false);
    expect(isVtSuppressed(undefined)).toBe(false);
    expect(frames(VT_INITIAL, 10)).toBe(VT_INITIAL);
  });

  it("1. porażka → VT wyłączone czasowo", () => {
    const s = nextVtState(VT_INITIAL, { type: "slow" });
    expect(s).toEqual({ strikes: 1, stableFrames: 0 });
    expect(isVtSuppressed(s)).toBe(true);
  });

  it("po 1. porażce VT wraca po 120 stabilnych klatkach (119 to za mało)", () => {
    const s1 = nextVtState(VT_INITIAL, { type: "slow" });
    const s119 = frames(s1, 119);
    expect(isVtSuppressed(s119)).toBe(true);
    const s120 = frames(s119, 1);
    expect(isVtSuppressed(s120)).toBe(false);
  });

  it("wolna klatka w trakcie odliczania zeruje licznik stabilnych klatek", () => {
    const s1 = nextVtState(VT_INITIAL, { type: "slow" });
    const s = frames(frames(s1, 100), 1, 50);
    expect(s.stableFrames).toBe(0);
    expect(isVtSuppressed(frames(s, 119))).toBe(true);
    expect(isVtSuppressed(frames(s, 120))).toBe(false);
  });

  it("2. porażka → VT wyłączone na stałe", () => {
    const s1 = frames(nextVtState(VT_INITIAL, { type: "slow" }), 120);
    const s2 = nextVtState(s1, { type: "slow" });
    expect(s2.strikes).toBe(2);
    expect(isVtSuppressed(frames(s2, 1000))).toBe(true);
  });
});
