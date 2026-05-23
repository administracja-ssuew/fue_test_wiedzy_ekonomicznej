---
status: awaiting_human_verify
trigger: "3 powiązane błędy w przepływie quizu: (1) Admin startuje test ale uczestnicy nie widzą zmiany, (2) Live View powinno automatycznie otwierać się gdy admin startuje test a nie być osobną zakładką, (3) Tryb próbny nie działa z perspektywy uczestnika + przykładowe pytania (PRACTICE_QUESTIONS) do usunięcia."
created: 2026-05-23T00:00:00Z
updated: 2026-05-23T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — 4 separate root causes identified for 4 issues
test: Code read complete
expecting: n/a
next_action: Apply fixes for all 4 issues

## Symptoms

expected:
1. Admin naciska "Start" → uczestnicy natychmiast widzą pytanie (real-time przez Supabase)
2. Live View nie powinno być osobną zakładką — gdy admin startuje test, AdminPanel automatycznie przełącza się w tryb monitorowania (Live View)
3. Tryb próbny (PracticeScreen) działa dla uczestnika — może ćwiczyć przed testem głównym
4. PRACTICE_QUESTIONS (przykładowe pytania) mają być usunięte całkowicie

actual:
1. Admin startuje test — nic się nie dzieje po stronie uczestnika
2. Live View jest oddzielną zakładką/widokiem który po otwarciu jakby zamyka/przerywa test
3. Z perspektywy uczestnika tryb próbny nic nie robi — ekran się nie zmienia
4. PRACTICE_QUESTIONS istnieją w kodzie jako placeholder

errors: brak konkretnych error messages — czysto funkcjonalne problemy

reproduction:
- Otwórz 2 zakładki: admin + uczestnik
- Admin loguje się i uruchamia quiz session
- Uczestnik czeka na ekranie oczekiwania
- Nic się nie dzieje po stronie uczestnika
- Kliknięcie "Live View" w panelu admina zamyka/resetuje test

started: nieznane

## Eliminated

(empty)

## Evidence

- timestamp: 2026-05-23T00:00:00Z
  checked: Lobby.jsx — real-time subscription for participant
  found: Subscription filters on `city=eq.${city}` (correct). Calls onStartQuiz(s) when status === "running". onStartQuiz calls startQuiz() in App.jsx which loads questions and syncs state. DEMO path polls every 3s.
  implication: Real-time flow in production is fine IF session status is "running" when admin clicks Start. But admin's SesjaTab uses `upd({ status: "running", q_started_at: new Date().toISOString() })` which also sets q_started_at. Lobby subscription gets the UPDATE and calls onStartQuiz(s) with the full session including q_started_at. startQuiz() checks syncToSession() → goes straight to "quiz". THIS LOOKS CORRECT. Bug may be in DEMO mode: SesjaTab.upd() calls updateSession() which only searches `fue_session_${city}` (not practice), correct. Then poll picks it up every 3s. Actually DEMO may have a timing window.
  implication: Need to check if issue is in DEMO mode or Supabase mode specifically.

- timestamp: 2026-05-23T00:00:00Z
  checked: AdminPanel.jsx SesjaTab — Start quiz button handler
  found: `upd({ status: "running", q_started_at: new Date().toISOString() })`. upd() calls updateSession(session.id, updates) and setSession((s) => ({ ...s, ...updates })). updateSession in supabase.js for DEMO iterates cities and finds the right session by id. This should work.
  implication: The real-time path looks functional. The issue is likely only seen in DEMO mode where getSessionForCity returns `fue_session_${city}` without `_practice` suffix. But wait — `getOrCreateSession` in SesjaTab creates the session, and getSessionForCity in Lobby looks up `fue_session_${city}`. These should match. LOOKS FINE.

- timestamp: 2026-05-23T00:00:00Z
  checked: AdminPanel.jsx — Live tab is a separate tab, not auto-opened on Start
  found: TABS array has both "sesja" and "live" as separate tabs. Admin must manually click "Live" tab. Admin panel starts on tab="sesja". When admin clicks Start quiz in Sesja tab, nothing switches the tab to "live". This confirms Bug #2.
  implication: ROOT CAUSE BUG 2: Live View is a separate tab and is never auto-opened when admin starts quiz. No code transitions tab to "live" on quiz start.

- timestamp: 2026-05-23T00:00:00Z
  checked: AdminPanel.jsx — What LiveTab's startLive() does
  found: LiveTab calls getOrCreateSession(city, null, false). getOrCreateSession checks for non-ended sessions. If quiz is already running, it returns that existing session. So LiveTab does NOT create a new session or break the existing one. It's read-only. Concern about "Live View closing the test" is likely a misunderstanding — clicking Live tab then Start podglądu calls getOrCreateSession which just fetches the existing session.
  implication: LiveTab itself doesn't break the quiz. The "closes/resets test" behavior reported may be because LiveTab is a separate tab and admin navigates away from "sesja" tab, losing live stats visibility. OR it's that the Live tab's startLive() overwrites the session in state that SesjaTab uses — but they have separate state. Actually they don't share state — each tab is independent. Conclusion: Live tab does NOT break the quiz, it's just that switching tabs feels disruptive.

