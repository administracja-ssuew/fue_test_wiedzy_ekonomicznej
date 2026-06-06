import { describe, it, expect } from "vitest";
import { calcPts, cityInfo, projectLiveState, remainingSeconds, REVEAL_SECONDS } from "./gameLogic.js";

describe("calcPts", () => {
  it("returns 750 for correct answer with half time remaining", () => {
    expect(calcPts(45, 90, true)).toBe(750);
  });
  it("returns 1000 for correct answer with full time remaining", () => {
    expect(calcPts(90, 90, true)).toBe(1000);
  });
  it("returns 500 for correct answer with no time remaining", () => {
    expect(calcPts(0, 90, true)).toBe(500);
  });
  it("returns 0 for wrong answer regardless of time", () => {
    expect(calcPts(45, 90, false)).toBe(0);
    expect(calcPts(0, 90, false)).toBe(0);
    expect(calcPts(90, 90, false)).toBe(0);
  });
});

describe("cityInfo", () => {
  it("returns correct abbr for known city", () => {
    expect(cityInfo("Kraków").abbr).toBe("UEK");
  });
  it("returns correct color for known city", () => {
    expect(cityInfo("Kraków").color).toBe("#D41D1F");
  });
  it("returns fallback color for unknown city", () => {
    expect(cityInfo("Unknown").color).toBe("#888");
  });
});

describe("projectLiveState", () => {
  const NOW = 1_700_000_000_000;
  const questions = [
    { id: "q1", module: 1 },
    { id: "q2", module: 1 },
    { id: "q3", module: 2 },
  ];
  const modules = [
    { id: 1, timePerQ: 30 },
    { id: 2, timePerQ: 60 },
  ];
  // Build a session whose current question started `elapsedSec` ago (negative = future).
  const sess = (over) => ({ status: "running", current_question_idx: 0, q_started_at: null, ...over });
  const startedAgo = (elapsedSec) => new Date(NOW - elapsedSec * 1000).toISOString();
  const project = (over) => projectLiveState({ session: sess(over), questions, modules, now: NOW });

  it("waiting when no session / waiting / ended / results", () => {
    expect(projectLiveState({ session: null, questions, modules, now: NOW }).phase).toBe("waiting");
    expect(project({ status: "waiting" }).phase).toBe("waiting");
    expect(project({ status: "ended" }).phase).toBe("waiting");
    expect(project({ status: "results" }).phase).toBe("waiting");
  });

  it("waiting when there are no questions", () => {
    expect(projectLiveState({ session: sess({ q_started_at: startedAgo(5) }), questions: [], modules, now: NOW }).phase)
      .toBe("waiting");
  });

  it("paused → phase paused with full module time", () => {
    const r = project({ status: "paused", q_started_at: startedAgo(10) });
    expect(r.phase).toBe("paused");
    expect(r.timer).toBe(30);
  });

  it("running without q_started_at → quiz at full module time", () => {
    const r = project({ q_started_at: null });
    expect(r.phase).toBe("quiz");
    expect(r.timer).toBe(30);
  });

  it("pre-question countdown maps future timestamp to 3→2→1→0", () => {
    expect(project({ q_started_at: startedAgo(-4) }).cdNum).toBe(3); // 4s before start
    expect(project({ q_started_at: startedAgo(-3) }).cdNum).toBe(2);
    expect(project({ q_started_at: startedAgo(-2) }).cdNum).toBe(1);
    expect(project({ q_started_at: startedAgo(-1) }).cdNum).toBe(0); // START!
    expect(project({ q_started_at: startedAgo(-4) }).phase).toBe("quiz");
  });

  it("mid-question → quiz with remaining time from the DB module (regression: not 90s)", () => {
    const r = project({ q_started_at: startedAgo(10) }); // module 1 = 30s
    expect(r.phase).toBe("quiz");
    expect(r.timer).toBe(20);
    // Even though hardcoded MODULES has module 1 = 90s, the DB module (30s) wins.
    expect(r.timer).toBeLessThan(90);
  });

  it("uses the correct per-module time for later questions", () => {
    const r = projectLiveState({ session: sess({ current_question_idx: 2, q_started_at: startedAgo(10) }), questions, modules, now: NOW });
    expect(r.idx).toBe(2);
    expect(r.timer).toBe(50); // module 2 = 60s, 10s elapsed
  });

  it("timer hits 0 then transitions to reveal at timePerQ", () => {
    expect(project({ q_started_at: startedAgo(29.5) }).timer).toBe(1);
    expect(project({ q_started_at: startedAgo(30) }).phase).toBe("reveal");
  });

  it("reveal countdown runs REVEAL_SECONDS→0 after the question ends", () => {
    expect(project({ q_started_at: startedAgo(30) }).autoSec).toBe(REVEAL_SECONDS);     // just ended
    expect(project({ q_started_at: startedAgo(32) }).autoSec).toBe(REVEAL_SECONDS - 2); // 2s into reveal
    expect(project({ q_started_at: startedAgo(30 + REVEAL_SECONDS) }).autoSec).toBe(0); // window over (tpq + REVEAL_SECONDS)
    expect(project({ q_started_at: startedAgo(99) }).autoSec).toBe(0);                  // clamped, no negative
  });

  it("clamps current_question_idx to the last question", () => {
    const r = projectLiveState({ session: sess({ current_question_idx: 99, q_started_at: startedAgo(5) }), questions, modules, now: NOW });
    expect(r.idx).toBe(questions.length - 1);
  });
});

describe("remainingSeconds — timing precision", () => {
  const NOW = 1_700_000_000_000;
  const ago = (sec) => NOW - sec * 1000;

  it("counts down by whole seconds", () => {
    expect(remainingSeconds(30, ago(0), NOW)).toBe(30);
    expect(remainingSeconds(30, ago(10), NOW)).toBe(20);
    expect(remainingSeconds(30, ago(29.5), NOW)).toBe(1);
    expect(remainingSeconds(30, ago(30), NOW)).toBe(0);
  });

  it("never goes negative or above timePerQ (late / future timestamps)", () => {
    expect(remainingSeconds(30, ago(100), NOW)).toBe(0);   // long past
    expect(remainingSeconds(30, ago(-5), NOW)).toBe(30);   // future → clamp to max
  });

  // THE core guarantee: the participant timer (App.jsx) and the spectator
  // projection (LiveView / admin embed) must show the SAME number every second.
  // Participant historically used `timePerQ - floor(elapsed)`; prove it is
  // identical to the shared remainingSeconds across an entire question.
  it("participant formula == remainingSeconds for every 100ms of a question", () => {
    for (const tpq of [30, 60, 90, 45]) {
      for (let ms = 0; ms <= tpq * 1000; ms += 100) {
        const started = NOW - ms;
        const elapsed = ms / 1000;
        const participant = Math.max(0, tpq - Math.floor(elapsed));
        expect(remainingSeconds(tpq, started, NOW)).toBe(participant);
      }
    }
  });

  it("projectLiveState quiz timer == remainingSeconds (single source of truth)", () => {
    const questions = [{ id: "q1", module: 1 }];
    const modules = [{ id: 1, timePerQ: 30 }];
    for (let sec = 0; sec < 30; sec += 0.3) {
      const q_started_at = new Date(NOW - sec * 1000).toISOString();
      const proj = projectLiveState({ session: { status: "running", current_question_idx: 0, q_started_at }, questions, modules, now: NOW });
      if (proj.phase === "quiz") {
        expect(proj.timer).toBe(remainingSeconds(30, NOW - sec * 1000, NOW));
      }
    }
  });
});
