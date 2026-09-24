import { describe, it, expect } from "vitest";
import fixtures from "./plan.fixtures.json";
import {
  FIRST_QUESTION_LEAD, REVEAL_GATE_MS, toMs, buildPlanItems, planPosition, projectPlanState,
  sweepDecision, isRevealed, resumeAnchor, skipAnchor, repeatAnchor, answerResponseMs,
} from "./plan.js";

const A = fixtures.anchorMs;
const ITEMS = fixtures.items;
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
  it("buduje items zgodne z fixture'ami (kontrakt z SQL)", () => {
    expect(buildPlanItems(fixtures.questions, fixtures.modules)).toEqual(ITEMS);
  });

  it("puste pytania → pusta lista", () => {
    expect(buildPlanItems([], fixtures.modules)).toEqual([]);
  });
});

describe("planPosition — fixture'y", () => {
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

describe("zamiatacz (sweepDecision) — fixture'y", () => {
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

describe("projectPlanState — fixture'y", () => {
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

describe("pauza — wznowienie po 60 s daje ten sam stan", () => {
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

describe("przesunięcie kotwicy (Następne / Powtórz)", () => {
  it("skip w t=15000 → reveal, closesAt===now, kolejne terminy przesunięte", () => {
    const now = A + 15000;
    const a2 = skipAnchor(ITEMS, A, now, 0);
    expect(a2).toBe(A - 15000);
    const pos = planPosition(ITEMS, a2, null, now);
    expect(pos.phase).toBe("reveal");
    expect(pos.closesAt).toBe(now);
    expect(a2 + ITEMS[1].o).toBe(A + 25000);
    // drugi klik — no-op
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

describe("moduły — plan zamrożony przy budowie", () => {
  it("zmiana timePerQ po buildPlanItems nie zmienia projekcji", () => {
    const mods = fixtures.modules.map((m) => ({ ...m }));
    const items = buildPlanItems(fixtures.questions, mods);
    const before = projectPlanState({ items, anchorMs: A, status: "running", nowMs: A + 50000 });
    mods[0].timePerQ = 90;
    mods[1].timePerQ = 5;
    const after = projectPlanState({ items, anchorMs: A, status: "running", nowMs: A + 50000 });
    expect(after).toEqual(before);
    expect(items).toEqual(ITEMS);
  });

  it("brak modułu → tpq 60", () => {
    const items = buildPlanItems([{ id: "x", module: 9 }], fixtures.modules);
    expect(items[0].tpq).toBe(60);
    expect(items[0].lead).toBe(10);
    expect(items[0].c).toBe(10000 + 60000);
  });
});
