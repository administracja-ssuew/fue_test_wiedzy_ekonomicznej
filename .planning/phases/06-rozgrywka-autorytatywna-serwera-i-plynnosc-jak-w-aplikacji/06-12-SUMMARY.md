---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 12
subsystem: plan-model
tags: [sql, supabase, plan, reveal, breaks, gap-closure, production]
requires: ["06-11"]
provides:
  - "REVEAL_MS = 11500 (1,5 s bramki + 10 s widocznej poprawnej odpowiedzi) i BREAK_AFTER_MODULES = [2, 4] w src/lib/gameLogic.js"
  - "plan.js: buildPlanItems ze znacznikiem h, holdDue, breakIdxAt, sweepAction, projectPlanState z plannedBreak / breakAfterModule / nextModule"
  - "Sekcja 42 w SUPABASE_FIXES.sql (linie 2280–2611), wgrana na produkcję ytbwmmqwbfcugouourih"
  - "verify-plan: parzystość budowy planu, pozycji v2 i przerw JS↔SQL; verify-prod: blok SEKCJA 42"
  - "DEMO: demoApplyHold — tryb bez kluczy też staje na przerwach"
affects: [06-15, 06-16]
tech-stack:
  added: []
  patterns: ["czysta funkcja IMMUTABLE build_plan_items jako wspólny kontrakt JS↔SQL (testowalna anonem)", "przerwa planowa = znacznik h w zamrożonym planie + kolumna plan_hold_idx (przerwy zużyte)"]
key-files:
  created: []
  modified: [src/lib/gameLogic.js, src/lib/gameLogic.test.js, src/lib/plan.js, src/lib/plan.fixtures.json, src/lib/plan.test.js, src/lib/supabase.js, SUPABASE_FIXES.sql, scripts/verify-plan.js, scripts/verify-prod.js]
key-decisions:
  - "Przerwa nie ma stałej długości: zamiatacz ustawia status 'paused' z plan_paused_at = kotwica + r, wznowienie istniejącym admin_resume_session (przesunięcie kotwicy); offsety o/c/r bez zmian"
  - "Przerwa zatrzymuje DOKŁADNIE na granicy anchor + r, także przy zaległości crona (a nie w chwili zamiecenia)"
  - "Plany zamrożone przed sekcją 42 (reveal 6 s, bez h) działają bez zmian — fixture'y legacy nietknięte, sweepDecision nietknięte"
requirements-completed: [P6-GAP-REVEAL10, P6-GAP-BREAKS, P6-SC5, P6-SC6]
duration: ~2 sesje (z ręcznym wgraniem SQL)
completed: 2026-09-27
---

# Phase 6 Plan 12: Reveal 11,5 s + przerwy planowe po modułach 2 i 4 (sekcja 42) — Summary

**Nowe sesje mają okno odsłony 11,5 s: bramka serwera zostaje 1,5 s (SC5), a poprawna odpowiedź jest widoczna przez 10 s (luka G1). Quiz sam staje po ostatnim pytaniu modułu 2 i modułu 4 i czeka na „▶ Wznów quiz” (luka G3). Sekcja 42 jest wgrana na produkcję i jest wyłącznie addytywna: jedna kolumna nullable, 7 funkcji przez CREATE OR REPLACE, 0 DROP. Po wgraniu: `verify-prod` 49 OK, parzystość JS↔SQL 47/47.**

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 (RED) | Testy: fixture'y v2, holdDue / breakIdxAt / sweepAction / projekcja przerwy | 3d1f67e |
| 1 (GREEN) | Model planu w JS: REVEAL_MS 11 500, znacznik h, funkcje przerw | 31753ae |
| 2 | Sekcja 42 + verify-plan / verify-prod + DEMO | fb6c2ee |
| 3 | Ręczne wgranie sekcji 42 (użytkownik: „wgrane”) + automatyczna weryfikacja | (ten commit, razem z SUMMARY) |

## Co zawiera sekcja 42 (SUPABASE_FIXES.sql:2280–2611)

