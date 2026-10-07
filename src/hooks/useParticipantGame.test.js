import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Supabase podmieniony w całości: snapshot sterowany ręcznie (odpowiedź / zawieszenie),
// kanał Realtime zapamiętuje handlery, żeby test mógł „dostarczyć” wiersz quiz_sessions.
const h = vi.hoisted(() => ({ handlers: {}, calls: [] }));
vi.mock("../lib/supabase.js", () => {
  const channel = {
    state: "joined",
    on(type, _filter, cb) { h.handlers[type] = cb; return channel; },
    subscribe(cb) { if (cb) cb("SUBSCRIBED"); return channel; },
  };
  return {
    DEMO: false,
    supabase: {
      channel: () => channel,
      removeChannel: () => {},
      realtime: { connect: () => {} },
      rpc: async () => ({ data: null, error: { message: "brak w teście" } }),
    },
    getParticipantState: vi.fn((code, opts) => {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      h.calls.push({ code, opts: opts || {}, at: Date.now(), resolve });
      return promise;
    }),
    submitAnswerV2: vi.fn(async () => ({ accepted: true, duplicate: false, chosen: null, error: null, retryable: false })),
  };
});

import useParticipantGame from "./useParticipantGame.js";
import { getParticipantState } from "../lib/supabase.js";

const SID = "S1";
const PLAN = [
  { i: 0, id: "q1", m: 1, tpq: 20, lead: 10, o: 10000, c: 30000, r: 41500, q: "Pytanie 1", opts: ["a", "b", "c", "d"] },
  { i: 1, id: "q2", m: 1, tpq: 20, lead: 4, o: 45500, c: 65500, r: 77000, q: "Pytanie 2", opts: ["a", "b", "c", "d"] },
];
const PARTICIPANT = { code: "KOD1", name: "Jan", surname: "Test", city: "Kraków", sessionId: null };

function snap({ status, anchor = null, plan = null, sid = SID }) {
  const now = Date.now();
  return {
    data: {
      server_now: now, error: null,
      session: { id: sid, city: "Kraków", status, is_practice: false, plan_anchor_at: anchor, plan_paused_at: null, plan_hold_idx: null },
      plan, my_answers: [], reveal: null, correct_total: 0,
    },
    error: null, t0: now, t1: now,
  };
}

const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  h.calls.length = 0;
  for (const k of Object.keys(h.handlers)) delete h.handlers[k];
  getParticipantState.mockClear();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(1_000_000);
  // Ticker bez rAF → fallback setTimeout(16) (sfałszowany razem z zegarem).
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);
  // Jitter 999 ms, siatka bezpieczeństwa startuje po ~15 s (poza oknem testów).
  vi.spyOn(Math, "random").mockReturnValue(0.999);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete document.startViewTransition;
});

async function mountInLobby() {
  const hook = renderHook(() => useParticipantGame(PARTICIPANT));
  expect(h.calls.length).toBe(1);
  await act(async () => { h.calls[0].resolve(snap({ status: "waiting" })); await vi.advanceTimersByTimeAsync(0); });
  expect(hook.result.current.loadState).toBe("ready");
  expect(hook.result.current.view.phase).toBe("lobby");
  expect(typeof h.handlers.postgres_changes).toBe("function");
  return hook;
}

