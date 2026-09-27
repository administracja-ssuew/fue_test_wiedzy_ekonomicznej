---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 14
subsystem: wyniki / eksport / SQL
tags: [gap-closure, sql, xlsx, ranking, admin-panel]
requires: ["06-12"]
provides:
  - "Sekcja 43 SUPABASE_FIXES.sql (wgrana na prod): session_question_set, get_session_results z mianownikiem z planu, get_session_detailed_results z uczestnikami z answers, schema_marker_43"
  - "src/lib/resultsXlsx.js: buildResultsSheets, resultsFileName, downloadResultsXlsx, secs"
  - "Przycisk XLSX (per uczestnik) w HistoriaTab"
affects: [AdminPanel SesjaTab, AdminPanel HistoriaTab, verify-prod]
tech-stack:
  added: []
  patterns: ["wspólna funkcja wewnętrzna SQL (REVOKE od anon/authenticated) wołana z SECURITY DEFINER", "czysta logika skoroszytu wydzielona z komponentu + test Vitest"]
key-files:
  created:
    - src/lib/resultsXlsx.js
    - src/lib/resultsXlsx.test.js
  modified:
    - SUPABASE_FIXES.sql
    - scripts/verify-prod.js
    - src/screens/AdminPanel.jsx
    - src/lib/supabase.js
decisions:
  - "CREATE OR REPLACE get_session_detailed_results z identycznym RETURNS TABLE zamiast nowej nazwy RPC (SC6, stary front też dostaje poprawny raport)"
  - "Wspólny zbiór pytań sesji (session_question_set): plan albo pula miasta; ranking i raport liczą z tego samego zbioru"
  - "Brak odpowiedzi = błędna; średni czas liczy brak jako pełny czas pytania (tpq × 1000 ms) — w SQL i na karcie uczestnika w XLSX"
metrics:
  duration: "~20 min (bez czasu oczekiwania na ręczne wgranie)"
  completed: 2026-09-27
  tasks: 3
  files: 6
---

# Faza 06 Plan 14: Wyniki — mianownik z planu i XLSX per uczestnik w Historii — Podsumowanie

Sekcja SQL 43 (wgrana na produkcję) liczy ranking i raport szczegółowy z jednego zbioru pytań sesji (plan albo pula miasta). Brak odpowiedzi liczy się jako błędna, z pełnym czasem pytania. Budowa skoroszytu jest wydzielona do przetestowanego `src/lib/resultsXlsx.js`, a w zakładce Historia jest nowy przycisk „📊 XLSX (per uczestnik)”.

## Zadania

| # | Zadanie | Commit |
|---|---------|--------|
| 1 | Sekcja 43 (session_question_set, get_session_results, get_session_detailed_results, schema_marker_43) + blok SEKCJA 43 w verify-prod | ad3b841 |
| 2 | Test RED `resultsXlsx.test.js` | ee9e9eb |
| 2 | GREEN: `resultsXlsx.js`, HistoriaTab XLSX, SesjaTab na wspólnej funkcji, czasy w sekundach, `totalQ` z planu, DEMO | 38159b9 |
| 3 | Ręczne wgranie sekcji 43 przez użytkownika („43 wgrane”) + `npm run verify-prod` | — (bez zmian w kodzie) |

## Co zrobiono

- **SQL 43.1 `session_question_set(p_session_id)`** zwraca `q_no, question_id, module, tpq` z `session_plans.items` (`i + 1`). Dla sesji bez planu bierze pulę miasta w kolejności `module, sort_order, id`. Anon i authenticated mają odebrane EXECUTE.
- **SQL 43.2 `get_session_results`** ma tę samą sygnaturę (SC6). Liczy iloczyn uczestnik × pytanie z planu: `total_count` to liczba pytań w planie, a średni czas to `COALESCE(ms, s*1000, tpq*1000)`. Gdy zbiór pytań jest pusty, działa dotychczasowe zachowanie z §31. Kolejność: poprawne malejąco, potem średni czas rosnąco.
- **SQL 43.3 `get_session_detailed_results`** ma tę samą sygnaturę co §37.4. Uczestników bierze z `answers.session_id`, więc kod przepięty później na nową sesję nie znika z raportu archiwalnej sesji. Pytania i kolejność bierze z planu. Brak odpowiedzi daje `is_correct=false` i czas równy pełnemu czasowi pytania. Usunięte pytanie pokazuje się jako „(pytanie usunięte)”.
- **43.4 `schema_marker_43()`**. Przed wgraniem składnię sprawdziłem parserem libpg-query: 11 poleceń, 4 treści funkcji bez błędów.
- **verify-prod**: nowy blok SEKCJA 43 sprawdza znacznik, odmowę dostępu anona do `session_question_set` (42501) i obecność obu RPC wyników.
- **`resultsXlsx.js`**: logika arkuszy przeniesiona dosłownie z `exportResultsXlsx`, z jedną zmianą: średni czas na karcie uczestnika liczony jest po wszystkich wierszach (G6). `resultsFileName` tworzy slug bez polskich znaków (maks. 40 znaków). `downloadResultsXlsx` ładuje `xlsx.js` dynamicznie.
- **AdminPanel**:
  - SesjaTab korzysta z `downloadResultsXlsx`; nazwa pliku powstaje z daty sesji.
  - Lista wyników pokazuje `⏱ 12,3 s` zamiast ms z dopiskiem „s”.
  - CSV w SesjaTab ma kolumnę „Śr. czas (s)” w sekundach, jak w Historii.
  - `totalQ = plan?.length || cityQuestions.length`.
  - HistoriaTab ma przycisk XLSX ze stanem `xlsxBusy`.
