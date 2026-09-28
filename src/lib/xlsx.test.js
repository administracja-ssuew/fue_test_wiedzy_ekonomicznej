import { describe, it, expect } from "vitest";
import { buildXlsxBytes, safeSheetName } from "./xlsx.js";

describe("safeSheetName", () => {
  it("przycina do limitu Excela (31 znaków)", () => {
    const n = safeSheetName("Bardzo Długie Imię I Nazwisko Uczestnika Testu", new Set());
    expect(n.length).toBeLessThanOrEqual(31);
  });
  it("usuwa znaki zakazane przez Excela", () => {
    const n = safeSheetName("Jan [Kowalski] / *?:\\", new Set());
    expect(n).not.toMatch(/[[\]:*?/\\]/);
  });
  it("deduplikuje — duplikat nazwy uniemożliwia otwarcie pliku", () => {
    const used = new Set();
    const names = [1, 2, 3].map(() => safeSheetName("Jan Kowalski", used));
    expect(new Set(names).size).toBe(3);
    expect(names.every((n) => n.length <= 31)).toBe(true);
  });
  it("deduplikuje też po przycięciu, gdy długie imiona mają wspólny prefiks", () => {
    const used = new Set();
    const long = "Aleksandra Konstantynopolitańczykowianeczka Nowak";
    const a = safeSheetName(long, used);
    const b = safeSheetName(long, used);
    expect(a).not.toBe(b);
    expect(b.length).toBeLessThanOrEqual(31);
  });
  it("pusta nazwa dostaje sensowny fallback", () => {
    expect(safeSheetName("", new Set())).toBeTruthy();
    expect(safeSheetName(null, new Set())).toBeTruthy();
  });
});

describe("buildXlsxBytes", () => {
  const text = (sheets) => new TextDecoder().decode(buildXlsxBytes(sheets));

  it("produkuje archiwum ZIP (sygnatura PK\\x03\\x04)", () => {
    const b = buildXlsxBytes([{ name: "Test", rows: [["a", 1]] }]);
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("kończy się rekordem EOCD z poprawną liczbą wpisów", () => {
    const b = buildXlsxBytes([{ name: "A", rows: [["x"]] }, { name: "B", rows: [["y"]] }]);
    const eocd = b.length - 22; // brak komentarza archiwum → EOCD ma stałe 22 bajty
    expect([b[eocd], b[eocd + 1], b[eocd + 2], b[eocd + 3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    const entries = b[eocd + 10] | (b[eocd + 11] << 8);
    expect(entries).toBe(8); // 4 stałe + styles + 2 arkusze + sharedStrings
  });

  it("zawiera wszystkie wymagane części pakietu OPC", () => {
    const t = text([{ name: "Test", rows: [["a"]] }]);
    for (const part of [
      "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/sharedStrings.xml", "xl/styles.xml",
    ]) expect(t).toContain(part);
  });

  it("escapuje znaki specjalne XML", () => {
    const t = text([{ name: "T", rows: [['<b>"x" & y']] }]);
    expect(t).toContain("&lt;b&gt;");
    expect(t).toContain("&amp;");
    expect(t).not.toContain("<b>");
  });

  it("wycina znaki sterujące — treści pytań bywają wklejane z Worda/PDF-a", () => {
    // XML 1.0 nie dopuszcza U+0001, U+000B, U+001F itd. Jeden taki bajt sprawia,
    // że Excel odmawia otwarcia CAŁEGO skoroszytu — nie tylko jednej komórki.
    const CTRL = [1, 11, 31].map((c) => String.fromCharCode(c));
    const dirty = `PKB${CTRL[0]} realne${CTRL[1]} w${CTRL[2]}roku`;
    const t = text([{ name: "T", rows: [[dirty]] }]);
    expect(t).toContain("PKB realne wroku");
    // Sprawdzamy WYŁĄCZNIE ładunek XML: nagłówki ZIP-a (CRC, długości, offsety) to
    // dowolne bajty i naturalnie zawierają wartości sterujące — skanowanie całego
    // archiwum jako tekstu dałoby fałszywy alarm.
    const sst = t.slice(t.indexOf("<sst"), t.indexOf("</sst>"));
    for (const bad of CTRL) expect(sst).not.toContain(bad);
  });

  it("deduplikuje powtarzalne treści przez sharedStrings", () => {
    // Sens: treść pytania powtarza się w arkuszu KAŻDEGO uczestnika. Bez dedupu
    // plik dla 500 osób × 58 pytań rósłby liniowo z liczbą uczestników.
    const q = "Bardzo długa treść pytania powtórzona w wielu arkuszach uczestników";
    const sheets = Array.from({ length: 40 }, (_, i) => ({ name: `U${i}`, rows: [[q]] }));
    const occurrences = text(sheets).split(q).length - 1;
    expect(occurrences).toBe(1);
  });

  it("liczby zapisuje jako liczby, nie jako tekst", () => {
    const t = text([{ name: "T", rows: [[42]] }]);
    expect(t).toContain("<v>42</v>");
    expect(t).not.toContain('t="s"><v>0</v>');
  });

  it("pomija puste komórki zamiast zapisywać puste stringi", () => {
    const t = text([{ name: "T", rows: [["a", null, "", undefined, "b"]] }]);
    expect(t).toContain('r="A1"');
    expect(t).toContain('r="E1"');
    expect(t).not.toContain('r="B1"');
  });

  it("styles.xml: cellXfs [0 ogólny, 1 numFmtId=2 (0.00)] + override i relacja", () => {
    const t = text([{ name: "T", rows: [["a"]] }]);
    const styles = t.slice(t.indexOf("<styleSheet"), t.indexOf("</styleSheet>"));
    expect(styles).toContain('<cellXfs count="2">');
    expect(styles).toContain('numFmtId="2"');
    expect(styles).toContain('applyNumberFormat="1"');
    expect(t).toContain('<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>');
    expect(t).toMatch(/<Relationship Id="rId\d+" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/styles" Target="styles\.xml"\/>/);
  });

  it("relacje workbook.xml.rels mają unikalne Id (arkusze, sharedStrings, styles)", () => {
    const t = text([{ name: "A", rows: [["x"]] }, { name: "B", rows: [["y"]] }]);
    const start = t.indexOf("<Relationships", t.indexOf("xl/_rels/workbook.xml.rels"));
    const block = t.slice(start, t.indexOf("</Relationships>", start));
    const ids = [...block.matchAll(/Id="(rId\d+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["rId1", "rId2", "rId3", "rId4"]);
  });

  it('komórka { v, fmt: "0.00" } → s="1"; liczba bez fmt → bez atrybutu s', () => {
    const t = text([{ name: "T", rows: [[{ v: 12.35, fmt: "0.00" }, 7]] }]);
    expect(t).toContain('<c r="A1" s="1"><v>12.35</v></c>');
    expect(t).toContain('<c r="B1"><v>7</v></c>');
  });

  it("obiekt komórki z pustą wartością → brak komórki", () => {
    const t = text([{ name: "T", rows: [["a", { v: "", fmt: "0.00" }, { v: null, fmt: "0.00" }, "b"]] }]);
    expect(t).not.toContain('r="B1"');
    expect(t).not.toContain('r="C1"');
    expect(t).toContain('r="D1"');
  });
});
