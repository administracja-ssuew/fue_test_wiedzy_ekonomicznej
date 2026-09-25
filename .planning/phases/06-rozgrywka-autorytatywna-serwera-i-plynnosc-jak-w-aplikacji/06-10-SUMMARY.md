---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 10
subsystem: database-hardening
tags: [sql, supabase, security, sc5, sc6, legacy-rpc, production]
requires: ["06-09"]
provides:
  - "Sekcja 41 w SUPABASE_FIXES.sql (linie 2048–2278), wgrana na produkcję ytbwmmqwbfcugouourih"
  - "Stare RPC bez wycieku poprawności przed closes_at + 1,5 s: submit_answer, get_participant_answers, get_admin_answer_summary"
  - "update_quiz_session_admin odrzuca sterowanie rozgrywką sesji z planem; start_quiz_session (stary) wyłączony komunikatem „przeładuj stronę”"
  - "schema_marker_41 + blok SEKCJA 41 w verify-prod (znacznik + stare sygnatury, SC6)"
affects: [06-11]
tech-stack:
  added: []
  patterns: ["delegacja starego RPC do v2 dla sesji z planem (ta sama sygnatura, CREATE OR REPLACE bez DROP)", "znacznik wgrania sekcji jako funkcja IMMUTABLE schema_marker_NN()", "składnia SQL + plpgsql sprawdzana lokalnie parserem libpg-query (WASM) w scratchpadzie"]
key-files:
  created: []
  modified: [SUPABASE_FIXES.sql, scripts/verify-prod.js, scripts/rls-check.js]
key-decisions:
  - "Bramka sesji bez planu w get_admin_answer_summary = czas pytania + 1,5 s (a nie sam czas z §29.4): w tym oknie submit_answer jeszcze przyjmuje wybór, więc wcześniejsze ans byłoby wyciekiem"
  - "Admin widzi 'correct' bez bramki (licznik na żywo), ale 'ans' dla sesji bez planu dalej bramkowane jak w §29.4; sesja z planem → get_answer_summary_v2 (admin bez bramki)"
  - "update_quiz_session_admin: status results/ended przepuszczany (nowy panel), status waiting czyści plan_anchor_at/plan_paused_at/revealed_*"
requirements-completed: [P6-SC5, P6-SC6]
duration: ~1 h (z ręcznym wgraniem SQL)
completed: 2026-09-25
---

# Phase 6 Plan 10: Utwardzenie starych RPC (sekcja 41) — Summary

**Sekcja 41 jest wgrana na produkcję. Stare `submit_answer`, `get_participant_answers` i `get_admin_answer_summary` nie zwracają poprawności przed closes_at + 1,5 s. `submit_answer` dla sesji z planem deleguje do `submit_answer_v2`. Starym panelem nie da się już ani wystartować sesji bez planu, ani sterować sesją z planem. Sygnatury się nie zmieniły (SC6). `verify-prod` kończy się kodem 0 (45 OK). Sonda podstawowa na produkcji: SC5 OK, przebieg zielony.**

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Sekcja 41 w SUPABASE_FIXES.sql + sprawdzenie w verify-prod (+ rls-check) | 0f12825 |
| 2 | Ręczne wgranie sekcji 41 (użytkownik: „wgrane”) + automatyczna weryfikacja | (ten commit, razem z SUMMARY) |

## Co zawiera sekcja 41 (SUPABASE_FIXES.sql:2048–2278)

- **41.1 `submit_answer`.** Sesja z planem: `PERFORM submit_answer_v2(...)` i zwrot `{is_correct: NULL, correct_ans: NULL}`. Sesja bez planu: walidacja i zapis jak w §36, a `is_correct`/`correct_ans` dopiero po `q_started_at + tpq + 1,5 s`.
- **41.2 `get_participant_answers`** (LANGUAGE sql, ten sam RETURNS TABLE). `is_correct` = NULL, dopóki pytanie nie jest odsłonięte. Odsłonięte znaczy: results/ended, albo w sesji z planem `t_eff ≥ c + 1500` (z uwzględnieniem pauzy), albo w sesji bez planu `gidx < current_idx` lub minął czas pytania + 1,5 s.
- **41.3 `get_admin_answer_summary`** (teraz plpgsql, ten sam JSON). Sesja z planem przechodzi do `get_answer_summary_v2`. Sesja bez planu: `correct` i `ans` bramkowane (+1,5 s), admin widzi `correct`. Pętli nie ma, bo v2 woła tę funkcję tylko dla sesji bez planu.
- **41.4 `update_quiz_session_admin`.** Dla sesji z planem odrzuca `q_started_at`, `current_question_idx`, `pause_elapsed_s` oraz status running/paused. Status `waiting` czyści resztki planu. Rola sprawdzana przez `COALESCE`.
- **41.5a `start_quiz_session`.** Po sprawdzeniu roli zawsze `RAISE 'Nieaktualny panel admina — przeładuj stronę (Ctrl+F5)…'`. Sesji nie zmienia.
- **41.5 `schema_marker_41()`.** Wykonanie mają anon i authenticated.

## Weryfikacja

