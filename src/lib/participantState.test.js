import { describe, it, expect, beforeEach } from "vitest";
import {
  PARTICIPANT_KEY, GAME_CACHE_KEY, BG_KEY,
  loadParticipant, saveParticipant, clearParticipant,
  saveGameCache, loadGameCache,
  normalizeSnapshot, mergeSessionRow, revealAnsFor, planChanged,
  snapshotSessionId, applySnapshot,
} from "./participantState.js";

const P = { code: "KRK-123456", name: "Jan", surname: "Kowalski", city: "Kraków" };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("loadParticipant / saveParticipant / clearParticipant", () => {
  it("migruje jednorazowo z sessionStorage do localStorage (razem z fue_bg)", () => {
    sessionStorage.setItem(PARTICIPANT_KEY, JSON.stringify(P));
    sessionStorage.setItem(BG_KEY, "url(x)");
    expect(loadParticipant()).toEqual(P);
    expect(JSON.parse(localStorage.getItem(PARTICIPANT_KEY))).toEqual(P);
    expect(sessionStorage.getItem(PARTICIPANT_KEY)).toBeNull();
    expect(localStorage.getItem(BG_KEY)).toBe("url(x)");
    expect(sessionStorage.getItem(BG_KEY)).toBeNull();
  });

  it("zwraca null gdy brak danych", () => {
    expect(loadParticipant()).toBeNull();
  });

  it("zepsuty JSON → null i usunięcie klucza", () => {
    localStorage.setItem(PARTICIPANT_KEY, "{nie-json");
    expect(loadParticipant()).toBeNull();
    expect(localStorage.getItem(PARTICIPANT_KEY)).toBeNull();
  });

  it("save + load round-trip; clear usuwa wszystkie klucze z obu magazynów", () => {
    saveParticipant({ ...P, sessionId: "s1" });
    saveGameCache("s1", { plan: [], session: { id: "s1" } });
    localStorage.setItem(BG_KEY, "x");
    sessionStorage.setItem(PARTICIPANT_KEY, "y");
    expect(loadParticipant()).toEqual({ ...P, sessionId: "s1" });
    clearParticipant();
    for (const k of [PARTICIPANT_KEY, GAME_CACHE_KEY, BG_KEY]) {
      expect(localStorage.getItem(k)).toBeNull();
      expect(sessionStorage.getItem(k)).toBeNull();
    }
  });
});

describe("saveGameCache / loadGameCache", () => {
  it("zwraca cache tylko dla tego samego sessionId", () => {
    const plan = [{ i: 0, id: "q1", o: 10000, c: 30000, r: 36000 }];
    saveGameCache("s1", { plan, session: { id: "s1", status: "running" } });
    const c = loadGameCache("s1");
    expect(c.plan).toEqual(plan);
    expect(c.session.status).toBe("running");
    expect(loadGameCache("s2")).toBeNull();
    expect(loadGameCache(null)).toBeNull();
  });

  it("zepsuty JSON → null", () => {
    localStorage.setItem(GAME_CACHE_KEY, "{{");
    expect(loadGameCache("s1")).toBeNull();
  });
});

describe("normalizeSnapshot", () => {
  it("mapuje snapshot na stan (ms, myAnswers po question_id)", () => {
    const n = normalizeSnapshot({
      server_now: 1000, error: null,
      session: { id: "s1", status: "running", plan_anchor_at: 500, plan_paused_at: "1970-01-01T00:00:00.700Z" },
      plan: [{ i: 0, id: "q1" }],
      my_answers: [{ question_id: "q1", chosen: 2, is_correct: true }, { question_id: "q2", chosen: null, is_correct: null }],
      reveal: { idx: 0, ans: 2 },
      correct_total: 1,
    });
    expect(n.session.plan_anchor_at).toBe(500);
    expect(n.session.plan_paused_at).toBe(700);
    expect(n.plan).toEqual([{ i: 0, id: "q1" }]);
    expect(n.myAnswers).toEqual({
      q1: { chosen: 2, status: "saved", correct: true },
      q2: { chosen: null, status: "saved", correct: null },
    });
    expect(n.reveal).toEqual({ idx: 0, ans: 2 });
    expect(n.correctTotal).toBe(1);
    expect(n.serverNowMs).toBe(1000);
    expect(n.error).toBeNull();
  });

  it("brak sesji / błąd kodu", () => {
    const n = normalizeSnapshot({ server_now: 5, error: "invalid code" });
    expect(n.session).toBeNull();
    expect(n.plan).toBeNull();
    expect(n.myAnswers).toEqual({});
    expect(n.error).toBe("invalid code");
  });
});