describe("useParticipantGame - zawieszony snapshot nie blokuje planu (G7, 06-17 przebieg 05)", () => {
  it("wiersz startu przy zawieszonym snapshocie z lobby → plan i zapowiedź w ≤ 1,5 s", async () => {
    const { result } = await mountInLobby();

    // Snapshot z lobby (jak siatka bezpieczeństwa o −3,18 s), który utknie na ~21 s.
    act(() => { result.current.refresh(); });
    expect(h.calls.length).toBe(2);
    const hung = h.calls[1];
    await tick(3200);

    // Start quizu: wiersz Realtime z kotwicą (bez planu → faza plan_loading).
    const anchor = Date.now() - 100;
    const rowAt = Date.now();
    act(() => { h.handlers.postgres_changes({ new: { status: "running", plan_anchor_at: anchor, plan_paused_at: null, plan_hold_idx: null } }); });
    expect(result.current.view.phase).toBe("plan_loading");

    // Nowe żądanie z planem musi wyjść, nie czekając na zawieszone.
    await tick(1500);
    expect(h.calls.length).toBeGreaterThanOrEqual(3);
    const fresh = h.calls[h.calls.length - 1];
    expect(fresh.opts.includePlan).toBe(true);
    expect(fresh.at - rowAt).toBeLessThanOrEqual(1500);
    await act(async () => { fresh.resolve(snap({ status: "running", anchor, plan: PLAN })); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.plan).toHaveLength(2);
    expect(result.current.view.phase).toBe("intro");
    expect(result.current.view.idx).toBe(0);

    // Zawieszone żądanie zostało anulowane…
    expect(hung.opts.signal?.aborted).toBe(true);
    // …a jego spóźniona odpowiedź (stan starszy) niczego nie nadpisuje (gwarancja H1).
    await act(async () => { hung.resolve(snap({ status: "waiting" })); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.session.status).toBe("running");
    expect(result.current.plan).toHaveLength(2);
    expect(result.current.view.phase).toBe("intro");

    // Pytanie 1 otwiera się o czasie planu.
    await tick(anchor + 10000 - Date.now() + 20);
    expect(result.current.view.phase).toBe("quiz");
  });

  it("snapshot wysłany przed wierszem startu nie czeka do limitu 4 s - porzucony po 1,5 s od wysłania", async () => {
    const { result } = await mountInLobby();
    act(() => { result.current.refresh(); });
    const hung = h.calls[1];
    await tick(300);                          // wysłany 0,3 s przed startem

    const anchor = Date.now();
    const rowAt = Date.now();
    act(() => { h.handlers.postgres_changes({ new: { status: "running", plan_anchor_at: anchor, plan_paused_at: null, plan_hold_idx: null } }); });
    await tick(1000);                         // jitter 999 ms → wywołanie z planem; termin = wysłanie + 1,5 s
    expect(h.calls.length).toBe(2);           // jeszcze nie minęło 1,5 s od wysłania
    await tick(250);
    expect(h.calls.length).toBe(3);           // wysłanie + 1,5 s → nowe żądanie (limit 4 s dopiero za 2,5 s)
    expect(hung.opts.signal?.aborted).toBe(true);
    const fresh = h.calls[2];
    expect(fresh.opts.includePlan).toBe(true);
    expect(fresh.at - rowAt).toBeLessThanOrEqual(1250);
    await act(async () => { fresh.resolve(snap({ status: "running", anchor, plan: PLAN })); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.view.phase).toBe("intro");
  });

  it("wiersz startu przy ZDROWYM snapshocie w locie (wysłanym po wierszu) → bez porzucania", async () => {
    const { result } = await mountInLobby();
    const anchor = Date.now();
    act(() => { h.handlers.postgres_changes({ new: { status: "running", plan_anchor_at: anchor, plan_paused_at: null, plan_hold_idx: null } }); });
    await tick(1000);
    expect(h.calls.length).toBe(2);           // snapshot z planem po jitterze (wysłany PO wierszu)
    const planCall = h.calls[1];
    // Kolejne wywołanie w trakcie (np. broadcast) - bez nowego wiersza nie porzucamy żądania.
    act(() => { result.current.refresh(); });
    await tick(3000);
    expect(h.calls.length).toBe(2);
    expect(planCall.opts.signal?.aborted).toBe(false);
    await act(async () => { planCall.resolve(snap({ status: "running", anchor, plan: PLAN })); await vi.advanceTimersByTimeAsync(20); });
    expect(result.current.plan).toHaveLength(2);
  });

  it("zawieszony snapshot z montażu → limit czasu i natychmiastowe ponowienie", async () => {
    const { result } = renderHook(() => useParticipantGame(PARTICIPANT));
    expect(h.calls.length).toBe(1);
    const hung = h.calls[0];

    await tick(3900);
    expect(h.calls.length).toBe(1);          // przed limitem - bez dublowania
    await tick(200);
    expect(h.calls.length).toBe(2);          // limit 4 s → ponowienie od razu (brak sesji)
    expect(hung.opts.signal?.aborted).toBe(true);
    expect(result.current.loadState).toBe("loading"); // nie „error” w trakcie ponawiania

    await act(async () => { h.calls[1].resolve(snap({ status: "waiting" })); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.loadState).toBe("ready");
    expect(result.current.view.phase).toBe("lobby");

    // Spóźniona odpowiedź porzuconego żądania (inna sesja) jest ignorowana.
    await act(async () => { hung.resolve(snap({ status: "running", sid: "INNA" })); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.session.id).toBe(SID);
  });

  it("limit czasu przy stanie z planem → ponowienie z rozrzutem, nie natychmiast", async () => {
    const { result } = await mountInLobby();
    act(() => { h.handlers.postgres_changes({ new: { status: "running", plan_anchor_at: Date.now(), plan_paused_at: null, plan_hold_idx: null } }); });
    await tick(1000);
    const planCall = h.calls[h.calls.length - 1];
    await act(async () => { planCall.resolve(snap({ status: "running", anchor: Date.now() - 1000, plan: PLAN })); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.plan).toHaveLength(2);

    const before = h.calls.length;
    act(() => { result.current.refresh(); });
    expect(h.calls.length).toBe(before + 1);
    await tick(4000);                         // limit
    expect(h.calls.length).toBe(before + 1);  // bez natychmiastowej burzy ponowień
    await tick(1100);                         // 1. ponowienie: 500-1000 ms
    expect(h.calls.length).toBe(before + 2);
    expect(result.current.view.phase).toBe("intro"); // projekcja z planu działa dalej
  });
});

describe("useParticipantGame - View Transitions na wolnym renderze", () => {
  function fakeVT(callbackDelayMs) {
    const vtCalls = [];
    document.startViewTransition = vi.fn((cb) => {
      let done;
      const finished = new Promise((r) => { done = r; });
      const rec = { call: Date.now(), cb: null };
      vtCalls.push(rec);
      setTimeout(() => { rec.cb = Date.now(); cb(); done(); }, callbackDelayMs);
      return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished, skipTransition: vi.fn() };
    });
    return vtCalls;
  }

  async function mountRunning() {
    const hook = await mountInLobby();
    const anchor = Date.now();
    act(() => { h.handlers.postgres_changes({ new: { status: "running", plan_anchor_at: anchor, plan_paused_at: null, plan_hold_idx: null } }); });
    await tick(1000);
    const planCall = h.calls[h.calls.length - 1];
    await act(async () => { planCall.resolve(snap({ status: "running", anchor, plan: PLAN })); await vi.advanceTimersByTimeAsync(20); });
    expect(hook.result.current.view.phase).toBe("intro");
    return { ...hook, anchor };
  }

  // P7-VT-SMOOTH: start pytania (intro/countdown → quiz) nigdy przez VT; po wolnym przejściu VT
  // wyłączone czasowo (wraca po 120 płynnych klatkach), na stałe dopiero po 2. porażce.
  // Czasowe wyłączenie w oknie < 120 klatek pokrywają testy czystych funkcji (viewTransition.test.js).
  it("callback przejścia odkładany 400 ms → faza po ≤ 150 ms; VT wraca po płynnych klatkach, na stałe wyłączone po 2. porażce", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    const { result, anchor } = await mountRunning();
    const vtCalls = fakeVT(400);

    await tick(anchor + 10000 - Date.now() + 20);   // granica pytania 1 (+ jedna klatka)
    expect(result.current.view.phase).toBe("quiz"); // start pytania bez VT - od razu
    expect(vtCalls.length).toBe(0);

    await tick(anchor + 30000 - Date.now() + 20);   // granica odsłony
    expect(vtCalls.length).toBe(1);
    await tick(150);
    expect(result.current.view.phase).toBe("reveal"); // limit 150 ms, nie callback po 400 ms (1. porażka)

    await tick(anchor + 41500 - Date.now() + 20);   // koniec odsłony - 11 s płynnych klatek później
    expect(vtCalls.length).toBe(2);                 // VT wróciło (callback po skip nie policzył 2. porażki)
    await tick(150);
    expect(result.current.view.phase).not.toBe("reveal"); // 2. porażka

    await tick(anchor + 45500 - Date.now() + 20);   // start pytania 2 - bez VT
    expect(result.current.view.phase).toBe("quiz");
    await tick(anchor + 65500 - Date.now() + 20);   // odsłona pytania 2
    expect(result.current.view.phase).toBe("reveal");
    expect(vtCalls.length).toBe(2);                 // po 2 porażkach VT wyłączone na stałe
  });

  it("szybki callback przejścia → View Transitions zostają włączone (poza startem pytania)", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    const { result, anchor } = await mountRunning();
    const vtCalls = fakeVT(10);

    await tick(anchor + 10000 - Date.now() + 40);
    expect(result.current.view.phase).toBe("quiz");
    expect(vtCalls.length).toBe(0);                 // intro → quiz bez VT
    await tick(anchor + 30000 - Date.now() + 40);
    expect(result.current.view.phase).toBe("reveal");
    expect(vtCalls.length).toBe(1);
    await tick(anchor + 41500 - Date.now() + 40);
    expect(vtCalls.length).toBe(2);
    await tick(anchor + 45500 - Date.now() + 40);
    expect(result.current.view.phase).toBe("quiz");
    expect(vtCalls.length).toBe(2);                 // odliczanie/zapowiedź → quiz bez VT
    await tick(anchor + 65500 - Date.now() + 40);
    expect(result.current.view.phase).toBe("reveal");
    expect(vtCalls.length).toBe(3);
  });
});
