import { describe, it, expect, vi } from "vitest";
import { listenSessionSignal, sessionSignalChannel, uniqueTopic } from "./sessionSignal.js";

// Atrapa klienta zachowująca się jak realtime-js 2.104: channel(topic) zwraca ISTNIEJĄCY kanał
// o tej samej nazwie, a postgres_changes po subscribe() rzuca wyjątek.
function fakeClient() {
  const channels = [];
  const client = {
    channels,
    channel(topic) {
      const t = `realtime:${topic}`;
      const ex = channels.find((c) => c.topic === t);
      if (ex) return ex;
      const ch = {
        topic: t, state: "closed", handlers: [], sent: [], removed: false,
        on(type, filter, cb) {
          if (this.state !== "closed" && type === "postgres_changes") throw new Error(`cannot add \`${type}\` callbacks for ${t} after \`subscribe()\`.`);
          this.handlers.push({ type, event: filter?.event, cb }); return this;
        },
        subscribe(cb) { if (this.state === "closed") { this.state = "joined"; cb?.("SUBSCRIBED"); } return this; },
        send(msg) { this.sent.push(msg); return Promise.resolve("ok"); },
        emit(event, payload) { for (const h of this.handlers) if (h.type === "broadcast" && h.event === event) h.cb({ event, payload }); },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: vi.fn((ch) => { ch.removed = true; ch.state = "closed"; channels.splice(channels.indexOf(ch), 1); }),
  };
  return client;
}

describe("listenSessionSignal", () => {
  it("dwóch słuchaczy tej samej sesji dzieli jeden kanał i obaj dostają sygnał", () => {
    const c = fakeClient();
    const a = vi.fn(), b = vi.fn();
    listenSessionSignal(c, "S1", a);
    listenSessionSignal(c, "S1", b);
    expect(c.channels).toHaveLength(1);
    c.channels[0].emit("quiz_event", { x: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("odejście jednego słuchacza NIE zamyka kanału drugiemu; ostatni zamyka", () => {
    const c = fakeClient();
    const a = vi.fn(), b = vi.fn();
    const offA = listenSessionSignal(c, "S1", a);
    const offB = listenSessionSignal(c, "S1", b);
    offA();
    expect(c.removeChannel).not.toHaveBeenCalled();
    c.channels[0].emit("quiz_event", {});
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    offB();
    expect(c.removeChannel).toHaveBeenCalledTimes(1);
    expect(c.channels).toHaveLength(0);
  });

  it("podwójne odpięcie tego samego słuchacza jest bezpieczne", () => {
    const c = fakeClient();
    const off = listenSessionSignal(c, "S1", vi.fn());
    off(); off();
    expect(c.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("sessionSignalChannel daje kanał do wysyłki i trzyma go, dopóki ktoś go używa", () => {
    const c = fakeClient();
    const listener = vi.fn();
    const sender = sessionSignalChannel(c, "S1");
    const offL = listenSessionSignal(c, "S1", listener);
    sender.channel.send({ type: "broadcast", event: "quiz_event", payload: {} });
    expect(c.channels[0].sent).toHaveLength(1);
    offL();
    expect(c.removeChannel).not.toHaveBeenCalled(); // wysyłający nadal trzyma kanał
    sender.release();
    expect(c.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("nowa sesja = nowy kanał (stary zamknięty po odejściu słuchaczy)", () => {
    const c = fakeClient();
    const off1 = listenSessionSignal(c, "S1", vi.fn());
    listenSessionSignal(c, "S2", vi.fn());
    expect(c.channels.map((x) => x.topic)).toEqual(["realtime:quiz-S1", "realtime:quiz-S2"]);
    off1();
    expect(c.channels.map((x) => x.topic)).toEqual(["realtime:quiz-S2"]);
  });
});

describe("uniqueTopic", () => {
  it("każde wywołanie daje inną nazwę — postgres_changes nigdy nie trafi na cudzy subskrybowany kanał", () => {
    const c = fakeClient();
    const t1 = uniqueTopic("quiz-rows-S1"), t2 = uniqueTopic("quiz-rows-S1");
    expect(t1).not.toBe(t2);
    c.channel(t1).on("postgres_changes", { event: "UPDATE" }, () => {}).subscribe();
    expect(() => c.channel(t2).on("postgres_changes", { event: "UPDATE" }, () => {})).not.toThrow();
  });
});
