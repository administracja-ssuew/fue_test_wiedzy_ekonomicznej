import { describe, it, expect } from "vitest";
import fixtures from "./plan.fixtures.json";
import {
  FIRST_QUESTION_LEAD, REVEAL_GATE_MS, toMs, buildPlanItems, planPosition, projectPlanState,
  sweepDecision, isRevealed, resumeAnchor, skipAnchor, repeatAnchor, answerResponseMs,
  holdDue, breakIdxAt, sweepAction, BREAK_MATCH_MS,
} from "./plan.js";
import { REVEAL_MS } from "./gameLogic.js";

const A = fixtures.anchorMs;
const ITEMS = fixtures.items;          // legacy: plan zamrożony przed sekcją 42 (reveal 6 s, bez przerw)
const V2 = fixtures.v2;                // plan zamrożony przy sekcji 42 (przerwy po 2 i 4) - sesje sprzed sekcji 46
const V3 = fixtures.v3;                // sekcja 46: przerwa tylko po module 3
const rel = (t) => (t == null ? null : A + t);

describe("stałe i toMs", () => {
  it("stałe planu", () => {
    expect(FIRST_QUESTION_LEAD).toBe(10);
    expect(REVEAL_GATE_MS).toBe(1500);
  });

  it("toMs normalizuje znaczniki czasu", () => {
    expect(toMs(null)).toBe(null);
    expect(toMs(undefined)).toBe(null);
    expect(toMs(1234)).toBe(1234);
    expect(toMs("2026-09-24T10:00:00.000Z")).toBe(Date.parse("2026-09-24T10:00:00.000Z"));
    expect(toMs("nie-data")).toBe(null);
  });
});

describe("buildPlanItems", () => {
  it("buduje items zgodne z fixture'ami v3 (kontrakt z SQL build_plan_items, sekcja 46)", () => {
    expect(buildPlanItems(V2.questions, V2.modules)).toEqual(V3.items);
  });

  it("pytania legacy → okno odsłony 11,5 s, brak przerwy po module 1", () => {
    const items = buildPlanItems(fixtures.questions, fixtures.modules);
    expect(items).toHaveLength(3);
    for (const it0 of items) {
      expect(it0.r - it0.c).toBe(11500);
      expect(it0.r - it0.c).toBe(REVEAL_MS);
      expect("h" in it0).toBe(false);
    }
  });

  it("znacznik h tylko na ostatnim pytaniu modułu 3, gdy po nim jest kolejny moduł", () => {
    const items = buildPlanItems(V2.questions, V2.modules);
    expect(items.filter((x) => x.h).map((x) => x.i)).toEqual([3]);
    // moduł 3 jako ostatni w planie → brak przerwy (quiz się po prostu kończy)
    const tail = buildPlanItems(V2.questions.slice(0, 4), V2.modules);
    expect(tail.filter((x) => x.h).map((x) => x.i)).toEqual([]);
    // po module 3 jest moduł 4 → przerwa
    const five = buildPlanItems(V2.questions.slice(0, 5), V2.modules);
    expect(five.filter((x) => x.h).map((x) => x.i)).toEqual([3]);
  });

  it("puste pytania → pusta lista", () => {
    expect(buildPlanItems([], fixtures.modules)).toEqual([]);
  });
});

describe("planPosition - fixture'y", () => {
  it("puste items lub brak kotwicy → null", () => {
    expect(planPosition([], A, null, A)).toBe(null);
    expect(planPosition(null, A, null, A)).toBe(null);
    expect(planPosition(ITEMS, null, null, A)).toBe(null);
  });

  for (const c of fixtures.position) {
    it(c.name, () => {
      const pos = planPosition(ITEMS, A, rel(c.pausedT), A + c.t);
      const it0 = ITEMS[c.expect.idx];
      expect(pos.idx).toBe(c.expect.idx);
      expect(pos.phase).toBe(c.expect.phase);
      expect(pos.item).toEqual(it0);
      expect(pos.opensAt).toBe(A + it0.o);
      expect(pos.closesAt).toBe(A + it0.c);
      expect(pos.revealUntil).toBe(A + it0.r);
    });
  }
});

describe("planPosition - v2 (reveal 11,5 s)", () => {
  for (const c of V2.position) {
    it(c.name, () => {
      const pos = planPosition(V2.items, A, rel(c.pausedT), A + c.t);
      const it0 = V2.items[c.expect.idx];
      expect(pos.idx).toBe(c.expect.idx);
      expect(pos.phase).toBe(c.expect.phase);
      expect(pos.item).toEqual(it0);
      expect(pos.opensAt).toBe(A + it0.o);
      expect(pos.closesAt).toBe(A + it0.c);
      expect(pos.revealUntil).toBe(A + it0.r);
    });
  }
});

