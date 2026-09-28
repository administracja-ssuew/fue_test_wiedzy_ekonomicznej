// ─── KODY UCZESTNIKÓW: FORMAT, NORMALIZACJA, IMPORT CSV ─────────────────────────
// Decyzja użytkownika (07-CONTEXT): nowe kody są 4-cyfrowe (KRK-1111), bo łatwiej je
// podyktować i wpisać na telefonie. Zgadywanie ogranicza limit prób po stronie SQL
// (sekcja 44), a nie długość kodu. Stare kody 6-cyfrowe (KRK-482910) pozostają ważne,
// więc walidacja przyjmuje 4 albo 6 cyfr. Prefiksy miast bez zmian (Warszawa = WAR).
//
// Moduł jest czysty (bez Supabase i DOM) — logikę testuje Vitest (codeFormat.test.js),
// a supabase.js i ekrany tylko ją wołają. CITY_PREFIX ma tu jedyne źródło.

export const CITY_PREFIX = { Kraków: "KRK", Warszawa: "WAR", Poznań: "POZ", Wrocław: "WRO", Katowice: "KAT" };

export const CODE_RE = /^[A-Z]{3}-(\d{4}|\d{6})$/;

// Formatowanie pola kodu w trakcie pisania. `prev` to poprzednia wartość pola —
// pozwala rozpoznać kasowanie: backspace na automatycznie dopisanym myślniku
// („KRK-” → „KRK”) nie może dopisać go z powrotem, inaczej użytkownik utyka.
// Cyfry przed trzema literami są odrzucane; cyfr maks. 6 (stare kody).
export function formatCodeInput(raw, prev = "") {
  const up = String(raw ?? "").toUpperCase();
  const clean = up.replace(/[^A-Z0-9]/g, "");
  const [, letters, rest] = clean.match(/^([A-Z]{0,3})(.*)$/);
  const digits = rest.replace(/\D/g, "").slice(0, 6);
  if (letters.length < 3) return letters;
  const deleting = up.length < String(prev ?? "").length;
  if (!digits) return deleting ? letters : `${letters}-`;
  return `${letters}-${digits}`;
}

// Kod gotowy do wysłania albo null (zły format → bez zbędnej próby liczonej przez limiter).
export function normalizeParticipantCode(raw) {
  const f = formatCodeInput(raw);
  return CODE_RE.test(f) ? f : null;
}