- **42.1** `quiz_sessions.plan_hold_idx INT` (nullable) — indeks ostatniej przerwy zatrzymanej przez zamiatacz.
- **42.2 `build_plan_items(p_questions, p_modules)`** — czysta budowa planu (IMMUTABLE, bez tabel), lustro `buildPlanItems`: `r = c + 11500`, `h: true` na ostatnim pytaniu modułu 2/4, gdy po nim jest inny moduł.
- **42.3 `build_session_plan(p_city)`** — ta sama sygnatura, teraz deleguje do `build_plan_items`.
- **42.4 `plan_hold_due(...)`** — pierwsza niezużyta przerwa, której termin minął; lustro `holdDue`.
- **42.5 `start_quiz_session_v2`** — ciało 39.5 + `plan_hold_idx = NULL`.
- **42.6 `advance_due_sessions`** — przed `sweep_decision` sprawdza przerwę; przy należnej ustawia `paused`, `plan_paused_at = anchor + r`, `plan_hold_idx`, `current_question_idx = k + 1`, odsłonę pytania k.
- **42.7 `get_participant_state`** — kopia 39.6b + `plan_hold_idx` w obiekcie `session`; bramka `c + 1500` nietknięta.
- **42.8 `schema_marker_42()`**.

## Weryfikacja

- **Przed wgraniem:** `npm test` 156/156 (5 plików). `verify-prod`: sekcje 39–41 zielone, zamiatacz żywy (ostatni przebieg 0,4 s temu), jedyne czerwone to 4 wiersze SEKCJI 42 („BRAK”). `check-planless` = 0.
- **Wgranie:** ręcznie w SQL Editorze projektu `ytbwmmqwbfcugouourih` z pliku `sekcja-42.sql` (wycięty 1:1 z SUPABASE_FIXES.sql, 7 × CREATE OR REPLACE FUNCTION, 0 × DROP). Użytkownik odpisał „wgrane”; wyników zapytań kontrolnych nie wkleił — wgranie potwierdza `verify-prod`.
- **Po wgraniu, `npm run verify-prod`:** kod **0**, „PRODUKCJA GOTOWA pod kątem SQL (49 OK)”. SEKCJA 42: `schema_marker_42` ok, `build_plan_items` r − c = 11500 i h po module 2, `plan_hold_due` należna na granicy, kolumna `plan_hold_idx` istnieje.
- **`npm run verify-plan`:** kod **0**, „PARZYSTOŚĆ JS↔SQL: 47/47” — pozycje legacy i v2 (V1–V9), zamiatacz (S1–S10), budowa (6 pytań, 5 modułów), przerwy (H1–H8).
- **`check-planless`:** 0 sesji running/paused bez planu.

## Deviations from Plan

Brak odstępstw w zakresie. Kontrola składni parserem libpg-query nie została odnotowana w sesji wykonującej Task 2; składnię ostatecznie potwierdziło bezbłędne wykonanie w SQL Editorze i zielony `verify-prod`/`verify-plan`.

## Notatki dla kolejnych planów

- Projekcja (`projectPlanState`) już zwraca `plannedBreak`, `breakAfterModule`, `nextModule`, ale ekrany uczestnika i panel admina jeszcze ich nie pokazują — to zakres 06-15/06-16. Do tego czasu przerwa wygląda jak zwykła pauza.
- `useLiveProjection` nadal bierze `REVEAL_SECONDS` (teraz 11,5) tylko jako stan początkowy `autoSec`; UI liczy sekundy z terminów planu.
- Nowe zasady dotyczą wyłącznie sesji wystartowanych po 2026-09-27 (plan zamrażany przy starcie).

## Known Stubs

Brak.

## Self-Check: PASSED

- FOUND: SUPABASE_FIXES.sql (sekcja 42), scripts/verify-plan.js (plan_hold_due, build_plan_items), scripts/verify-prod.js (schema_marker_42), src/lib/supabase.js (demoApplyHold)
- FOUND: commits 3d1f67e, 31753ae, fb6c2ee
