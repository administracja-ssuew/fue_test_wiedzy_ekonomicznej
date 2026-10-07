// ─── NARUSZENIA ANTY-CHEAT: ETYKIETY I AGREGACJA ─────────────────────────────────
// Wiersz w `violations` niesie `count` = łączna liczba naruszeń uczestnika (wszystkie
// typy) oraz - od sekcji 44 - `type_count` = licznik danego typu. Stare wiersze nie
// mają `type_count`; wtedy zapasem jest liczba wierszy danego typu (dolne oszacowanie).
// Ta sama agregacja służy za fallback, gdy RPC get_session_violation_summary nie jest
// wgrane, oraz w trybie DEMO (klucze camelCase z localStorage).

// Jedno źródło etykiet dla panelu admina i raportu XLSX.
export const VIOLATION_LABELS = {
  tab_switch: "Wyjście z aplikacji / wygaszenie ekranu",
  screenshot_attempt: "Próba zrzutu ekranu",
};

const TYPES = ["tab_switch", "screenshot_attempt"];

// rows → Map<kod, { total, tab_switch, screenshot_attempt }>. Brak kodu w mapie = 0.
export function summarizeViolations(rows) {
  const acc = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const code = r.participant_code ?? r.participantCode;
    if (code == null) continue;
    const s = acc.get(code) || { total: 0, tab_switch: 0, screenshot_attempt: 0, rows: { tab_switch: 0, screenshot_attempt: 0 } };
    s.total = Math.max(s.total, Number(r.count) || 0);
    if (TYPES.includes(r.type)) {
      s.rows[r.type] += 1;
      const tc = r.type_count ?? r.typeCount;
      if (tc != null) s[r.type] = Math.max(s[r.type], Number(tc) || 0);
    }
    acc.set(code, s);
  }
  const out = new Map();
  for (const [code, s] of acc) {
    const tab_switch = s.tab_switch || s.rows.tab_switch;
    const screenshot_attempt = s.screenshot_attempt || s.rows.screenshot_attempt;
    out.set(code, { total: Math.max(s.total, tab_switch + screenshot_attempt), tab_switch, screenshot_attempt });
  }
  return out;
}

// Kopia wpisu dla kodu albo zera, gdy uczestnik nie ma naruszeń.
export function violationsFor(map, code) {
  const v = map?.get?.(code);
  return v ? { ...v } : { total: 0, tab_switch: 0, screenshot_attempt: 0 };
}
