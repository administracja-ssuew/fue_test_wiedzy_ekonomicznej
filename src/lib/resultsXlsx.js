// ─── Skoroszyt wyników sesji (XLSX) ─────────────────────────────
// Wspólna budowa arkuszy dla SesjaTab (bieżąca sesja) i HistoriaTab (archiwum).
// Wejście: ranking z getSessionResults + wiersze z getSessionDetailedResults
// (uczestnik × pytanie z planu; brak odpowiedzi = pusty wybór, pełny czas pytania).
// Naruszenia: `violations` = Map<kod, { total, tab_switch, screenshot_attempt }>
// z getViolationSummary; brak mapy lub wpisu = zera.
// Bez importu React/supabase - czysta logika, testowana w resultsXlsx.test.js.

import { VIOLATION_LABELS, violationsFor } from "./violations.js";

// ms → sekundy z 3 miejscami (12345 → 12.345), 3 miejsca, spójnie z CSV i podium.
export const secs = (ms) => (ms == null ? "" : Math.round(ms) / 1000);
// Komórka czasu z formatem 0.000 - Excel pokaże „12,300”, a nie „12,3”.
const secsCell = (ms) => (ms == null ? "" : { v: secs(ms), fmt: "0.000" });

export function buildResultsSheets({ results, rows, city, violations }) {
  // Arkusz 1 - ranking (ta sama kolejność co na podium).
  const ranking = [
    ["Miejsce", "Kod", "Imię i nazwisko", "Miasto", "Poprawne", "Pytań", "Skuteczność %", "Śr. czas (s)", "Naruszenia"],
    ...(results || []).map((r, i) => [
      i + 1, r.code, r.name, r.city || city, r.correct, r.total,
      r.total ? Math.round((r.correct / r.total) * 1000) / 10 : 0,
      secsCell(r.avgResponseTime),
      violationsFor(violations, r.code).total,
    ]),
  ];

  // Arkusz 2 - wszystko płasko, jeden wiersz = jedna odpowiedź.
  const flat = [
    ["Kod", "Uczestnik", "Miasto", "Nr pyt.", "Moduł", "Pytanie", "Odp.", "Treść odpowiedzi", "Poprawna", "Treść poprawnej", "Trafione", "Czas (s)"],
    ...(rows || []).map((r) => [
      r.participantCode, r.participantName, r.city, r.qNo, r.moduleName, r.question,
      r.chosenLabel, r.chosenText, r.correctLabel, r.correctText,
      r.chosenLabel ? (r.isCorrect ? "TAK" : "NIE") : "brak odp.", secsCell(r.responseTimeMs),
    ]),
  ];

  // Arkusze 3..N - karta każdego uczestnika (kolejność pierwszego wystąpienia kodu).
  const byCode = new Map();
  for (const r of rows || []) {
    if (!byCode.has(r.participantCode)) byCode.set(r.participantCode, []);
    byCode.get(r.participantCode).push(r);
  }
  const perPerson = [...byCode.entries()].map(([code, list]) => {
    const p = list[0];
    const answered = list.filter((r) => r.chosenLabel);
    const correct = list.filter((r) => r.isCorrect).length;
    // G6: średnia po WSZYSTKICH pytaniach - brak odpowiedzi liczy się jako pełny czas
    // pytania (tak samo jak w get_session_results), więc karta zgadza się z rankingiem.
    const times = list.map((r) => r.responseTimeMs).filter((t) => t != null);
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    const vi = violationsFor(violations, code);
    return {
      name: `${p.participantName} ${code}`,
      rows: [
        ["Uczestnik", p.participantName],
        ["Kod", code],
        ["Miasto", p.city],
        ["Poprawne odpowiedzi", correct, `z ${list.length}`],
        ["Bez odpowiedzi", list.length - answered.length],
        ["Naruszenia łącznie", vi.total],
        [VIOLATION_LABELS.tab_switch, vi.tab_switch],
        [VIOLATION_LABELS.screenshot_attempt, vi.screenshot_attempt],
        ["Średni czas odpowiedzi (s)", secsCell(avg)],
        [],
        ["Nr", "Moduł", "Pytanie", "Twoja odp.", "Treść", "Poprawna", "Treść poprawnej", "Wynik", "Czas (s)"],
        ...[...list].sort((a, b) => a.qNo - b.qNo).map((r) => [
          r.qNo, r.moduleName, r.question,
          r.chosenLabel, r.chosenText, r.correctLabel, r.correctText,
          r.chosenLabel ? (r.isCorrect ? "✓ dobrze" : "✗ źle") : "- brak odpowiedzi",
          secsCell(r.responseTimeMs),
        ]),
      ],
    };
  });

  return [
    { name: "Ranking", rows: ranking },
    { name: "Wszystkie odpowiedzi", rows: flat },
    ...perPerson,
  ];
}

export function resultsFileName({ city, dateIso, name, ext = "xlsx" }) {
  const slug = String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l").replace(/Ł/g, "L")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const date = (dateIso || new Date().toISOString()).slice(0, 10);
  return `wyniki_${city}_${date}${slug ? "_" + slug : ""}.${ext}`;
}

// Import dynamiczny: generator .xlsx nie jest potrzebny do prowadzenia quizu,
// więc nie wchodzi do bundla ładowanego przy starcie panelu.
export async function downloadResultsXlsx({ results, rows, city, fileName, violations }) {
  const { buildXlsx } = await import("./xlsx.js");
  const sheets = buildResultsSheets({ results, rows, city, violations });
  const blob = buildXlsx(sheets);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || resultsFileName({ city });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  return { sheets: sheets.length };
}
