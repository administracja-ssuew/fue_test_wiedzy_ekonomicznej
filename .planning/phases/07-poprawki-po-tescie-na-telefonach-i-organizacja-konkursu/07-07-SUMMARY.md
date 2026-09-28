---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 07
subsystem: anty-cheat, raport-xlsx
tags: [naruszenia, localStorage, deduplikacja, xlsx, styles, vitest, tdd]
requires:
  - "07-05: recordViolation({ typeCount }), VIOLATION_LABELS, violationsFor"
provides:
  - "useAntiCheat: trwały licznik { total, tab_switch, screenshot_attempt } per sesja + kod, dosłanie zaległego zapisu"
  - "xlsx.js: xl/styles.xml + komórki { v, fmt: \"0.00\" } → s=\"1\""
  - "resultsXlsx.js: buildResultsSheets({ results, rows, city, violations }), downloadResultsXlsx({ …, violations }), secs z 2 miejscami"
affects: [07-11, 07-12]
tech-stack:
  added: []
  patterns:
    - "Licznik naruszeń w localStorage (klucz fue_viol_<sesja>_<kod>) = źródło prawdy „na telefonie”"
    - "Deduplikacja z dosłaniem: ≤ 1 zapis / 10 s / typ, timer na koniec okna, flush przy odmontowaniu"
    - "Komórka XLSX jako obiekt { v, fmt } dla liczb z formatem"
key-files:
  created:
    - src/hooks/useAntiCheat.test.js
  modified:
    - src/hooks/useAntiCheat.js
    - src/lib/xlsx.js
    - src/lib/xlsx.test.js
    - src/lib/resultsXlsx.js
    - src/lib/resultsXlsx.test.js
decisions:
  - "Przy zmianie klucza (inna sesja/kod) okno deduplikacji (lastSentRef) jest zerowane — pierwsze zdarzenie nowego klucza idzie do bazy od razu"
  - "Zaległy zapis przy zmianie klucza wysyłany z domknięcia starego efektu (stary kod/sesja, stare liczniki) — cleanup efektów React biegnie przed ich ponownym uruchomieniem"
  - "Wiersze naruszeń na karcie uczestnika wstawione między „Bez odpowiedzi” a „Średni czas odpowiedzi (s)”"
  - "Obiekt komórki bez skończonej liczby ({ v: \"\" } / { v: null }) = pusta komórka; secsCell(null) zwraca \"\" (nie obiekt)"
metrics:
  duration: 15min
  completed: 2026-09-28
  tasks: 2
  files: 6
---

# Faza 07 Plan 07: Naruszenia zgodne z telefonem i czasy 0.00 w XLSX — podsumowanie

`useAntiCheat` trzyma licznik naruszeń per typ w localStorage (ciągły przez moduły, przerwy i refresh), zapisuje do bazy nadal najwyżej 1 wiersz / 10 s / typ, ale zdarzenia z okna dosyła jednym zapisem z aktualnymi licznikami; skoroszyt wyników dostał `xl/styles.xml` z formatem `0.00`, czasy z 2 miejscami oraz kolumnę i wiersze naruszeń.

## Zadania

| # | Zadanie | Commity | Pliki |
|---|---------|---------|-------|
| 1 | useAntiCheat — trwały licznik per typ + dosłanie (TDD) | `043a40e` (RED), `fca3b51` (GREEN) | src/hooks/useAntiCheat.js, src/hooks/useAntiCheat.test.js |
| 2 | XLSX — styles.xml 0.00, secs 2 miejsca, naruszenia (TDD) | `215a546` (RED), `0e817ab` (GREEN) | src/lib/xlsx.js, src/lib/xlsx.test.js, src/lib/resultsXlsx.js, src/lib/resultsXlsx.test.js |

## Co powstało

**useAntiCheat.js** (API bez zmian: `{ violations, showWarning, lastType, dismiss }`)
- Klucz `fue_viol_<sesja|none>_<kod|none>`; `load()` z try/catch i sanityzacją liczb, `save()` odporny na tryb prywatny.
- Osobny efekt na `[key]` wczytuje licznik przy zmianie sesji/kodu (zadeklarowany przed efektem nasłuchów).
- `trigger(type)`: `bump` (+1 typ, +1 total, zapis do localStorage, `setViolations`), ostrzeżenie, potem zapis od razu albo jeden timer na koniec okna (`DEDUPE_MS - since`).
- `send(type)`: `recordViolation({ …, count: c.total, typeCount: c[type] })`.
- Cleanup: dla oczekujących typów `clearTimeout` + natychmiastowy `send`; blokady kopiuj/drukuj/menu bez zmian.
- `countRef` usunięty.

