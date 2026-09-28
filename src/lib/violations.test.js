import { describe, it, expect } from "vitest";
import { VIOLATION_LABELS, summarizeViolations, violationsFor } from "./violations.js";

describe("VIOLATION_LABELS", () => {
  it("etykiety typów naruszeń", () => {
    expect(VIOLATION_LABELS.tab_switch).toBe("Wyjście z aplikacji / wygaszenie ekranu");
    expect(VIOLATION_LABELS.screenshot_attempt).toBe("Próba zrzutu ekranu");
  });
});

describe("summarizeViolations", () => {
  it("nowe wiersze z type_count: total = max(count), per typ = max(type_count)", () => {
    const m = summarizeViolations([
      { participant_code: "KRK-1", type: "tab_switch", count: 1, type_count: 1 },
      { participant_code: "KRK-1", type: "tab_switch", count: 3, type_count: 3 },
      { participant_code: "KRK-1", type: "screenshot_attempt", count: 4, type_count: 1 },
    ]);
    expect(m.get("KRK-1")).toEqual({ total: 4, tab_switch: 3, screenshot_attempt: 1 });
  });

  it("stare wiersze bez type_count: per typ = liczba wierszy", () => {
    const m = summarizeViolations([
      { participant_code: "KRK-2", type: "tab_switch", count: 1 },
      { participant_code: "KRK-2", type: "tab_switch", count: 2, type_count: null },
    ]);
    expect(m.get("KRK-2")).toEqual({ total: 2, tab_switch: 2, screenshot_attempt: 0 });
  });

  it("klucze camelCase z trybu DEMO", () => {
    const m = summarizeViolations([
      { participantCode: "WAR-1", sessionId: "s", type: "screenshot_attempt", count: 1, typeCount: 1 },
      { participantCode: "WAR-1", sessionId: "s", type: "tab_switch", count: 2, typeCount: 1 },
    ]);
    expect(m.get("WAR-1")).toEqual({ total: 2, tab_switch: 1, screenshot_attempt: 1 });
  });

  it("total nigdy mniejszy niż suma per typ", () => {
    const m = summarizeViolations([
      { participant_code: "KRK-3", type: "tab_switch", count: 1, type_count: 5 },
      { participant_code: "KRK-3", type: "screenshot_attempt", count: 2, type_count: 2 },
    ]);
    expect(m.get("KRK-3")).toEqual({ total: 7, tab_switch: 5, screenshot_attempt: 2 });
  });

  it("wiele kodów rozdzielnie; wynik bez pól pomocniczych", () => {
    const m = summarizeViolations([
      { participant_code: "A", type: "tab_switch", count: 1, type_count: 1 },
      { participant_code: "B", type: "screenshot_attempt", count: 1, type_count: 1 },
    ]);
    expect(m.size).toBe(2);
    expect(Object.keys(m.get("A")).sort()).toEqual(["screenshot_attempt", "tab_switch", "total"]);
    expect(m.get("B")).toEqual({ total: 1, tab_switch: 0, screenshot_attempt: 1 });
  });

  it("null / pusta lista → pusta Map", () => {
    expect(summarizeViolations(null)).toBeInstanceOf(Map);
    expect(summarizeViolations(null).size).toBe(0);
    expect(summarizeViolations([]).size).toBe(0);
  });
});

describe("violationsFor", () => {
  it("brak kodu → zera", () => {
    const m = summarizeViolations([]);
    expect(violationsFor(m, "BRAK")).toEqual({ total: 0, tab_switch: 0, screenshot_attempt: 0 });
    expect(violationsFor(null, "BRAK")).toEqual({ total: 0, tab_switch: 0, screenshot_attempt: 0 });
  });
  it("zwraca kopię wpisu", () => {
    const m = summarizeViolations([{ participant_code: "A", type: "tab_switch", count: 2, type_count: 2 }]);
    const v = violationsFor(m, "A");
    expect(v).toEqual({ total: 2, tab_switch: 2, screenshot_attempt: 0 });
    v.total = 99;
    expect(m.get("A").total).toBe(2);
  });
});
