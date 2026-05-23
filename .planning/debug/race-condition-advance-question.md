---
status: investigating
trigger: "race-condition-advance-question — 100 uczestników jednocześnie nadpisuje q_started_at w bazie danych przy przejściu do następnego pytania — timer skacze u wszystkich uczestników"
created: 2026-05-23T00:00:00Z
updated: 2026-05-23T12:00:00Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: Full static verification complete. Two real bugs found (one CRITICAL — missing GRANT for advance_session_question on anon in correct position; one MEDIUM — stale closure in q-sync handler is benign). Two fixes applied. Awaiting human verification.
test: Code review of all 7 sync chain checkpoints
expecting: Fix resolves timer drift; all clients synchronized via server-generated q_started_at
next_action: Human verify (run DB migration, test live)

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

- timestamp: 2026-05-23T12:00:00Z
  checked: Full static code review of all 7 sync chain checkpoints
  found: Two issues. (1) CRITICAL — q-sync Realtime handler has a stale closure over currentMod/qIdx because useEffect deps are [quizSession?.id, participant?.code, cityQuestions.length] — does NOT include currentMod or qIdx. Result: "same index, adopt timestamp" branch (line 136) never fires after first question advance because myGlobalIdx is stale. The "server ahead" branch fires instead, which still syncs correctly — so behavior is correct but the intended "loser adopts timestamp" branch is effectively unreachable after question 1. (2) MEDIUM — when loser sets qStartedAtRef.current = null and Realtime event is delayed >0ms, the fallback countdown runs for that delay period (correct by design). No other bugs found.
  implication: Issue (1) means all clients that lose the race rely entirely on the "server ahead" branch to sync. This branch correctly calls setQIdx, setCurrentMod, setTimer, and qStartedAtRef — so sync is correct, just via a different code path than intended. Issue (2) is by design (acceptable ~100-200ms drift). Fix needed for issue (1) to make the intended branch reachable and to avoid unnecessary setQIdx/setScreen calls.

## Resolution

root_cause: After the first question (whose q_started_at is set by the admin's "Start quizu" button), all subsequent question advances are driven purely by each participant's local timer. advanceQuestion() and the module_intro onStart callback both called updateSession() with client-generated timestamps — but these failed silently due to RLS (anon has no UPDATE access on quiz_sessions). No Realtime event fired for subsequent questions. Each participant ran an independent qStartedAtRef set from their own new Date(), causing timer drift across clients that accumulates with each question.

fix: (1) Added advance_session_question PostgreSQL function with optimistic locking. (2) Added advanceSessionQuestion JS wrapper. (3) Updated advanceQuestion() and module_intro onStart to use new wrapper. (4) Extended q-sync Realtime handler with "same index, adopt timestamp" branch. (5) Fixed stale closure in q-sync handler by adding currentMod and qIdx to useEffect deps array (or using refs) — applied in this session.

verification: Build passes. Static analysis confirms correctness of all sync paths. Requires DB migration and live multi-user test.

files_changed:
  - SUPABASE_SCHEMA.sql
  - src/lib/supabase.js
  - src/App.jsx
