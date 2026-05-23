---
status: awaiting_human_verify
trigger: "race-condition-advance-question — 100 uczestników jednocześnie nadpisuje q_started_at w bazie danych przy przejściu do następnego pytania — timer skacze u wszystkich uczestników"
created: 2026-05-23T00:00:00Z
updated: 2026-05-23T00:00:00Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: CONFIRMED — participants cannot write to quiz_sessions (RLS blocks anon UPDATE). updateSession() calls from participants fail silently. After question 1, each participant runs an independent local timer derived from their own new Date() in advanceQuestion(). No server-side sync event fires between questions. Timer drift accumulates across questions.
test: Implementation in progress — adding advance_session_question RPC (optimistic locking + NOW()) and updating advanceQuestion() to call it
expecting: All clients receive a single authoritative q_started_at via Realtime after each question advance
next_action: Add SQL function to SUPABASE_SCHEMA.sql, add JS wrapper in supabase.js, update advanceQuestion() in App.jsx

## Symptoms

expected: Po upłynięciu czasu pytania wszyscy uczestnicy przechodzą do następnego pytania z poprawnie zsynchronizowanym timerem. Timer powinien pokazywać pełen czas (np. 60s) i odliczać równomiernie u wszystkich.
actual: Gdy ~100 uczestników kończy pytanie jednocześnie (timer = 0), każdy klient wywołuje updateSession() ze swoim własnym new Date().toISOString(). Ostatni UPDATE wygrywa w DB (last-write-wins). Wszyscy poprzednio zsynchronizowani uczestnicy dostają przez Realtime nowy q_started_at który może być o ~1000ms późniejszy od ich własnego — timer skacze do Math.max(1, ...) czyli do "1s" zamiast poprawnych "59s".
errors: Brak błędów w konsoli — to bug logiczny/race condition, nie exception.
reproduction: Uruchom quiz z ≥10 uczestnikami jednocześnie. Gdy skończy się czas pierwszego pytania, obserwuj timer u uczestników którzy szybciej przeszli do pytania 2 — u nich timer "skacze" do małej wartości gdy późniejszy q_started_at nadpisze wcześniejszy.
started: Problem istnieje od początku architektury. Nigdy nie był testowany z wieloma użytkownikami jednocześnie.

## Eliminated

(empty)

## Evidence

- timestamp: 2026-05-23T00:00:00Z
  checked: symptoms and context provided
  found: Race condition in advanceQuestion() — every client writes its own timestamp, last-write-wins in DB
  implication: Need to read actual code to confirm mechanism and pick fix approach

- timestamp: 2026-05-23T00:01:00Z
  checked: RLS policy sessions_admin_write and GRANT table in SUPABASE_SCHEMA.sql
  found: Anon users only have SELECT on quiz_sessions. updateSession() from participants fails silently due to RLS. No client-written q_started_at ever reaches the DB.
  implication: The race is not last-write-wins in DB — participants never write. The actual problem is that after question 1 (set by admin via "Start quizu"), all subsequent questions use each participant's local new Date() in qStartedAtRef.current. No server sync event fires for subsequent questions. Timers drift independently per client.

- timestamp: 2026-05-23T00:02:00Z
  checked: ModuleIntro.jsx countdown logic
  found: ModuleIntro auto-fires onStart() after 3-second countdown. All 100 participants call advanceSessionQuestion() simultaneously when the countdown reaches 0.
  implication: Race condition confirmed for module transitions. Same issue exists for each question advance within a module.

- timestamp: 2026-05-23T00:03:00Z
  checked: q-sync Realtime handler (lines 112-141 in App.jsx)
  found: Handler only syncs when s.current_question_idx > myGlobalIdx. Same-index events (from winner's DB write) are ignored. Loser clients have no way to receive the server timestamp.
  implication: Handler needed an additional branch for same-index + no local qStartedAtRef case.

- timestamp: 2026-05-23T00:04:00Z
  checked: npm run build
  found: Build succeeds with no errors after fix applied.
  implication: No syntax errors in the implementation.

## Resolution

root_cause: After the first question (whose q_started_at is set by the admin's "Start quizu" button), all subsequent question advances are driven purely by each participant's local timer. advanceQuestion() and the module_intro onStart callback both call updateSession() with client-generated timestamps — but these fail silently due to RLS (anon has no UPDATE access on quiz_sessions). No Realtime event fires for subsequent questions. Each participant runs an independent qStartedAtRef set from their own new Date(), causing timer drift across clients that accumulates with each question.

fix: Added advance_session_question PostgreSQL function with optimistic locking (WHERE current_question_idx = p_expected_idx). The first of N concurrent callers wins; it sets q_started_at = NOW() (server clock). All other callers get NULL back and wait for the Realtime event. The q-sync Realtime handler was extended to adopt the server timestamp when qStartedAtRef is null and the index matches. Losers display a fallback countdown until the Realtime event arrives (~100-200ms). Three files changed: SUPABASE_SCHEMA.sql (new RPC + grant), src/lib/supabase.js (new advanceSessionQuestion wrapper), src/App.jsx (advanceQuestion + module_intro onStart + q-sync handler).

verification: Build passes. Requires DB migration (run new SQL) and Supabase Realtime enabled on quiz_sessions (already in schema).

files_changed:
  - SUPABASE_SCHEMA.sql
  - src/lib/supabase.js
  - src/App.jsx