describe("przerwy planowe (holdDue)", () => {
  for (const c of V2.hold) {
    it(c.name, () => {
      expect(holdDue(V2.items, A, c.holdIdx, A + c.t)).toBe(c.expect);
    });
  }

  it("plan legacy (bez h) nigdy nie ma przerwy", () => {
    expect(holdDue(ITEMS, A, null, A + 900000)).toBe(null);
  });

  it("brak planu lub kotwicy → null", () => {
    expect(holdDue([], A, null, A + 900000)).toBe(null);
    expect(holdDue(null, A, null, A + 900000)).toBe(null);
    expect(holdDue(V2.items, null, null, A + 900000)).toBe(null);
  });
});

describe("breakIdxAt", () => {
  it("pauza w granicach tolerancji BREAK_MATCH_MS → indeks przerwy", () => {
    expect(BREAK_MATCH_MS).toBe(2);
    const base = { items: V2.items, anchorMs: A, status: "paused", holdIdx: 2, nowMs: A + 500000 };
    expect(breakIdxAt({ ...base, pausedAtMs: A + 148500 })).toBe(2);
    expect(breakIdxAt({ ...base, pausedAtMs: A + 148502 })).toBe(2);
    expect(breakIdxAt({ ...base, pausedAtMs: A + 148503 })).toBe(null);
  });

  it("ręczna pauza po wznowieniu z przerwy (inna chwila) → null", () => {
    expect(breakIdxAt({ items: V2.items, anchorMs: A + 60000, pausedAtMs: A + 60000 + 190000,
      status: "paused", holdIdx: 2, nowMs: A + 400000 })).toBe(null);
  });

  it("wyniki / lobby → null", () => {
    expect(breakIdxAt({ items: V2.items, anchorMs: A, status: "results", holdIdx: null, nowMs: A + 200000 })).toBe(null);
  });
});

describe("sweepAction (lustro advance_due_sessions, sekcja 42)", () => {
  it("running, przerwa po module 2 należna → hold dokładnie na granicy", () => {
    const row = { status: "running", anchorMs: A, pausedAtMs: null, curIdx: 2, qStartedAtMs: A + 107000, revealedIdx: 2, holdIdx: null };
    expect(sweepAction(row, V2.items, A + 149000)).toEqual({
      action: "hold", status: "paused", holdIdx: 2, pausedAtMs: A + 148500,
      idx: 3, qStartedAtMs: A + 178500, revealedIdx: 2,
    });
  });

  it("po wznowieniu (przerwa zużyta) → brak ponownego zatrzymania", () => {
    const a2 = A + 60000;
    const row = { status: "running", anchorMs: a2, pausedAtMs: null, curIdx: 3, qStartedAtMs: a2 + 178500, revealedIdx: 2, holdIdx: 2 };
    expect(sweepAction(row, V2.items, a2 + 150000).action).toBe("none");
  });

  it("pauza / brak kotwicy → deleguje do sweepDecision (none)", () => {
    const row = { status: "paused", anchorMs: A, pausedAtMs: A + 148500, curIdx: 3, qStartedAtMs: A + 178500, revealedIdx: 2, holdIdx: 2 };
    expect(sweepAction(row, V2.items, A + 400000).action).toBe("none");
  });

  for (const c of fixtures.sweep) {
    it(`legacy ${c.name} - wynik jak sweepDecision`, () => {
      const row = {
        status: c.row.status, anchorMs: A, pausedAtMs: rel(c.row.pausedT), curIdx: c.row.curIdx,
        qStartedAtMs: rel(c.row.qStartedT), revealedIdx: c.row.revealedIdx, holdIdx: null,
      };
      expect(sweepAction(row, ITEMS, A + c.t)).toEqual(sweepDecision(row, ITEMS, A + c.t));
    });
  }
});

