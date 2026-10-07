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

  it("Ranking: nagłówek i wiersz z czasem (format 0.000) i naruszeniami (0 bez wpisu)", () => {
    const r = sheets[0].rows;
    expect(r[0]).toEqual(["Miejsce", "Kod", "Imię i nazwisko", "Miasto", "Poprawne", "Pytań", "Skuteczność %", "Śr. czas (s)", "Naruszenia"]);
    expect(r[1]).toEqual([1, "A1", "Jan Kowalski", "Kraków", 2, 3, 66.7, { v: 12, fmt: "0.000" }, 0]);
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
    expect(avg[1]).toEqual({ v: 12, fmt: "0.000" });
  });

  it("karta uczestnika: bez violations → trzy wiersze naruszeń z zerami po „Bez odpowiedzi”", () => {
    const card = sheets[2].rows;
    const i = card.findIndex((x) => x[0] === "Bez odpowiedzi");
    expect(card.slice(i + 1, i + 4)).toEqual([
      ["Naruszenia łącznie", 0],
      ["Wyjście z aplikacji / wygaszenie ekranu", 0],
      ["Próba zrzutu ekranu", 0],
    ]);
  });

  it('czasy odpowiedzi w tabelach: { v, fmt: "0.000" }', () => {
    const f = sheets[1].rows;
    const col = f[0].indexOf("Czas (s)");
    expect(f[1][col]).toEqual({ v: 5, fmt: "0.000" });
    const q1 = sheets[2].rows.find((x) => x[0] === 1 && x[2] === "Pytanie 1");
    expect(q1.at(-1)).toEqual({ v: 5, fmt: "0.000" });
  });

  it("brak czasu → pusta komórka (nie obiekt)", () => {
    const s = buildResultsSheets({
      results: [{ code: "C3", name: "X", city: "Kraków", correct: 0, total: 0, avgResponseTime: null }],
      rows: [row("C3", "X", 1, "", false, null)],
      city: "Kraków",
    });
    expect(s[0].rows[1][7]).toBe("");
    expect(s[1].rows[1].at(-1)).toBe("");
  });

  it("buildXlsxBytes z arkuszy wyników daje archiwum ZIP", () => {
    const b = buildXlsxBytes(sheets);
    expect(b).toBeInstanceOf(Uint8Array);
    expect([b[0], b[1]]).toEqual([0x50, 0x4b]);
  });
});

describe("buildResultsSheets z naruszeniami", () => {
  const violations = new Map([["A1", { total: 4, tab_switch: 3, screenshot_attempt: 1 }]]);
  const sheets = buildResultsSheets({ results, rows, city: "Kraków", violations });

  it("Ranking: ostatnia kolumna = total; uczestnik bez wpisu → 0 (liczba)", () => {
    const r = sheets[0].rows;
    expect(r[0].at(-1)).toBe("Naruszenia");
    expect(r[1].at(-1)).toBe(4);
    expect(r[2].at(-1)).toBe(0);
  });

  it("karta: łącznie, wyjście z aplikacji, zrzut ekranu — kolejno po „Bez odpowiedzi”", () => {
    const card = sheets[2].rows;
    const i = card.findIndex((x) => x[0] === "Bez odpowiedzi");
    expect(card.slice(i + 1, i + 4)).toEqual([
      ["Naruszenia łącznie", 4],
      ["Wyjście z aplikacji / wygaszenie ekranu", 3],
      ["Próba zrzutu ekranu", 1],
    ]);
    expect(sheets[3].rows).toContainEqual(["Naruszenia łącznie", 0]);
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
  it("ms → sekundy z 3 miejscami po przecinku; null → pusty", () => {
    // Świadoma zmiana (261007-ihg, pkt 9): dotąd 2 miejsca (12.35), wcześniej 1 (12.3).
    expect(secs(12345)).toBe(12.345);
    expect(secs(0)).toBe(0);
    expect(secs(null)).toBe("");
  });
});
