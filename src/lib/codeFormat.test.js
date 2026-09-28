import { describe, it, expect } from "vitest";
import {
  CITY_PREFIX,
  CODE_RE,
  formatCodeInput,
  normalizeParticipantCode,
  parseCodesCsv,
  pickFreeNumbers,
  assignNumbers,
  takenNumbersFromCodes,
  joinLines,
} from "./codeFormat.js";

const OPTS = { prefix: "KRK", city: "Kraków" };

describe("CITY_PREFIX / CODE_RE", () => {
  it("prefiksy miast bez zmian (Warszawa = WAR)", () => {
    expect(CITY_PREFIX).toEqual({ Kraków: "KRK", Warszawa: "WAR", Poznań: "POZ", Wrocław: "WRO", Katowice: "KAT" });
  });
  it("CODE_RE przyjmuje 4 i 6 cyfr, odrzuca inne długości", () => {
    expect(CODE_RE.test("KRK-1111")).toBe(true);
    expect(CODE_RE.test("KRK-482910")).toBe(true);
    expect(CODE_RE.test("KRK-11111")).toBe(false);
    expect(CODE_RE.test("KRK-111")).toBe(false);
  });
});

describe("formatCodeInput", () => {
  it("wielkie litery i myślnik po 3 literach", () => {
    expect(formatCodeInput("k", "")).toBe("K");
    expect(formatCodeInput("kr", "k")).toBe("KR");
    expect(formatCodeInput("krk", "kr")).toBe("KRK-");
  });
  it("backspace na myślniku nie dopisuje go z powrotem", () => {
    expect(formatCodeInput("KRK", "KRK-")).toBe("KRK");
    expect(formatCodeInput("KRK-1", "KRK-")).toBe("KRK-1");
  });
  it("normalizuje wklejenie", () => {
    expect(formatCodeInput("krk1111", "")).toBe("KRK-1111");
    expect(formatCodeInput("KRK 1111", "")).toBe("KRK-1111");
    expect(formatCodeInput("krk-1111", "")).toBe("KRK-1111");
  });
  it("przyjmuje 6 cyfr i obcina nadmiar do 6", () => {
    expect(formatCodeInput("KRK-482910", "")).toBe("KRK-482910");
    expect(formatCodeInput("KRK-12345678", "")).toBe("KRK-123456");
  });
  it("cyfra przed 3 literami jest odrzucana", () => {
    expect(formatCodeInput("K1", "")).toBe("K");
  });
  it("puste / null nie wysypuje", () => {
    expect(formatCodeInput("", "")).toBe("");
    expect(formatCodeInput(null)).toBe("");
  });
});

describe("normalizeParticipantCode", () => {
  it("zwraca znormalizowany kod albo null", () => {
    expect(normalizeParticipantCode("krk1111")).toBe("KRK-1111");
    expect(normalizeParticipantCode("KRK-111")).toBe(null);
    expect(normalizeParticipantCode("KRK-12a4")).toBe(null);
    expect(normalizeParticipantCode("KRK-482910")).toBe("KRK-482910");
    expect(normalizeParticipantCode("  war 0042 ")).toBe("WAR-0042");
  });
});