**useAntiCheat.test.js** — 8 przypadków: 3 wyjścia w 5 s → 1 zapis + 1 dosłanie (count 3, typeCount 3), osobne okna dla typów i `count` = suma, flush przy odmontowaniu bez drugiego zapisu, ciągłość po remount, inna sesja od 0, zmiana kodu w locie, ostrzeżenie/dismiss, `active=false`.

**xlsx.js**
- `STYLES_XML` (fonts/fills/borders/cellStyleXfs, `<cellXfs count="2">` z `numFmtId="2"` `applyNumberFormat="1"`, cellStyles).
- Override `/xl/styles.xml` w `[Content_Types].xml`, relacja `rId{n+2}` `…/relationships/styles`, wpis `xl/styles.xml` przed sharedStrings (ZIP ma teraz 8 wpisów dla 2 arkuszy).
- `sheetXml`: `{ v: liczba, fmt: "0.00" }` → `<c r s="1"><v>`; obiekt bez liczby = pusta komórka.

**resultsXlsx.js**
- `secs = Math.round(ms / 10) / 100` (12345 → 12.35), `secsCell` → `{ v, fmt: "0.00" }` albo `""`.
- Ranking: kolumna „Naruszenia” (liczba, 0 bez wpisu); „Śr. czas (s)” jako `secsCell`.
- Płaska tabela i karta: „Czas (s)” jako `secsCell`; karta: po „Bez odpowiedzi” trzy wiersze naruszeń (etykiety z `VIOLATION_LABELS`), potem „Średni czas odpowiedzi (s)”.
- `downloadResultsXlsx({ results, rows, city, fileName, violations })` — kontrakt dla 07-11; bez `violations` → zera.

## Weryfikacja

- `vitest run src/hooks/useAntiCheat.test.js src/screens/Quiz.test.jsx` — 12/12.
- `vitest run` (cały zestaw) — 14 plików, 301/301.
- `vite build` — kod 0.
- Kryteria `grep` z planu: `typeCount: c[type]` = 1, `fue_viol_` = 1, `clearTimeout` ≥ 1, brak `countRef`; `numFmtId="2"`, `<cellXfs count="2">`, `xl/styles.xml`, `relationships/styles` = 1; `Math.round(ms / 10) / 100` = 1, `"Naruszenia"` = 1, `Naruszenia łącznie` = 1; `toBe(8)` = 1, `toBe(12.35)` = 1, brak `toBe(7)`/`toBe(12.3)`.
- Kontrola poza testami (niecommitowana): wygenerowany plik otwarty przez openpyxl — Ranking `[…, 12.35, 2]`, komórka H2 ma `number_format = "0.00"`, karta z trzema wierszami naruszeń. Test w Excelu — ręcznie w 07-12.

## Odchylenia od planu

Plan wykonany zgodnie z opisem. Doprecyzowania w granicach planu:
- Dodane testy ponad `<behavior>`: unikalne Id relacji w `workbook.xml.rels`, zmiana kodu w locie, `active=false`, brak czasu → pusta komórka.
- `onKey` używa `String(e.key || "")` przed `toLowerCase()` — chroni przed zdarzeniem bez `key` (np. syntetycznym z autouzupełniania), które dotąd rzucałoby wyjątek w handlerze.

### Uwaga środowiskowa (nie dotyczy kodu)
Katalog `node_modules` w repozytorium głównym jest pusty; zależności leżą w `D:\Projects\fue-quiz-project\fue-quiz\node_modules`. Do uruchamiania testów i builda w worktree utworzyłem junction `node_modules` → ten katalog (ignorowany przez git, bez `npm install`).

## Known Stubs

Brak. Panel (SesjaTab/HistoriaTab) jeszcze nie przekazuje `violations` do `downloadResultsXlsx` — to zakres 07-11; do tego czasu eksport ma kolumnę i wiersze naruszeń z zerami.

## Self-Check: PASSED

- FOUND: src/hooks/useAntiCheat.js, src/hooks/useAntiCheat.test.js, src/lib/xlsx.js, src/lib/xlsx.test.js, src/lib/resultsXlsx.js, src/lib/resultsXlsx.test.js
- FOUND commits: 043a40e, fca3b51, 215a546, 0e817ab
