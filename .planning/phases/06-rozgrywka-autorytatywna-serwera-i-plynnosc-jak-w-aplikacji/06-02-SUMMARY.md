---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 02
subsystem: database
tags: [supabase, plpgsql, pg_cron, rpc, realtime]
requires: []
provides:
  - "session_plans + kolumny plan_anchor_at/plan_paused_at/revealed_idx/revealed_ans"
  - "plan_position, sweep_decision (anon — parzystość JS↔SQL)"
  - "start_quiz_session_v2, submit_answer_v2, get_participant_state, get_answer_summary_v2"
  - "admin_pause_session, admin_resume_session, admin_skip_question, admin_repeat_question, admin_sweep_session"
  - "advance_due_sessions + pg_cron fue-advance-due (1 s) + fue-cron-cleanup + sweeper_status"
affects: [06-03, 06-04, 06-06, 06-08, 06-10]
tech-stack:
  added: [pg_cron]
  patterns: ["kotwica + offsety ms (plan zamrożony przy starcie)", "zamiatacz idempotentny wyprowadzający stan z zegara", "bramka odsłonięcia closes_at + 1,5 s"]
key-files:
  created: []
  modified: [SUPABASE_FIXES.sql]
key-decisions:
  - "Błędy submit_answer_v2 jako RAISE EXCEPTION (jak §36) — klient 06-04 rozpoznaje je po error.message"
  - "v_now odświeżane po uzyskaniu blokady FOR UPDATE w start_v2 i akcjach admina"
  - "get_participant_state filtruje answers po znormalizowanym kodzie upper(btrim(p_code))"
requirements-completed: [P6-SC1, P6-SC4, P6-SC5, P6-SC6]
duration: ~20 min
completed: 2026-09-24
---

# Phase 6 Plan 02: Sekcje SQL 39–40 (plan sesji, RPC v2, zamiatacz, pg_cron) Summary

**Do SUPABASE_FIXES.sql doszły sekcje 39 i 40: plan sesji zamrażany przy starcie, jedna funkcja pozycji `plan_position`, RPC v2 z poprawnością ukrytą do `closes_at + 1,5 s`, akcje admina jako przesunięcia kotwicy oraz idempotentny zamiatacz uruchamiany przez pg_cron co 1 s. Wszystko wyłącznie jako dopiski.**

## Performance
- Tasks: 2/2
- Files modified: 1 (`SUPABASE_FIXES.sql`, +764 linie, 0 usuniętych)

## Accomplishments
- 39.1–39.6: tabela `session_plans` (RLS: tylko odczyt), 4 kolumny w `quiz_sessions`, `plan_position` (skopiowana dosłownie z planu), `sweep_decision`, `build_session_plan` (stałe 10/30/4/6), `start_quiz_session_v2`, `submit_answer_v2` (zwraca tylko `{accepted, duplicate, chosen}`), `get_participant_state` (czasy w epoch ms, odrzucanie przypiętej zakończonej sesji, gdy istnieje nowsza), `get_answer_summary_v2`
- 39.7–39.9: cztery akcje admina v2, `advance_due_sessions` (FOR UPDATE OF s SKIP LOCKED), `admin_sweep_session`, łatki kompatybilności `advance_session_question` (`AND plan_anchor_at IS NULL`) i `start_quiz_session` (czyści pola planu)
- 40: `pg_cron`, zadania `fue-advance-due` ('1 seconds') i `fue-cron-cleanup` (*/10), `sweeper_status()` (ostatni przebieg z `end_time IS NOT NULL`)

## Task Commits
1. **Task 1: Sekcja 39.1–39.6** – `600cfca`
2. **Task 2: Sekcja 39.7–39.9 + 40** – `5309543`

## Decisions Made
- `submit_answer_v2` zgłasza błędy przez `RAISE EXCEPTION` z komunikatami z planu, spójnie z §36. Na tym opiera się 06-04 (`retryable` dla 'session paused').
- W `start_quiz_session_v2` i akcjach admina `v_now` jest odświeżane po `FOR UPDATE`, więc czekanie na blokadę nie skraca zapowiedzi ani nie przesuwa terminów.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Osobne sprawdzenie FOUND przed odczytem pól RECORD w admin_skip/repeat_question**
- **Issue:** Warunek `NOT FOUND OR p.idx … OR p.phase …` w plpgsql rzuca „record p is not assigned yet”, gdy plan_position nie zwróci wiersza.
- **Fix:** Najpierw `IF NOT FOUND` → `{ok:false, reason:'no plan'}`, potem sprawdzenie noop. To samo w `admin_resume_session` i w obliczaniu `reveal` w `get_participant_state` (zagnieżdżone IF zamiast CASE na nieprzypisanym rekordzie).
- **Commit:** 5309543, 600cfca

**2. [Rule 2 - Correctness] v_now odświeżane po FOR UPDATE** (start_v2 i 4 akcje admina). Plan zakładał tylko `DECLARE v_now := clock_timestamp()`. Wartość początkowa została, dodano ponowne przypisanie po uzyskaniu blokady.

**3. Drobne:** z komentarza 39.9 usunięto frazę „DROP FUNCTION”, bo inaczej kryterium akceptacji z grep dawało 1 zamiast 0.

## Issues Encountered
- Nie ma lokalnego Postgresa, więc SQL nie był parsowany ani wykonany. Pierwszą realną weryfikacją będzie ręczne wgranie w 06-03.

## User Setup Required
Ręczne wgranie w 06-03 (SQL Editor, projekt ytbwmmqwbfcugouourih):
1. Najpierw `select version();` (sekundowy harmonogram wymaga Postgres ≥ 15.1.1.61) i `select extversion from pg_extension where extname='pg_cron';`.
2. Wgrać sekcję 39 w całości, potem sekcję 40. Sekcja 40 wymaga istnienia `advance_due_sessions`.
3. Po wgraniu 40 sprawdzić `select public.sweeper_status();`. Po kilku sekundach `last_run_age_s` powinno być < 2.

## Known Stubs
None.

## Next Phase Readiness
- 06-03 może wgrać SQL i uruchomić verify-plan/verify-prod.
- Ważne: łatka `start_quiz_session` (39.9) przestaje być potrzebna po sekcji 41 (06-10), która zastępuje ją wyjątkiem.

## Self-Check: PASSED
- SUPABASE_FIXES.sql zawiera `─── 39.` (l. 1284) i `─── 40.` przed stopką; 14 funkcji (7+7) wg grep; numstat 764/0
- Commity 600cfca i 5309543 istnieją