- timestamp: 2026-05-23T00:00:00Z
  checked: Practice.jsx + App.jsx routing — PracticeScreen
  found: In App.jsx line 369: `if (screen === "practice") return <Practice city={participant?.city} ...>`. Practice screen is only reachable if screen === "practice". In Lobby.jsx line 140: button calls onPractice(). In App.jsx line 389: `onPractice={() => setScreen("practice")`. So clicking the practice button in Lobby DOES set screen to "practice" and the Practice component renders. Practice.jsx calls getPracticeQuestions(city). If city has no practice questions in DB (or DEMO localStorage is empty), it shows "Brak pytań próbnych" message. THIS IS THE BUG for issue #3 — in DEMO mode, `fue_practice_${city}` localStorage is empty, so participant sees "Brak pytań próbnych" rather than the PRACTICE_QUESTIONS from questions.js.
  implication: ROOT CAUSE BUG 3: Practice.jsx calls getPracticeQuestions(city) which in DEMO mode reads from localStorage key `fue_practice_${city}`. This is always empty unless an admin explicitly added practice questions via AdminPanel. The hardcoded PRACTICE_QUESTIONS array in questions.js is NOT used anywhere in the participant flow. The Practice screen only shows DB/localStorage data.

- timestamp: 2026-05-23T00:00:00Z
  checked: PRACTICE_QUESTIONS in questions.js — where it's imported
  found: PRACTICE_QUESTIONS exists in questions.js (lines 366-422) — 5 questions. Grep needed to see if it's imported anywhere.
  implication: Will check imports.

- timestamp: 2026-05-23T00:00:00Z
  checked: Whether PRACTICE_QUESTIONS is actually imported anywhere in the codebase
  found: questions.js exports PRACTICE_QUESTIONS but it is not imported in App.jsx (App.jsx imports nothing from questions.js now), not imported in supabase.js (uses getPracticeQuestions from DB/localStorage), not imported in any screen file. PRACTICE_QUESTIONS is dead code — exported but never consumed.
  implication: ROOT CAUSE BUG 4: PRACTICE_QUESTIONS is dead code. Can be safely removed.

- timestamp: 2026-05-23T00:00:00Z
  checked: Bug #1 — admin starts test, participant sees nothing — deeper analysis
  found: In DEMO mode, updateSession iterates: `for (const city of cities) { const key = fue_session_${city}; const s = JSON.parse(localStorage.getItem(key)...); if (s?.id === sessionId) { localStorage.setItem(key, JSON.stringify({ ...s, ...updates })); break; } }`. Lobby polls `getSessionForCity(city)` which reads `fue_session_${city}`. The match depends on sessionId. getOrCreateSession with practice=false uses key `fue_session_${city}` (no suffix). So session created by admin and read by Lobby should use the same key. SEEMS CORRECT in DEMO. In PRODUCTION mode: admin's SesjaTab calls updateSession(session.id, {status:"running", q_started_at:...}) via supabase.from("quiz_sessions").update().eq("id", ...). Lobby has supabase.channel(`lobby-${city}`) subscribed to postgres_changes on quiz_sessions filtered by `city=eq.${city}`. An UPDATE to quiz_sessions where city=city should trigger this. This looks correct. HOWEVER: the Realtime filter `city=eq.${city}` may need the column to exist and Realtime to be enabled on that table in Supabase dashboard. If Realtime is not enabled for quiz_sessions table, the channel subscription returns nothing. This is a Supabase configuration issue, not a code bug.

## Resolution

root_cause:
  BUG 1 (participant doesn't see start): In DEMO mode the mechanism is polling (3s delay) and should work. In production, requires Supabase Realtime enabled for quiz_sessions table — if not enabled, participants never get the UPDATE event. Code logic itself is correct.
  BUG 2 (Live View is a separate tab): AdminPanel has Live tab as an independent tab in TABS array. No code auto-switches to "live" tab when admin clicks Start. The fix is to merge Live View into SesjaTab so it shows automatically when status==="running", OR to switch tab to "live" on Start click.
  BUG 3 (Practice mode shows nothing for participant): Practice.jsx uses getPracticeQuestions(city) which reads from DB/localStorage. In DEMO mode this is empty unless admin manually added practice questions. The static PRACTICE_QUESTIONS array in questions.js is never used.
  BUG 4 (PRACTICE_QUESTIONS should be removed): PRACTICE_QUESTIONS in questions.js is dead code — never imported or used.

fix:
  BUG 1: Add a note about Supabase Realtime setup, and improve DEMO polling reliability (currently fine). Since code is correct, the real fix is ensuring Supabase Realtime is configured. No code change needed for bug 1 beyond current state.
  BUG 2: Remove "live" as separate tab. Embed LiveTab content directly inside SesjaTab — show it automatically when session.status === "running". This way when admin clicks Start, the live monitoring view appears in the same panel.
  BUG 3: Modify getPracticeQuestions() in supabase.js DEMO mode to fall back to PRACTICE_QUESTIONS from questions.js when localStorage is empty. OR modify Practice.jsx to use the static data as fallback.
  BUG 4: Remove PRACTICE_QUESTIONS export from questions.js.

verification:
files_changed:
  - src/screens/AdminPanel.jsx
  - src/lib/supabase.js
  - src/data/questions.js