describe("projectPlanState - przerwa planowa", () => {
  it("running, przerwa należna, zanim zamiatacz zapisał pauzę → paused (plannedBreak)", () => {
    const s = projectPlanState({ items: V2.items, anchorMs: A, status: "running", holdIdx: null, nowMs: A + 150000 });
    expect(s.phase).toBe("paused");
    expect(s.plannedBreak).toBe(true);
    expect(s.breakAfterModule).toBe(2);
    expect(s.nextModule).toBe(3);
    expect(s.idx).toBe(3);
    expect(s.underPhase).toBe("intro");
    expect(s.remainingMs).toBe(30000);
  });

  it("paused zapisane przez zamiatacz na granicy → paused (plannedBreak)", () => {
    const s = projectPlanState({ items: V2.items, anchorMs: A, pausedAtMs: A + 148500, status: "paused", holdIdx: 2, nowMs: A + 500000 });
    expect(s.phase).toBe("paused");
    expect(s.plannedBreak).toBe(true);
    expect(s.nextModule).toBe(3);
  });

  it("po wznowieniu z przerwy → zapowiedź modułu 3, bez przerwy", () => {
    const a2 = A + 60000;
    const s = projectPlanState({ items: V2.items, anchorMs: a2, status: "running", holdIdx: 2, nowMs: a2 + 148600 });
    expect(s.phase).toBe("intro");
    expect(s.idx).toBe(3);
    expect(s.plannedBreak).toBe(false);
  });

  it("ręczna pauza (nie na granicy przerwy) → plannedBreak false", () => {
    const s = projectPlanState({ items: V2.items, anchorMs: A, pausedAtMs: A + 100000, status: "paused", holdIdx: null, nowMs: A + 200000 });
    expect(s.phase).toBe("paused");
    expect(s.plannedBreak).toBe(false);
    expect(s.breakAfterModule).toBe(null);
    expect(s.nextModule).toBe(null);
  });

  it("plan legacy do końca → finished bez przerwy", () => {
    const s = projectPlanState({ items: ITEMS, anchorMs: A, status: "running", nowMs: A + 900000 });
    expect(s.phase).toBe("finished");
    expect(s.plannedBreak).toBe(false);
  });
});

describe("zamiatacz (sweepDecision) - fixture'y", () => {
  for (const c of fixtures.sweep) {
    it(c.name, () => {
      const row = {
        status: c.row.status,
        anchorMs: A,
        pausedAtMs: rel(c.row.pausedT),
        curIdx: c.row.curIdx,
        qStartedAtMs: rel(c.row.qStartedT),
        revealedIdx: c.row.revealedIdx,
      };
      const d = sweepDecision(row, ITEMS, A + c.t);
      expect(d.action).toBe(c.expect.action);
      if (c.expect.action !== "none") {
        expect(d.status).toBe(c.expect.status);
        expect(d.idx).toBe(c.expect.idx);
        expect(d.qStartedAtMs).toBe(A + c.expect.qStartedT);
        expect(d.revealedIdx).toBe(c.expect.revealedIdx);
      }
    });
  }

  it("brak kotwicy lub planu → none", () => {
    const row = { status: "running", anchorMs: null, pausedAtMs: null, curIdx: 0, qStartedAtMs: null, revealedIdx: null };
    expect(sweepDecision(row, ITEMS, A).action).toBe("none");
    expect(sweepDecision({ ...row, anchorMs: A }, [], A).action).toBe("none");
    expect(sweepDecision({ ...row, anchorMs: A }, null, A).action).toBe("none");
  });

  it("revealedIdx undefined traktowane jak null", () => {
    const row = { status: "running", anchorMs: A, pausedAtMs: null, curIdx: 0, qStartedAtMs: A + 10000 };
    expect(sweepDecision(row, ITEMS, A + 20000).action).toBe("none");
  });
});

describe("projectPlanState - fixture'y", () => {
  for (const c of fixtures.project) {
    it(c.name, () => {
      const items = c.items === "full" ? ITEMS : c.items === "empty" ? [] : null;
      const s = projectPlanState({ items, anchorMs: c.hasAnchor ? A : null, status: c.status, nowMs: A + c.t });
      expect(s.phase).toBe(c.expect.phase);
      if (c.expect.idx !== undefined) expect(s.idx).toBe(c.expect.idx);
    });
  }

  it("pola zwracane dla quizu", () => {
    const s = projectPlanState({ items: ITEMS, anchorMs: A, status: "running", nowMs: A + 15000 });
    expect(s.underPhase).toBe("quiz");
    expect(s.remainingMs).toBe(15000);
    expect(s.secondsLeft).toBe(15);
    expect(s.firstOfModule).toBe(true);
    expect(s.closesAt).toBe(A + 30000);
  });

  it("remainingMs w każdej fazie", () => {
    const at = (t) => projectPlanState({ items: ITEMS, anchorMs: A, status: "running", nowMs: A + t });
    expect(at(2500).remainingMs).toBe(7500);    // intro
    expect(at(37000).remainingMs).toBe(3000);   // countdown
    expect(at(37000).firstOfModule).toBe(false);
    expect(at(32000).remainingMs).toBe(4000);   // reveal
    expect(at(200000).remainingMs).toBe(0);     // finished
    expect(at(200000).secondsLeft).toBe(0);
    expect(at(14500).secondsLeft).toBe(16);     // ceil(15.5)
  });

  it("status paused bez pausedAtMs → spauzowane w chwili teraz", () => {
    const s = projectPlanState({ items: ITEMS, anchorMs: A, status: "paused", nowMs: A + 15000 });
    expect(s.phase).toBe("paused");
    expect(s.underPhase).toBe("quiz");
    expect(s.remainingMs).toBe(15000);
  });
});

