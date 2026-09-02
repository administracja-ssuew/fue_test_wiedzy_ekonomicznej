// ─── Minimalny zapis .xlsx (bez zależności) ──────────────────────────────────
//
// Dlaczego własny zamiast SheetJS: paczka `xlsx` z npm (0.18.5) ma dwa otwarte
// advisory o wysokiej wadze (prototype pollution, ReDoS) i NIE ma na npm wersji
// z poprawką — SheetJS przeniósł wydania na własny CDN. Wnoszenie tego do projektu,
// który przechodzi audyt bezpieczeństwa, byłoby długiem nie do spłacenia jednym
// `npm audit fix`. Do tego waży ~800 kB, a my potrzebujemy ułamka jego możliwości:
// tylko ZAPIS, nigdy odczyt (oba advisory dotyczą parsowania cudzych plików).
//
// Plik .xlsx to ZIP z kilkoma XML-ami. Zapisujemy wpisy metodą "stored" (bez
// kompresji), bo deflate wymagałby prawdziwego kompresora — a rozmiar i tak
// trzymają w ryzach sharedStrings: treść pytania powtarza się w arkuszu każdego
// uczestnika, więc trafia do pliku RAZ, a komórki niosą tylko indeks liczbowy.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const enc = new TextEncoder();
const bytes = (s) => enc.encode(s);

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    // XML 1.0 nie dopuszcza znaków sterujących, a treści pytań bywają wklejane
    // z Worda/PDF-a i potrafią je nieść — jeden taki bajt psuje cały plik.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

// 0 → "A", 25 → "Z", 26 → "AA"
function colName(i) {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

// Excel: max 31 znaków, bez [ ] : * ? / \, bez apostrofu na brzegach, nazwy unikalne.
// Imiona uczestników bywają długie i się powtarzają, więc deduplikacja jest konieczna —
// duplikat nazwy arkusza powoduje, że Excel odmawia otwarcia całego pliku.
export function safeSheetName(raw, used) {
  let base = String(raw || "Arkusz").replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31).trim();
  if (!base) base = "Arkusz";
  let name = base, i = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${i++})`;
    name = base.slice(0, 31 - suffix.length).trim() + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

function makeSharedStrings() {
  const map = new Map();
  const list = [];
  return {
    index(s) {
      let i = map.get(s);
      if (i === undefined) { i = list.length; map.set(s, i); list.push(s); }
      return i;
    },
    xml() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${list.length}" uniqueCount="${list.length}">`
        + list.map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`).join("")
        + "</sst>";
    },
  };
}

function sheetXml(rows, sst) {
  const out = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
  ];
  rows.forEach((row, r) => {
    out.push(`<row r="${r + 1}">`);
    row.forEach((v, c) => {
      if (v === null || v === undefined || v === "") return; // pusta komórka = brak <c>
      const ref = `${colName(c)}${r + 1}`;
      if (typeof v === "number" && Number.isFinite(v)) out.push(`<c r="${ref}"><v>${v}</v></c>`);
      else out.push(`<c r="${ref}" t="s"><v>${sst.index(String(v))}</v></c>`);
    });
    out.push("</row>");
  });
  out.push("</sheetData></worksheet>");
  return out.join("");
}

// ZIP (stored). Pola daty/godziny ustawiamy na 1980-01-01 — Excel ich nie używa,
// a zero w polu daty bywa odczytywane jako uszkodzony wpis.
function zip(files) {
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const DOS_TIME = 0, DOS_DATE = 0x0021;

  const local = [], central = [];
  let offset = 0;

  for (const f of files) {
    const name = bytes(f.name);
    const crc = crc32(f.data);
    const head = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length),
      ...u16(name.length), ...u16(0),
    ]);
    local.push(head, name, f.data);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ]), name);
    offset += head.length + name.length + f.data.length;
  }

  const cdOffset = offset;
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(cdOffset), ...u16(0),
  ]);

  const parts = [...local, ...central, eocd];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

/**
 * Buduje skoroszyt .xlsx jako surowe bajty. Wydzielone z buildXlsx, bo Blob w jsdom
 * nie implementuje arrayBuffer() — testy sprawdzają strukturę ZIP-a na bajtach.
 * @param {Array<{name: string, rows: Array<Array<string|number|null>>}>} sheets
 * @returns {Uint8Array}
 */
export function buildXlsxBytes(sheets) {
  const sst = makeSharedStrings();
  const used = new Set();
  const named = sheets.map((s) => ({ name: safeSheetName(s.name, used), rows: s.rows || [] }));
  // Kolejność ma znaczenie: arkusze najpierw, bo dopiero one zasilają sharedStrings.
  const sheetXmls = named.map((s) => sheetXml(s.rows, sst));
  const n = named.length;

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    + '</Types>';

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';

  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + named.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
    + '</sheets></workbook>';

  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
    + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
    + '</Relationships>';

  const files = [
    { name: "[Content_Types].xml",       data: bytes(contentTypes) },
    { name: "_rels/.rels",               data: bytes(rootRels) },
    { name: "xl/workbook.xml",           data: bytes(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: bytes(workbookRels) },
    ...sheetXmls.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: bytes(x) })),
    { name: "xl/sharedStrings.xml",      data: bytes(sst.xml()) },
  ];

  return zip(files);
}

/**
 * Buduje skoroszyt .xlsx gotowy do pobrania.
 * @param {Array<{name: string, rows: Array<Array<string|number|null>>}>} sheets
 * @returns {Blob}
 */
export function buildXlsx(sheets) {
  return new Blob([buildXlsxBytes(sheets)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
