import { describe, it, expect } from "vitest";
import { cityInfo, projectLiveState, remainingSeconds, REVEAL_SECONDS,
  shouldAdvance, advanceLeadSeconds, fallbackJitterMs,
  MODULE_INTRO_SECONDS, PRE_QUESTION_LEAD,
  shouldEndEarly, earlySkipFloorSeconds, ANSWER_PLATEAU_MS } from "./gameLogic.js";

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

  it("firstOfModule: true tylko dla pierwszego pytania modułu", () => {
    // questions: q1,q2 = moduł 1; q3 = moduł 2
    const at = (idx) => projectLiveState({ session: sess({ current_question_idx: idx, q_started_at: startedAgo(5) }), questions, modules, now: NOW }).firstOfModule;
    expect(at(0)).toBe(true);   // pierwsze w module 1
    expect(at(1)).toBe(false);  // drugie w module 1
    expect(at(2)).toBe(true);   // pierwsze w module 2
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

// ─── Sterowanie przejściem pytania (admin jako kierowca, 09.2026) ────────────

describe("shouldAdvance", () => {
  const NOW = 1_700_000_000_000;
  const startedAgo = (sec) => NOW - sec * 1000;

  it("nie przechodzi w trakcie trwania pytania", () => {
    expect(shouldAdvance(60, startedAgo(30), NOW)).toBe(false);
  });
  it("nie przechodzi w oknie odsłonięcia odpowiedzi", () => {
    expect(shouldAdvance(60, startedAgo(60 + REVEAL_SECONDS - 1), NOW)).toBe(false);
  });
  it("przechodzi dokładnie po czasie pytania + reveal", () => {
    expect(shouldAdvance(60, startedAgo(60 + REVEAL_SECONDS), NOW)).toBe(true);
  });
  it("nie przechodzi, gdy pytanie jeszcze nie wystartowało (lead w przyszłość)", () => {
    expect(shouldAdvance(60, NOW + 4000, NOW)).toBe(false);
  });
  it("nie przechodzi bez q_started_at", () => {
    expect(shouldAdvance(60, null, NOW)).toBe(false);
  });
  it("po cofnięciu q_started_at (auto-skip) czeka jeszcze pełne okno reveal", () => {
    // goToNextQuestion cofa znacznik o timePerQ → elapsed == timePerQ, reveal dopiero leci
    expect(shouldAdvance(60, startedAgo(60), NOW)).toBe(false);
    expect(shouldAdvance(60, startedAgo(60), NOW + REVEAL_SECONDS * 1000)).toBe(true);
  });
});

describe("advanceLeadSeconds", () => {
  it("pierwsze pytanie nowego modułu dostaje pełną zapowiedź modułu", () => {
    expect(advanceLeadSeconds({ module: 1 }, { module: 2 })).toBe(MODULE_INTRO_SECONDS);
  });
  it("kolejne pytanie w tym samym module dostaje odliczanie 3-2-1", () => {
    expect(advanceLeadSeconds({ module: 2 }, { module: 2 })).toBe(PRE_QUESTION_LEAD);
  });
  it("brak następnego pytania → domyślny lead", () => {
    expect(advanceLeadSeconds({ module: 2 }, undefined)).toBe(PRE_QUESTION_LEAD);
  });
});

describe("fallbackJitterMs", () => {
  it("jest deterministyczny dla tego samego kodu", () => {
    expect(fallbackJitterMs("KRK-482910")).toBe(fallbackJitterMs("KRK-482910"));
  });
  it("mieści się w zadanym oknie", () => {
    for (const code of ["KRK-000001", "WAR-999999", "POZ-123456", "", null]) {
      const ms = fallbackJitterMs(code);
      expect(ms).toBeGreaterThanOrEqual(6000);
      expect(ms).toBeLessThan(14000);
    }
  });
  it("rozrzuca uczestników — 100 kodów daje wiele różnych opóźnień", () => {
    const codes = Array.from({ length: 100 }, (_, i) => `KRK-${String(i).padStart(6, "0")}`);
    const distinct = new Set(codes.map((c) => fallbackJitterMs(c)));
    // Sens fallbacku: NIE odzywają się wszyscy naraz. Gdyby jitter był stały,
    // wróciłby dokładnie ten stampede, który ta zmiana likwiduje.
    expect(distinct.size).toBeGreaterThan(50);
  });
});

// ─── Wcześniejsze zakończenie pytania — regresja z 23.09.2026 ────────────────
// Stara wersja miała dwa wyzwalacze bez dolnej granicy czasu, przez co pytanie
// ucięte przy 60/500 odpowiedziach ustawiało próg na 60 i KAŻDE kolejne kończyło
// się przy 60. Te testy pilnują, żeby pętla się nie zamknęła ponownie.

describe("shouldEndEarly", () => {
  const base = { total: 3, expected: 0, issued: 3, elapsedS: 60, timePerQ: 60, sinceLastAnswerMs: 0 };

  it("NIE kończy pytania, dopóki nie minie podłoga czasu", () => {
    // Wasz test: 3 telefony, wszystkie odpowiedziały w 4 sekundy.
    expect(shouldEndEarly({ ...base, elapsedS: 4 })).toBe(false);
    expect(shouldEndEarly({ ...base, elapsedS: 10 })).toBe(false);
    expect(shouldEndEarly({ ...base, elapsedS: 35 })).toBe(false);
  });

  it("kończy, gdy po podłodze wszyscy odpowiedzieli", () => {
    expect(shouldEndEarly({ ...base, elapsedS: earlySkipFloorSeconds(60) })).toBe(true);
  });

  it("nie kończy przy zerze odpowiedzi — pytanie ma dojść do końca czasu", () => {
    expect(shouldEndEarly({ ...base, total: 0, elapsedS: 59 })).toBe(false);
  });

  it("plateau wymaga 12 s ciszy, nie 8", () => {
    const q = { ...base, total: 60, expected: 500, issued: 500, elapsedS: 50 };
    expect(shouldEndEarly({ ...q, sinceLastAnswerMs: 8000 })).toBe(false);
    expect(shouldEndEarly({ ...q, sinceLastAnswerMs: ANSWER_PLATEAU_MS })).toBe(true);
  });

  it("podłoga skaluje się z czasem modułu, ale nie schodzi poniżej 20 s", () => {
    expect(earlySkipFloorSeconds(90)).toBe(54);  // obliczenia
    expect(earlySkipFloorSeconds(60)).toBe(36);  // logika
    expect(earlySkipFloorSeconds(30)).toBe(20);  // terminy — podłoga minimalna
    expect(earlySkipFloorSeconds(10)).toBe(20);
  });

  it("REGRESJA: zatruty próg nie ucina quizu 500 osób przy 60 odpowiedziach", () => {
    // Odtworzenie przebiegu z symulacji: pierwsze pytanie ucięte przy 60/500 zatruwało
    // expected=60 i każde następne kończyło się natychmiast po 60 odpowiedziach.
    const poisoned = { total: 60, expected: 60, issued: 500, timePerQ: 60, sinceLastAnswerMs: 0 };
    // Przed podłogą — cisza: 440 osób wciąż odpowiada.
    expect(shouldEndEarly({ ...poisoned, elapsedS: 4 })).toBe(false);
    expect(shouldEndEarly({ ...poisoned, elapsedS: 20 })).toBe(false);
    // Podłoga 36 s daje wolniejszym czas, więc licznik zdąży urosnąć powyżej progu
    // i sam go odtruje — to jest mechanizm rozrywający pętlę.
    expect(shouldEndEarly({ ...poisoned, elapsedS: 30 })).toBe(false);
  });

  it("REGRESJA: pytanie 60 s nie może skończyć się po 10 s", () => {
    // Najkrótszy możliwy przebieg: podłoga + okno reveal.
    const floor = earlySkipFloorSeconds(60);
    expect(floor).toBeGreaterThanOrEqual(36);
    expect(floor + REVEAL_SECONDS).toBeGreaterThan(10);
  });
});