- **Przed wgraniem:** `verify-prod` 44 OK, jedyny czerwony to `schema_marker_41 — BRAK`. `check-planless` = 0. Parser libpg-query przyjął 18 instrukcji i wszystkie funkcje plpgsql (kontrola negatywna, czyli celowo zepsuta funkcja, została wyłapana).
- **Wgranie:** ręcznie w SQL Editorze projektu `ytbwmmqwbfcugouourih`. Użytkownik odpisał „wgrane”, wyników zapytań kontrolnych nie wkleił. Wgranie potwierdza `verify-prod` przez `schema_marker_41 = true`.
- **Po wgraniu, `npm run verify-prod`:** kod **0**, „PRODUKCJA GOTOWA pod kątem SQL (45 OK)”. Zielone: `schema_marker_41` oraz stare sygnatury `submit_answer`, `get_participant_answers`, `get_admin_answer_summary` i `start_quiz_session` (anon dostaje 42501, funkcja istnieje).
- **`npm run build`:** kod 0.
- **Sonda podstawowa na prod** (`PROBE_TARGET=prod PROBE_CONFIRM=1 npm run sonda`, preview :4173):

| Przebieg | Kod | Widoczność pytań (plan 26 s) | Start vs plan (maks.) | Idx w bazie | `results` od zamiatacza | SC5 | Sprzątanie |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 25,8 / **23,2** / 25,6 s | **2773 ms** (limit 1500) | 89/89 | +1659 ms | **OK** (18 asercji, v2 ×3) | 0/0/0 |
| 2 | **0** | 26,0 / 25,6 / 25,4 s | 775 ms | 93/93 | +534 ms | **OK** (21 asercji, v2 ×3) | 0/0/0 |

  W przebiegu 1 pytanie 2 wystartowało na obu telefonach testowych 1,9–2,8 s po planie. Baza była zgodna z planem przez cały czas (89/89), a SC5 przeszło. Nowy klient (v2) nie woła żadnej funkcji zmienionej w sekcji 41, więc uznaję to za chwilowe opóźnienie przeglądarki testowej, a nie regresję. Powtórka przeszła w całości (kod 0). Przy okazji luki „błąd pauzy / pominięte pytanie” (uwaga 2 z 06-09) warto obserwować, czy się powtarza.
- **Po sondach:** `check-planless` = 0 sesji running/paused bez planu. Preview zatrzymany.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] Bramka sesji bez planu w `get_admin_answer_summary` z +1,5 s**
- **Found during:** Task 1
- **Issue:** §29.4 zwracał `ans` już po `q_started_at + tpq`, a `submit_answer` przyjmuje wybór do `+1,5 s`. Kto pobrał `ans` w tym oknie, mógł wysłać poprawną odpowiedź, co łamie kryterium sukcesu („żaden RPC dla anona przed closes_at + 1,5 s”).
- **Fix:** `correct` i `ans` otwierane dopiero po czasie pytania + 1,5 s (ta sama bramka co w 41.1/41.2).
- **Files modified:** SUPABASE_FIXES.sql · **Commit:** 0f12825

**2. [Rule 1 - Bug] `scripts/rls-check.js`, test 14**
- **Found during:** Task 1
- **Issue:** Test oczekiwał od `submit_answer` wyniku `is_correct === false` od razu. Po sekcji 41 przed bramką przychodzi NULL, więc test by padał.
- **Fix:** akceptuje false albo NULL. Sprawdzenie wiersza w bazie (`is_correct=false`) zostało bez zmian.
- **Files modified:** scripts/rls-check.js · **Commit:** 0f12825

**3. `REVOKE ... FROM PUBLIC, anon` dla `update_quiz_session_admin` i `start_quiz_session`.** Powtórzone jak w sekcji 23, więc uprawnienia się nie zmieniają (CREATE OR REPLACE i tak zachowuje ACL).

**Total deviations:** 2 auto-fixed (1 security, 1 bug) + 1 formalna. **Impact:** ścisłe domknięcie SC5 dla sesji bez planu, bez wpływu na ścieżkę v2.

## Notatki dla 06-11

- `src/lib/supabase.js`: `startQuizSession` (stary `start_quiz_session`), `submitAnswer` i `getParticipantAnswers` nie mają już wywołań w `src`. Do usunięcia z kodem legacy.
- `scripts/load-runner.js` nie woła `start_quiz_session`. Sesje ustawia kluczem serwisowym i odpowiada przez stary `submit_answer` na sesjach bez planu, co działa dalej (poprawność wraca dopiero po bramce, a load-test liczy tylko sukces zapisu). `bot-runner.js` nie używa starych RPC.
- Stara karta panelu admina (nieprzeładowana): Start pokazuje komunikat „przeładuj stronę”, a Pauza/Wznów/Następne/Powtórz na sesji z planem kończą się błędem „session has plan…”.

## Known Stubs

Brak.

## Self-Check: PASSED

- FOUND: SUPABASE_FIXES.sql (sekcja 41, linie 2048–2278), scripts/verify-prod.js (schema_marker_41), scripts/rls-check.js
- FOUND: commit 0f12825