- **DEMO `getSessionResults`**: `total` bierze z planu sesji (`demoPlan`).

## Weryfikacja

- `npx vitest run src/lib/resultsXlsx.test.js`: 10 z 10 przechodzi. `npm test`: 169 z 169. `npm run build`: przechodzi, `xlsx` zostaje osobnym plikiem.
- Wszystkie kryteria akceptacji sprawdzone grepem: sekcja 43 między 42 a `Done.`, 4 funkcje, 0 `DROP`, 0 `participant_codes.session_id`, 2 wystąpienia `qs.tpq * 1000`, 1 identyczny RETURNS TABLE, 0 usuniętych linii w SUPABASE_FIXES.sql. W AdminPanel: `downloadResultsXlsx(` 2 razy, `"Wszystkie odpowiedzi"` 0 razy, „XLSX (per uczestnik)” 2 razy, `r.avgResponseTime}s` 0 razy, `plan?.length || cityQuestions.length` 1 raz.
- **Przed wgraniem** `npm run verify-prod`: czerwone były tylko `schema_marker_43` i `session_question_set` (BRAK).
- **Po wgraniu** (użytkownik: „43 wgrane”) `npm run verify-prod` kończy się kodem 0: „PRODUKCJA GOTOWA pod kątem SQL (53 OK)”. W SEKCJI 43 `schema_marker_43` jest wgrany, `session_question_set` jest niedostępna dla anona, a obie sygnatury RPC wyników istnieją (SC6).

## Odstępstwa od planu

### Automatycznie naprawione

**1. [Reguła 1 — błąd] DEMO: średni czas w rankingu był w sekundach, panel oczekuje ms**
- **Znalezione podczas:** zadania 2
- **Problem:** DEMO `getSessionResults` zwracał `avgResponseTime` w sekundach, a produkcja w ms. Po zmianie wyświetlania na `ms / 1000` DEMO pokazywałby „0,0 s”.
- **Poprawka:** DEMO zwraca `Math.round(avg_s * 1000)`, czyli ms jak produkcja. Kolejność rankingu bez zmian.
- **Plik:** `src/lib/supabase.js`
- **Commit:** 38159b9

**2. [Kosmetyka] Komentarz w nagłówku sekcji 43** zawierał dosłownie `participant_codes.session_id`, co łamało kryterium grep (= 0). Przeredagowałem go na „kolumny session_id w tabeli kodów”. Commit ad3b841.

### Uwaga: wspólny indeks git z równoległym planem 06-15

Commit **ad3b841** (zadanie 1 tego planu) zawiera przez pomyłkę **usunięcie `src/screens/WaitingResults.jsx` i `src/screens/ModuleIntro.jsx`** (−75 i −33 linii). Te usunięcia należą do planu 06-15: executor 06-15 zrobił `git rm`, a zmiany trafiły do wspólnego indeksu przed moim `git commit`, mimo że stage'owałem tylko własne pliki. Zmiana merytorycznie należy do 06-15 i jest zamierzona. Nie cofałem jej, bo cofnięcie przywróciłoby pliki, które 06-15 celowo usunął.

## Znane zaślepki

Brak.

## Self-Check: PASSED

- FOUND: src/lib/resultsXlsx.js, src/lib/resultsXlsx.test.js, SUPABASE_FIXES.sql (sekcja 43), scripts/verify-prod.js (SEKCJA 43)
- FOUND commits: ad3b841, ee9e9eb, 38159b9