describe("mergeSessionRow", () => {
  it("nadpisuje pola z wiersza (ISO → ms), brak pola = stare zostaje", () => {
    const s = { id: "s1", status: "running", plan_anchor_at: 100, plan_paused_at: null, revealed_idx: 0, revealed_ans: 1, bg: "b" };
    const m = mergeSessionRow(s, { status: "paused", plan_paused_at: "1970-01-01T00:00:01.000Z" });
    expect(m).toEqual({ ...s, status: "paused", plan_paused_at: 1000 });
    const m2 = mergeSessionRow(s, { plan_anchor_at: "1970-01-01T00:00:02.000Z", revealed_idx: 3, revealed_ans: 0 });
    expect(m2.plan_anchor_at).toBe(2000);
    expect(m2.revealed_idx).toBe(3);
    expect(m2.revealed_ans).toBe(0);
    expect(m2.status).toBe("running");
  });

  it("jawny null w wierszu czyści pole (wznowienie zeruje plan_paused_at)", () => {
    const m = mergeSessionRow({ plan_paused_at: 5, status: "paused" }, { plan_paused_at: null, status: "running" });
    expect(m.plan_paused_at).toBeNull();
  });
});

describe("revealAnsFor", () => {
  it("najpierw revealed_* sesji, potem reveal snapshotu, inaczej null", () => {
    expect(revealAnsFor({ revealed_idx: 2, revealed_ans: 3 }, { idx: 2, ans: 1 }, 2)).toBe(3);
    expect(revealAnsFor({ revealed_idx: 1, revealed_ans: 3 }, { idx: 2, ans: 1 }, 2)).toBe(1);
    expect(revealAnsFor({ revealed_idx: 1, revealed_ans: 3 }, { idx: 1, ans: 0 }, 2)).toBeNull();
    expect(revealAnsFor(null, null, 0)).toBeNull();
  });
});

describe("planChanged", () => {
  it("true dla zmiany kotwicy ≥ 2 ms, pauzy lub statusu", () => {
    const a = { plan_anchor_at: 1000, plan_paused_at: null, status: "running" };
    expect(planChanged(a, { ...a, plan_anchor_at: 1001 })).toBe(false);
    expect(planChanged(a, { ...a, plan_anchor_at: 1002 })).toBe(true);
    expect(planChanged(a, { ...a, plan_paused_at: 5 })).toBe(true);
    expect(planChanged(a, { ...a, status: "results" })).toBe(true);
    expect(planChanged(a, { ...a })).toBe(false);
    expect(planChanged(null, a)).toBe(true);
  });
});

describe("snapshotSessionId", () => {
  it("hint ?? id bieżącej sesji ?? null", () => {
    expect(snapshotSessionId("h", { id: "s" })).toBe("h");
    expect(snapshotSessionId(undefined, { id: "s" })).toBe("s");
    expect(snapshotSessionId(null, null)).toBeNull();
  });
});

describe("applySnapshot", () => {
  const plan = [{ i: 0, id: "q1" }, { i: 1, id: "q2" }];

  it("ta sama sesja: plan zachowany, gdy snapshot bez planu; pending ma pierwszeństwo przed brakiem wpisu", () => {
    const prev = {
      session: { id: "s1", status: "running" }, plan,
      myAnswers: { q2: { chosen: 1, status: "pending", correct: null } },
      reveal: null, correctTotal: 0,
    };
    const next = applySnapshot(prev, normalizeSnapshot({
      server_now: 1, session: { id: "s1", status: "running", plan_anchor_at: 1 }, plan: null,
      my_answers: [{ question_id: "q1", chosen: 0, is_correct: true }], reveal: { idx: 0, ans: 0 }, correct_total: 1,
    }));
    expect(next.switched).toBe(false);
    expect(next.plan).toBe(plan);
    expect(next.myAnswers.q1).toEqual({ chosen: 0, status: "saved", correct: true });
    expect(next.myAnswers.q2).toEqual({ chosen: 1, status: "pending", correct: null });
    expect(next.reveal).toEqual({ idx: 0, ans: 0 });
    expect(next.correctTotal).toBe(1);
  });

  it("ta sama sesja: wpis z serwera nadpisuje pending", () => {
    const prev = { session: { id: "s1" }, plan, myAnswers: { q1: { chosen: 2, status: "pending", correct: null } }, reveal: null, correctTotal: 0 };
    const next = applySnapshot(prev, normalizeSnapshot({
      server_now: 1, session: { id: "s1" }, my_answers: [{ question_id: "q1", chosen: 2, is_correct: null }],
    }));
    expect(next.myAnswers.q1.status).toBe("saved");
  });

  it("nieaktualne sessionId: przełączenie na nowszą sesję nie przenosi niczego z sesji A", () => {
    const prev = {
      session: { id: "A", status: "ended" }, plan,
      myAnswers: {
        q1: { chosen: 0, status: "saved", correct: true },
        q2: { chosen: 1, status: "saved", correct: false },
      },
      reveal: { idx: 1, ans: 3 }, correctTotal: 1,
    };
    const next = applySnapshot(prev, normalizeSnapshot({
      server_now: 1, session: { id: "B", status: "waiting", plan_anchor_at: null }, plan: null,
      my_answers: [], reveal: null, correct_total: 0,
    }));
    expect(next.switched).toBe(true);
    expect(next.session.id).toBe("B");
    expect(next.session.status).toBe("waiting");
    expect(next.plan).toBeNull();
    expect(next.myAnswers).toEqual({});
    expect(next.reveal).toBeNull();
    expect(next.correctTotal).toBe(0);
  });
});