// [2, 5] → "2 i 5"; [2, 5, 7] → "2, 5 i 7".
export function joinLines(nums) {
  const list = (nums || []).map(String);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} i ${list[list.length - 1]}`;
}

// Numery zajęte w mieście: tylko kody 4-cyfrowe z danym prefiksem (stare 6-cyfrowe
// nie kolidują z nowymi, bo SQL porównuje pełny tekst kodu).
export function takenNumbersFromCodes(codes, prefix) {
  const re = new RegExp(`^${prefix}-(\\d{4})$`);
  const out = new Set();
  for (const c of codes || []) {
    const m = String((typeof c === "string" ? c : c?.code) || "").match(re);
    if (m) out.add(m[1]);
  }
  return out;
}

const pad4 = (n) => String(n).padStart(4, "0");

// Losowa liczba całkowita z [0, max) — crypto.getRandomValues, awaryjnie Math.random.
function cryptoRandomInt(max) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const u = crypto.getRandomValues(new Uint32Array(1))[0];
    return Math.floor((u / 4294967296) * max);
  }
  return Math.floor(Math.random() * max);
}

// n różnych wolnych numerów „NNNN” (rozłącznych z `taken`), losowanie bez zwracania
// (częściowy Fisher–Yates). Gdy wolnych jest mniej niż n — zwraca tyle, ile jest.
// rng(max) → liczba całkowita z [0, max).
export function pickFreeNumbers(n, taken, rng = cryptoRandomInt) {
  const used = taken || new Set();
  const pool = [];
  for (let i = 0; i < 10000; i++) {
    const s = pad4(i);
    if (!used.has(s)) pool.push(s);
  }
  const k = Math.max(0, Math.min(n, pool.length));
  for (let i = 0; i < k; i++) {
    const span = pool.length - i;
    const r = Math.floor(Number(rng(span)) || 0);
    const j = i + Math.min(span - 1, Math.max(0, r));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k);
}

// Uzupełnia puste numery (null) wolnymi — rozłącznymi z zajętymi w mieście i z numerami
// podanymi w pliku. Zwraca nowe obiekty (wejście bez mutacji); wylosowane mają random: true.
export function assignNumbers(valid, taken, rng = cryptoRandomInt) {
  const rows = valid || [];
  const used = new Set([...(taken || []), ...rows.filter((v) => v.number).map((v) => v.number)]);
  const countNull = rows.filter((v) => v.number == null).length;
  const free = pickFreeNumbers(countNull, used, rng);
  let k = 0;
  return rows.map((v) => {
    if (v.number != null) return { ...v };
    const number = free[k++] ?? null;
    return number ? { ...v, number, random: true } : { ...v };
  });
}

// Parser pliku Imię;Nazwisko;Kod (separator ; albo ,). Numer linii jest fizyczny
// (nagłówek = 1, puste linie liczą się do numeracji). Kolejność sprawdzeń wiersza:
// imię/nazwisko → format/prefiks → duplikat w pliku → zajęty w mieście.
// Zwraca { valid: [{ line, name, surname, number: "NNNN" | null }], errors: [{ line, name, reason }] }.
export function parseCodesCsv(text, { prefix, city, takenNumbers = new Set() } = {}) {
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/);
  const candidates = [];
  const errors = [];
  let seenFirst = false;

  lines.forEach((row, i) => {
    const line = i + 1;
    if (!row.trim()) return;
    const cells = row.split(/[;,]/).map((p) => p.trim().replace(/^["']|["']$/g, ""));
    if (!seenFirst) {
      seenFirst = true;
      const first = (cells[0] || "").toLowerCase();
      if (first === "imię" || first === "imie") return;
    }
    const name = cells[0] || "";
    const surname = cells[1] || "";
    const display = `${name} ${surname}`.trim();
    if (!name || !surname) {
      errors.push({ line, name: display, reason: "brak imienia lub nazwiska" });
      return;
    }
    const raw = (cells[2] || "").trim();
    const eq = raw.match(/^=\s*"?(.*?)"?$/);
    const rawCell = (eq ? eq[1] : raw).trim();
    if (!rawCell) {
      candidates.push({ line, name, surname, number: null });
      return;
    }
    let num = rawCell;
    const withLetters = rawCell.match(/^([A-Za-z]{3})[-\s]?(\S+)$/);
    if (withLetters) {
      const L = withLetters[1].toUpperCase();
      if (L !== prefix) {
        errors.push({ line, name: display, reason: `kod ${L}-${withLetters[2]} należy do innego miasta` });
        return;
      }
      num = withLetters[2];
    }
    if (!/^\d{4}$/.test(num)) {
      const hint = /^\d{1,3}$/.test(rawCell) ? " — jeśli w Excelu zniknęły zera z przodu, sformatuj kolumnę Kod jako Tekst" : "";
      errors.push({ line, name: display, reason: `kod „${rawCell}” musi mieć 4 cyfry${hint}` });
      return;
    }
    candidates.push({ line, name, surname, number: num });
  });

  // Duplikaty w pliku — oznaczamy wszystkie wystąpienia.
  const byNumber = new Map();
  for (const c of candidates) {
    if (!c.number) continue;
    if (!byNumber.has(c.number)) byNumber.set(c.number, []);
    byNumber.get(c.number).push(c.line);
  }

  const valid = [];
  for (const c of candidates) {
    const display = `${c.name} ${c.surname}`.trim();
    const dupLines = c.number ? byNumber.get(c.number) : null;
    if (dupLines && dupLines.length >= 2) {
      errors.push({ line: c.line, name: display, reason: `kod ${prefix}-${c.number} powtarza się w pliku (wiersze ${joinLines(dupLines)})` });
      continue;
    }
    if (c.number && takenNumbers && takenNumbers.has(c.number)) {
      errors.push({ line: c.line, name: display, reason: `kod ${prefix}-${c.number} jest już zajęty w mieście ${city}` });
      continue;
    }
    valid.push(c);
  }

  errors.sort((a, b) => a.line - b.line);
  return { valid, errors };
}
