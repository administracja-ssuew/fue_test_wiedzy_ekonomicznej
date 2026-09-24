import { describe, it, expect } from "vitest";
import { computeOffset, addClockSample, getClockOffset, isClockSynced } from "./serverClock.js";

describe("computeOffset (NTP-lite)", () => {
  it("offset = serwer − środek przedziału lokalnego", () => {
    // lokalnie t0=1000, t1=1100 → środek 1050; serwer odczytał 2050 → offset +1000
    expect(computeOffset([{ t0: 1000, t1: 1100, serverMs: 2050 }])).toBe(1000);
  });

  it("wybiera próbkę o najmniejszym RTT (najdokładniejszą)", () => {
    const samples = [
      { t0: 0, t1: 1000, serverMs: 3000 },   // RTT 1000, offset 3000-500 = 2500 (szum)
      { t0: 0, t1: 20,   serverMs: 1010 },   // RTT 20,   offset 1010-10  = 1000 (dobre)
      { t0: 0, t1: 600,  serverMs: 2200 },   // RTT 600
    ];
    expect(computeOffset(samples)).toBe(1000);
  });

  it("zegary zgodne → offset ~0", () => {
    expect(computeOffset([{ t0: 5000, t1: 5040, serverMs: 5020 }])).toBe(0);
  });

  it("ujemny offset gdy lokalny zegar spieszy", () => {
    // lokalny środek 10050, serwer 10000 → offset −50
    expect(computeOffset([{ t0: 10000, t1: 10100, serverMs: 10000 }])).toBe(-50);
  });

  it("pomija niepoprawne próbki i zwraca 0 dla pustych", () => {
    expect(computeOffset([])).toBe(0);
    expect(computeOffset([{ t0: 0, t1: 10, serverMs: null }])).toBe(0);
    expect(computeOffset([{ t0: 0, t1: 10, serverMs: undefined }, { t0: 0, t1: 10, serverMs: 1005 }])).toBe(1000);
  });
});

describe("computeOffset — filtr pasma min-RTT + mediana", () => {
  it("mediana w paśmie odrzuca pojedynczą przekłamaną próbkę", () => {
    const samples = [
      { t0: 0, t1: 20, serverMs: 1010 },    // RTT 20, offset 1000
      { t0: 0, t1: 22, serverMs: 1013 },    // RTT 22, offset 1002
      { t0: 0, t1: 25, serverMs: 5012.5 },  // RTT 25, offset 5000 (przekłamana)
    ];
    expect(computeOffset(samples)).toBe(1002);
  });

  it("parzysta liczba próbek → średnia dwóch środkowych", () => {
    const samples = [
      { t0: 0, t1: 20, serverMs: 1010 },    // offset 1000
      { t0: 0, t1: 24, serverMs: 1016 },    // offset 1004
    ];
    expect(computeOffset(samples)).toBe(1002);
  });
});

describe("addClockSample — próbki z odpowiedzi snapshotu", () => {
  it("pojedyncza próbka ustawia offset i synced", () => {
    addClockSample({ t0: 0, t1: 20, serverMs: 1010 });
    expect(getClockOffset()).toBe(1000);
    expect(isClockSynced()).toBe(true);
  });

  it("ignoruje próbki bez liczbowego serverMs", () => {
    const before = getClockOffset();
    addClockSample({ t0: 0, t1: 5, serverMs: null });
    addClockSample(null);
    addClockSample({ t0: 0, t1: 5, serverMs: NaN });
    expect(getClockOffset()).toBe(before);
  });

  it("bufor trzyma max 8 najnowszych próbek", () => {
    // próbka o RTT 1 dominuje pasmo (offset 5000), dopóki jest w buforze
    addClockSample({ t0: 0, t1: 1, serverMs: 5000.5 });
    expect(getClockOffset()).toBe(5000);
    for (let i = 0; i < 7; i++) addClockSample({ t0: 0, t1: 20, serverMs: 1010 });
    expect(getClockOffset()).toBe(5000); // 8 próbek — wciąż w buforze
    addClockSample({ t0: 0, t1: 20, serverMs: 1010 });
    expect(getClockOffset()).toBe(1000); // 9. próbka wypycha najstarszą
  });
});