describe("pauza - wznowienie po 60 s daje ten sam stan", () => {
  for (const t of [5000, 38000, 15000, 33000, 80000]) {
    it(`pauza w t=${t}`, () => {
      const pausedAt = A + t;
      const ref = projectPlanState({ items: ITEMS, anchorMs: A, status: "running", nowMs: pausedAt });

      // w trakcie pauzy (60 s później) czas stoi
      const during = projectPlanState({ items: ITEMS, anchorMs: A, pausedAtMs: pausedAt, status: "paused", nowMs: pausedAt + 60000 });
      expect(during.phase).toBe("paused");
      expect(during.underPhase).toBe(ref.phase);
      expect(during.remainingMs).toBe(ref.remainingMs);
      expect(during.idx).toBe(ref.idx);

      // wznowienie po 60 s
      const now = pausedAt + 60000;
      const a2 = resumeAnchor(A, pausedAt, now);
      expect(a2).toBe(A + 60000);
      const after = projectPlanState({ items: ITEMS, anchorMs: a2, status: "running", nowMs: now });
      expect(after.phase).toBe(ref.phase);
      expect(after.remainingMs).toBe(ref.remainingMs);
      expect(after.idx).toBe(ref.idx);
    });
  }

  it("isRevealed zatrzymuje się w pauzie", () => {
    const it0 = ITEMS[0];
    expect(isRevealed(it0, A, null, A + 31499)).toBe(false);
    expect(isRevealed(it0, A, null, A + 31500)).toBe(true);
    expect(isRevealed(it0, A, A + 20000, A + 90000)).toBe(false);
  });
});

describe("pauza na granicach faz (G2)", () => {
  // Pauza dokładnie na granicy (zamknięcie, bramka odsłony, koniec odsłony, otwarcie
  // następnego) i ±1 ms: po wznowieniu (60 s) ta sama faza, pytanie i remaining co tuż przed.
  const cases = [["legacy", ITEMS], ["v2", V2.items]];
  for (const [name, items] of cases) {
    for (const N of [0, 1]) {
      const it0 = items[N];
      const nx = items[N + 1];
      const ts = [it0.c, it0.c + REVEAL_GATE_MS, it0.r - 1, it0.r, nx.o - 1, nx.o];
      for (const t of ts) {
        it(`${name}: pytanie ${N}, pauza w t=${t}`, () => {
          const pausedAt = A + t;
          const ref = projectPlanState({ items, anchorMs: A, status: "running", nowMs: pausedAt, holdIdx: null });
          const during = projectPlanState({ items, anchorMs: A, pausedAtMs: pausedAt, status: "paused", nowMs: pausedAt + 60000, holdIdx: null });
          expect(during.phase).toBe("paused");
          expect(during.plannedBreak).toBe(false);
          expect(during.underPhase).toBe(ref.phase);
          expect(during.idx).toBe(ref.idx);
          expect(during.remainingMs).toBe(ref.remainingMs);

          const now = pausedAt + 60000;
          const a2 = resumeAnchor(A, pausedAt, now);
          const after = projectPlanState({ items, anchorMs: a2, status: "running", nowMs: now, holdIdx: null });
          expect(after.phase).toBe(ref.phase);
          expect(after.idx).toBe(ref.idx);
          expect(after.remainingMs).toBe(ref.remainingMs);
        });
      }
    }
  }

  it("v2: ręczna pauza w odsłonie ostatniego pytania modułu 2 → po wznowieniu reveal 2, a przerwa planowa nie przepada", () => {
    const pausedAt = A + 147000;
    const now = pausedAt + 60000;
    const a2 = resumeAnchor(A, pausedAt, now);
    const after = projectPlanState({ items: V2.items, anchorMs: a2, status: "running", nowMs: now, holdIdx: null });
    expect(after.phase).toBe("reveal");
    expect(after.idx).toBe(2);
    expect(after.remainingMs).toBe(1500);
    const atBreak = projectPlanState({ items: V2.items, anchorMs: a2, status: "running", nowMs: a2 + V2.items[2].r, holdIdx: null });
    expect(atBreak.phase).toBe("paused");
    expect(atBreak.plannedBreak).toBe(true);
    expect(atBreak.breakAfterModule).toBe(2);
  });

  it("v2: przerwa zużyta, ręczna pauza w zapowiedzi modułu 3 → po wznowieniu intro 3, bez przerwy", () => {
    const pausedAt = A + 160000;
    const during = projectPlanState({ items: V2.items, anchorMs: A, pausedAtMs: pausedAt, status: "paused", nowMs: pausedAt + 60000, holdIdx: 2 });
    expect(during.plannedBreak).toBe(false);
    const now = pausedAt + 60000;
    const a2 = resumeAnchor(A, pausedAt, now);
    const after = projectPlanState({ items: V2.items, anchorMs: a2, status: "running", nowMs: now, holdIdx: 2 });
    expect(after.phase).toBe("intro");
    expect(after.idx).toBe(3);
    expect(after.plannedBreak).toBe(false);
    expect(after.remainingMs).toBe(18500);
  });
});

