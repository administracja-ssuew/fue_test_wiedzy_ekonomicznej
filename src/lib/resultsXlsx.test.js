import { describe, it, expect } from "vitest";
import { buildResultsSheets, resultsFileName, secs } from "./resultsXlsx.js";
import { buildXlsxBytes } from "./xlsx.js";

// Fixture: 2 uczestników × 3 pytania z planu. A1 nie odpowiedział na pytanie 3
// (brak wiersza w answers → get_session_detailed_results zwraca pusty wybór,
// isCorrect false i pełny czas pytania — 20 s).
const row = (code, name, qNo, chosenLabel, isCorrect, responseTimeMs) => ({
  participantCode: code, participantName: name, city: "Kraków",
  qNo, module: 1, moduleName: "Obliczenia", question: `Pytanie ${qNo}`,
  chosenLabel, chosenText: chosenLabel ? `Odp. ${chosenLabel}` : "",
  correctLabel: "A", correctText: "Odp. A", isCorrect, responseTimeMs,
});

const rows = [
  row("A1", "Jan Kowalski", 1, "A", true, 5000),
  row("A1", "Jan Kowalski", 2, "A", true, 11000),
  row("A1", "Jan Kowalski", 3, "", false, 20000),
  row("B2", "Anna Nowak", 1, "B", false, 8000),
  row("B2", "Anna Nowak", 2, "A", true, 9000),
  row("B2", "Anna Nowak", 3, "A", true, 10000),
];

const results = [
  { code: "A1", name: "Jan Kowalski", city: "Kraków", correct: 2, total: 3, avgResponseTime: 12000 },
  { code: "B2", name: "Anna Nowak", city: "Kraków", correct: 2, total: 3, avgResponseTime: 9000 },
];

describe("buildResultsSheets", () => {
  const sheets = buildResultsSheets({ results, rows, city: "Kraków" });

  it("arkusze: Ranking, Wszystkie odpowiedzi, potem po jednym na uczestnika (kolejność z rows)", () => {
    expect(sheets.map((s) => s.name)).toEqual(["Ranking", "Wszystkie odpowiedzi", "Jan Kowalski A1", "Anna Nowak B2"]);
  });

  it("Ranking: nagłówek i wiersz z czasem w sekundach", () => {
    const r = sheets[0].rows;
    expect(r[0]).toEqual(["Miejsce", "Kod", "Imię i nazwisko", "Miasto", "Poprawne", "Pytań", "Skuteczność %", "Śr. czas (s)"]);
    expect(r[1]).toEqual([1, "A1", "Jan Kowalski", "Kraków", 2, 3, 66.7, 12]);
    expect(r).toHaveLength(3);
  });

  it("Wszystkie odpowiedzi: nagłówek + wiersz na każdy element rows; Trafione TAK/NIE/brak odp.", () => {
    const f = sheets[1].rows;
    expect(f).toHaveLength(1 + rows.length);
    const col = f[0].indexOf("Trafione");
    expect(col).toBeGreaterThanOrEqual(0);
    expect(f.slice(1).map((r) => r[col])).toEqual(["TAK", "TAK", "brak odp.", "NIE", "TAK", "TAK"]);
  });

  it("karta uczestnika: poprawne z N, bez odpowiedzi, wiersz braku odpowiedzi", () => {
    const card = sheets[2].rows;
    expect(card).toContainEqual(["Poprawne odpowiedzi", 2, "z 3"]);
    expect(card).toContainEqual(["Bez odpowiedzi", 1]);
    const q3 = card.find((r) => r[0] === 3 && r[2] === "Pytanie 3");
    expect(q3).toContain("— brak odpowiedzi");
  });

  it("karta uczestnika: średni czas liczy brak odpowiedzi jako pełny czas pytania (G6)", () => {
    const avg = sheets[2].rows.find((r) => r[0] === "Średni czas odpowiedzi (s)");
    // (5 + 11 + 20) / 3 = 12 s — spójnie z get_session_results
    expect(avg[1]).toBe(12);
  });

  it("buildXlsxBytes z arkuszy wyników daje archiwum ZIP", () => {
    const b = buildXlsxBytes(sheets);
    expect(b).toBeInstanceOf(Uint8Array);
    expect([b[0], b[1]]).toEqual([0x50, 0x4b]);
  });
});

describe("resultsFileName", () => {
  it("z nazwą sesji — slug bez polskich znaków", () => {
    expect(resultsFileName({ city: "Kraków", dateIso: "2026-10-28T09:00:00Z", name: "TWE finał" }))
      .toBe("wyniki_Kraków_2026-10-28_TWE-final.xlsx");
  });
  it("bez nazwy sesji", () => {
    expect(resultsFileName({ city: "Kraków", dateIso: "2026-10-28T09:00:00Z" })).toBe("wyniki_Kraków_2026-10-28.xlsx");
  });
  it("slug: ł → l, brzegowe myślniki obcięte, maks. 40 znaków", () => {
    const n = resultsFileName({ city: "Łódź", dateIso: "2026-10-28", name: "  Łódzki etap — próba!  " + "x".repeat(60) });
    const slug = n.replace("wyniki_Łódź_2026-10-28_", "").replace(".xlsx", "");
    expect(slug.startsWith("Lodzki-etap-proba-")).toBe(true);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).not.toMatch(/^-|-$/);
  });
});

describe("secs", () => {
  it("ms → sekundy z 1 miejscem po przecinku; null → pusty", () => {
    expect(secs(12345)).toBe(12.3);
    expect(secs(null)).toBe("");
  });
});
