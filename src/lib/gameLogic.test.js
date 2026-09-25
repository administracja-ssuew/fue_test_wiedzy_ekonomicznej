import { describe, it, expect } from "vitest";
import { cityInfo, REVEAL_SECONDS,
  shouldEndEarly, earlySkipFloorSeconds, ANSWER_PLATEAU_MS, AUTO_SKIP_MIN_TPQ } from "./gameLogic.js";

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

  it("plateau wymaga dluzszej ciszy niz dawne 8 s", () => {
    const q = { ...base, total: 60, expected: 500, issued: 500, elapsedS: 50 };
    expect(shouldEndEarly({ ...q, sinceLastAnswerMs: 8000 })).toBe(false);
    expect(shouldEndEarly({ ...q, sinceLastAnswerMs: ANSWER_PLATEAU_MS })).toBe(true);
  });

  it("podłoga skaluje się z czasem modułu, ale nie schodzi poniżej 20 s", () => {
    expect(earlySkipFloorSeconds(90)).toBe(54);
    expect(earlySkipFloorSeconds(60)).toBe(36);
    expect(earlySkipFloorSeconds(30)).toBe(18);
    expect(earlySkipFloorSeconds(20)).toBe(12);
    expect(earlySkipFloorSeconds(5)).toBe(8);
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

describe("AUTO_SKIP_MIN_TPQ — auto-skrót wyłączony przy krótkich pytaniach", () => {
  // Docelowy format TWE to pytania do 20 s. Pomiar: skrót oszczędza tam 2-3 s,
  // więc nie warto go ryzykować. Prowadzący ma ręczny przycisk niezależnie.
  const all = { total: 500, expected: 500, issued: 500, elapsedS: 19, timePerQ: 20, sinceLastAnswerMs: 0 };

  it("pytanie 20 s NIE jest skracane automatycznie, nawet gdy wszyscy odpowiedzieli", () => {
    expect(shouldEndEarly(all)).toBe(false);
  });

  it("pytanie 90 s nadal korzysta ze skrótu po podłodze", () => {
    expect(shouldEndEarly({ ...all, timePerQ: 90, elapsedS: earlySkipFloorSeconds(90) })).toBe(true);
  });

  it("próg jest dokładnie na granicy 45 s", () => {
    const at = { ...all, timePerQ: AUTO_SKIP_MIN_TPQ, elapsedS: earlySkipFloorSeconds(AUTO_SKIP_MIN_TPQ) };
    expect(shouldEndEarly(at)).toBe(true);
    expect(shouldEndEarly({ ...at, timePerQ: AUTO_SKIP_MIN_TPQ - 1 })).toBe(false);
  });
});