describe("parseCodesCsv", () => {
  it("BOM + nagłówek + jeden wiersz", () => {
    const r = parseCodesCsv("﻿Imię;Nazwisko;Kod\nJan;Kowalski;1111\n", OPTS);
    expect(r.valid).toEqual([{ line: 2, name: "Jan", surname: "Kowalski", number: "1111" }]);
    expect(r.errors).toEqual([]);
  });
  it("separator przecinek, nagłówek bez ogonka, puste linie z fizyczną numeracją", () => {
    const r = parseCodesCsv("imie,nazwisko,kod\r\n\r\nJan,Kowalski,1111\r\n", OPTS);
    expect(r.valid).toEqual([{ line: 3, name: "Jan", surname: "Kowalski", number: "1111" }]);
    expect(r.errors).toEqual([]);
  });
  it("plik bez nagłówka — pierwszy wiersz to dane", () => {
    const r = parseCodesCsv("Jan;Kowalski;1111", OPTS);
    expect(r.valid).toEqual([{ line: 1, name: "Jan", surname: "Kowalski", number: "1111" }]);
  });
  it("postacie kodu: =\"0042\", KRK-0042, krk0042, cudzysłowy", () => {
    const r = parseCodesCsv(
      "Imię;Nazwisko;Kod\nAnna;Nowak;=\"0042\"\nOla;Lis;KRK-0043\nEwa;Kot;krk0044\n\"Jan\";\"Mak\";\"0045\"",
      OPTS,
    );
    expect(r.errors).toEqual([]);
    expect(r.valid.map((v) => v.number)).toEqual(["0042", "0043", "0044", "0045"]);
    expect(r.valid[3].name).toBe("Jan");
    expect(r.valid[3].surname).toBe("Mak");
  });
  it("puste pole kodu → number null (losowy)", () => {
    const r = parseCodesCsv("Imię;Nazwisko;Kod\nPiotr;Wiśniewski;\nAdam;Nowak", OPTS);
    expect(r.valid).toEqual([
      { line: 2, name: "Piotr", surname: "Wiśniewski", number: null },
      { line: 3, name: "Adam", surname: "Nowak", number: null },
    ]);
  });
  it("za mało cyfr → błąd z podpowiedzią o Excelu", () => {
    const r = parseCodesCsv("Imię;Nazwisko;Kod\nJan;Kowalski;111", OPTS);
    expect(r.valid).toEqual([]);
    expect(r.errors).toEqual([{
      line: 2,
      name: "Jan Kowalski",
      reason: "kod „111” musi mieć 4 cyfry — jeśli w Excelu zniknęły zera z przodu, sformatuj kolumnę Kod jako Tekst",
    }]);
  });
  it("nie-cyfry → błąd bez dopisku o Excelu", () => {
    const r = parseCodesCsv("Imię;Nazwisko;Kod\nJan;Kowalski;12a4", OPTS);
    expect(r.errors[0].reason).toBe("kod „12a4” musi mieć 4 cyfry");
  });
  it("6 cyfr w imporcie → błąd (nowe kody są 4-cyfrowe)", () => {
    const r = parseCodesCsv("Jan;Kowalski;482910", OPTS);
    expect(r.errors[0].reason).toBe("kod „482910” musi mieć 4 cyfry");
  });
  it("kod innego miasta", () => {
    const r = parseCodesCsv("Imię;Nazwisko;Kod\nJan;Kowalski;WAR-1111", OPTS);
    expect(r.errors).toEqual([{ line: 2, name: "Jan Kowalski", reason: "kod WAR-1111 należy do innego miasta" }]);
  });
  it("brak imienia lub nazwiska", () => {
    const r = parseCodesCsv("Imię;Nazwisko;Kod\n;Kowalski;1111\nJan;;", OPTS);
    expect(r.valid).toEqual([]);
    expect(r.errors).toEqual([
      { line: 2, name: "Kowalski", reason: "brak imienia lub nazwiska" },
      { line: 3, name: "Jan", reason: "brak imienia lub nazwiska" },
    ]);
  });
  it("duplikat w pliku — oba wiersze w błędach", () => {
    const r = parseCodesCsv(
      "Imię;Nazwisko;Kod\nJan;Kowalski;1111\nAnna;Nowak;2222\nOla;Lis;\nEwa;Kot;1111",
      OPTS,
    );
    expect(r.valid.map((v) => v.line)).toEqual([3, 4]);
    expect(r.errors).toEqual([
      { line: 2, name: "Jan Kowalski", reason: "kod KRK-1111 powtarza się w pliku (wiersze 2 i 5)" },
      { line: 5, name: "Ewa Kot", reason: "kod KRK-1111 powtarza się w pliku (wiersze 2 i 5)" },
    ]);
  });
  it("numer zajęty w mieście", () => {
    const r = parseCodesCsv("Imię;Nazwisko;Kod\nJan;Kowalski;1111", { ...OPTS, takenNumbers: new Set(["1111"]) });
    expect(r.errors).toEqual([{ line: 2, name: "Jan Kowalski", reason: "kod KRK-1111 jest już zajęty w mieście Kraków" }]);
  });
  it("błędy posortowane po numerze linii", () => {
    const r = parseCodesCsv(
      "Imię;Nazwisko;Kod\nJan;Kowalski;1111\n;X;\nEwa;Kot;1111\nAla;Ma;WAR-0001",
      OPTS,
    );
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
  });
});

describe("pickFreeNumbers / assignNumbers", () => {
  it("wybiera jedyne wolne numery", () => {
    const taken = new Set();
    for (let i = 0; i < 10000; i++) taken.add(String(i).padStart(4, "0"));
    taken.delete("0007");
    taken.delete("9999");
    expect(pickFreeNumbers(2, taken).sort()).toEqual(["0007", "9999"]);
    expect(pickFreeNumbers(5, taken).sort()).toEqual(["0007", "9999"]);
  });
  it("różne 4-cyfrowe numery", () => {
    const got = pickFreeNumbers(3, new Set());
    expect(got).toHaveLength(3);
    expect(new Set(got).size).toBe(3);
    for (const n of got) expect(n).toMatch(/^\d{4}$/);
  });
  it("deterministyczne z własnym rng", () => {
    const rng = () => 0;
    expect(pickFreeNumbers(2, new Set(["0000"]), rng)).toEqual(["0001", "0002"]);
  });
  it("assignNumbers nie używa numerów zajętych ani z pliku", () => {
    const taken = new Set();
    for (let i = 0; i < 10000; i++) taken.add(String(i).padStart(4, "0"));
    ["0001", "0002", "0003"].forEach((n) => taken.delete(n));
    const valid = [
      { line: 2, name: "A", surname: "B", number: "0001" },
      { line: 3, name: "C", surname: "D", number: null },
      { line: 4, name: "E", surname: "F", number: null },
    ];
    const out = assignNumbers(valid, taken);
    expect(out[0]).toEqual({ line: 2, name: "A", surname: "B", number: "0001" });
    expect([out[1].number, out[2].number].sort()).toEqual(["0002", "0003"]);
    expect(out[1].random).toBe(true);
    expect(out[2].random).toBe(true);
    expect(valid[1].number).toBe(null); // bez mutacji wejścia
  });
});

describe("takenNumbersFromCodes / joinLines", () => {
  it("tylko 4-cyfrowe kody z danym prefiksem", () => {
    const s = takenNumbersFromCodes([{ code: "KRK-1111" }, { code: "KRK-482910" }, { code: "WAR-2222" }], "KRK");
    expect(s).toEqual(new Set(["1111"]));
    expect(takenNumbersFromCodes(null, "KRK")).toEqual(new Set());
  });
  it("łączy numery wierszy po polsku", () => {
    expect(joinLines([2, 5])).toBe("2 i 5");
    expect(joinLines([2, 5, 7])).toBe("2, 5 i 7");
    expect(joinLines([3])).toBe("3");
  });
});