describe("przesunięcie kotwicy (Następne / Powtórz)", () => {
  it("skip w t=15000 → reveal, closesAt===now, kolejne terminy przesunięte", () => {
    const now = A + 15000;
    const a2 = skipAnchor(ITEMS, A, now, 0);
    expect(a2).toBe(A - 15000);
    const pos = planPosition(ITEMS, a2, null, now);
    expect(pos.phase).toBe("reveal");
    expect(pos.closesAt).toBe(now);
    expect(a2 + ITEMS[1].o).toBe(A + 25000);
    // drugi klik - no-op
    expect(skipAnchor(ITEMS, a2, now, 0)).toBe(null);
  });

  it("skip z nieaktualnym expectedIdx → null", () => {
    expect(skipAnchor(ITEMS, A, A + 15000, 1)).toBe(null);
  });

  it("skip poza fazą quiz → null", () => {
    expect(skipAnchor(ITEMS, A, A + 5000, 0)).toBe(null);
  });

  it("repeat w t=15000 → pytanie od nowa", () => {
    const now = A + 15000;
    const a2 = repeatAnchor(ITEMS, A, now, 0);
    expect(a2).toBe(A + 5000);
    const s = projectPlanState({ items: ITEMS, anchorMs: a2, status: "running", nowMs: now });
    expect(s.phase).toBe("quiz");
    expect(s.opensAt).toBe(now);
    expect(s.remainingMs).toBe(20000);
    expect(repeatAnchor(ITEMS, A, now, 1)).toBe(null);
  });

  it("answerResponseMs", () => {
    const it0 = ITEMS[0];
    expect(answerResponseMs(it0, A, A + 10000 + 2345, 1)).toBe(2345);
    expect(answerResponseMs(it0, A, A + 31000, 1)).toBe(20000); // strefa tolerancji → zero bonusu
    expect(answerResponseMs(it0, A, A + 15000, null)).toBe(20000);
    expect(answerResponseMs(it0, A, A + 5000, 2)).toBe(0);
  });
});

describe("moduły - plan zamrożony przy budowie", () => {
  it("zmiana timePerQ po buildPlanItems nie zmienia projekcji", () => {
    const mods = V2.modules.map((m) => ({ ...m }));
    const items = buildPlanItems(V2.questions, mods);
    const before = projectPlanState({ items, anchorMs: A, status: "running", nowMs: A + 50000 });
    mods[0].timePerQ = 90;
    mods[1].timePerQ = 5;
    const after = projectPlanState({ items, anchorMs: A, status: "running", nowMs: A + 50000 });
    expect(after).toEqual(before);
    expect(items).toEqual(V3.items);
  });

  it("brak modułu → tpq 60", () => {
    const items = buildPlanItems([{ id: "x", module: 9 }], fixtures.modules);
    expect(items[0].tpq).toBe(60);
    expect(items[0].lead).toBe(10);
    expect(items[0].c).toBe(10000 + 60000);
  });
});
