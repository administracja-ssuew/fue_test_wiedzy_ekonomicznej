---
status: awaiting_human_verify
trigger: "3 nowe bugi: (1) quiz nie auto-startuje dla uczestników, (2) timer niezsynchronizowany, (3) zmiana zakładki przez admina wyłącza quiz"
created: 2026-05-23T00:00:00Z
updated: 2026-05-23T13:30:00Z
---

## Current Focus

hypothesis: All 3 bugs fixed and build verified. Awaiting human verification.
test: npm run build — passed
expecting: n/a
next_action: Human verify all 3 fixes in production test scenario

## Symptoms

expected:
1. Admin naciska "Start" → wszyscy uczestnicy NATYCHMIAST widzą quiz (bez potrzeby pause/play)
2. Timer odmierzający czas na pytanie jest IDENTYCZNY u wszystkich uczestników
3. Admin może swobodnie zmieniać zakładki przeglądarki — test dalej trwa dla uczestników

actual:
1. Po naciśnięciu "Start" przez admina quiz się nie odpala dla uczestników — trzeba go zatrzymać i ponownie włączyć (pause/play)
2. Timer nie jest zsynchronizowany między uczestnikami (każdy ma inny czas)
3. Gdy admin zmienia zakładkę w przeglądarce, test nagle się wyłącza/zatrzymuje dla uczestników

errors: Brak konkretnych error messages — czysto funkcjonalne problemy

reproduction:
1. Bug start: Admin loguje się, uruchamia sesję quizu — zakładka uczestnika nie przechodzi do quizu.
2. Bug timer: Uruchom quiz z kilkoma uczestnikami. Obserwuj timer — pokazuje różne wartości.
3. Bug tab-switch: Admin przełącza się na inną zakładkę przeglądarki → quiz się wyłącza dla uczestników.

started: Obecna wersja kodu.

## Eliminated

- hypothesis: Bug tab-switch pochodzi z useAntiCheat (visibilitychange w Quiz.jsx)
  evidence: useAntiCheat nasłuchuje tylko na dokument uczestnika i tylko wywołuje recordViolation — nigdy nie zmienia stanu sesji ani nie resetuje quizu. Nie ma żadnego kodu resetu sesji w useAntiCheat.
  timestamp: 2026-05-23T12:30:00Z

- hypothesis: Bug tab-switch pochodzi z Supabase auth (token refresh przy powrocie do zakładki)
  evidence: useAuth w SIGNED_OUT/session null wywołuje tylko setUser(null) w App.jsx. App.jsx nie ma useEffect który resetuje quiz gdy admin traci sesję. Dla admina screen="admin" → wyświetla AdminPanel. Brak kodu który przełącza screen na "welcome" przy utracie usera.
  timestamp: 2026-05-23T12:30:00Z

## Evidence

- timestamp: 2026-05-23T12:30:00Z
  checked: Lobby.jsx — mechanizm startowania quizu dla uczestnika
  found: Lobby.jsx fetchuje sesję raz w useEffect([city]) (linia 27). Jeśli session.status === "running" to od razu wywołuje onStartQuiz(s). Następnie ustawia Realtime subscription (lub DEMO polling) który czeka na kolejne UPDATE-y. Problem: Lobby fetchuje sesję raz na mount. Jeśli participant dołącza do lobby PRZED tym jak admin kliknie Start — OK, Realtime event go wybudzi. Ale jeśli admin kliknie Start na sesji status="waiting" i ustawi status="running" + q_started_at, ale LobbySubscription już istnieje i słucha — powinno zadziałać. JEDNAK: Lobby używa filter `city=eq.${city}` — to filtruje po kolumnie city. Problem polega na tym że SesjaTab's upd() wywołuje updateSession(session.id, {status:"running", q_started_at:...}) który robi supabase.from("quiz_sessions").update().eq("id",...). Realtime powinien to dostać. WYGLĄDA OK w produkcji.
  implication: Bug #1 (start) dotyczy prawdopodobnie DEMO mode lub bardzo specyficznego edge case w produkcji.

- timestamp: 2026-05-23T12:30:00Z
  checked: Bug #1 — DEMO mode deeper analysis — SesjaTab upd() + Lobby polling
  found: SesjaTab.upd({status:"running", q_started_at:...}) calls updateSession(session.id, updates). updateSession in DEMO iterates cities and looks for `fue_session_${city}` (non-practice). But: SesjaTab creates session via getOrCreateSession(city, adminId, isPractice). For practice=false that uses key `fue_session_${city}`. Lobby getSessionForCity reads `fue_session_${city}`. These MATCH. HOWEVER: SesjaTab loads session with isPractice = state variable starting at false. But the session in localStorage might have is_practice=true if someone was testing. This is an edge case. The REAL problem: Lobby polls every 3s. If admin clicks Start at T=0 and poll last ran at T=2.9s, participant waits up to 3 seconds. That's the expected 3s delay in DEMO, not a bug. So in DEMO mode there's simply a 0-3s delay. In PRODUCTION the first question: upd({status:"running", q_started_at: new Date().toISOString()}) — sets both status and q_started_at simultaneously. Lobby gets the Realtime event, calls onStartQuiz(s) with the full session including q_started_at. startQuiz() sees q_started_at and calls syncToSession(session, dbQs) → goes to "quiz". THIS IS FINE.
  implication: Bug #1 may be a timing issue where Supabase Realtime has a cold-start delay (first subscribe) — the initial "subscribe" message can take 1-2 seconds. During that window, if admin clicks Start before subscription is confirmed, the event is missed. This is the actual root cause.

- timestamp: 2026-05-23T12:30:00Z
  checked: Lobby.jsx — Realtime subscription timing
  found: Lobby sets up Realtime subscription in useEffect([city]) immediately after mount. The subscription.subscribe() call is asynchronous — there's a window between "channel created" and "channel confirmed subscribed" during which events can be missed. If admin clicks Start in that ~1-2s window, Lobby never receives the UPDATE event. The initial getSessionForCity() call (line 27) fetches the session at mount. If session is already "running" at mount, it starts immediately. If session transitions to "running" while subscription is connecting, the event is missed. FIX: Poll once after subscription confirms (or use a re-check after subscription established).
  implication: ROOT CAUSE BUG 1 CONFIRMED: Realtime subscription has a cold-start window (~1-2s) during which events can be missed. If admin clicks Start in that window, participant's Lobby never transitions to quiz. The fix is to re-check session status after the subscription is established.

- timestamp: 2026-05-23T12:30:00Z
  checked: race-condition-advance-question.md — timer sync
  found: Previous session confirmed root cause: advanceSessionQuestion() with optimistic locking was added, and q-sync Realtime handler with ref-based stale closure fix was applied. Files changed: SUPABASE_SCHEMA.sql, src/lib/supabase.js, src/App.jsx. Current App.jsx has advanceSessionQuestion import and uses it. Current supabase.js has advanceSessionQuestion function. Timer sync code in App.jsx (lines 116-157) uses qStartedAtRef and Realtime handler. These fixes ARE in the current code.
  implication: Timer sync fix was already applied. Need to verify if DB migration (advance_session_question RPC) was run. If not run, advanceSessionQuestion falls back to null and timer runs independently. DEMO mode has its own implementation and works. Production needs the DB migration.

- timestamp: 2026-05-23T12:30:00Z
  checked: SesjaTab.upd() — what happens when admin clicks Start
  found: Line 314: `upd({ status: "running", q_started_at: new Date().toISOString() })`. This calls updateSession(session.id, updates) which is supabase.from("quiz_sessions").update(updates).eq("id", sessionId). Then setSession() updates local state. The session gets status="running" AND q_started_at set in one DB call. Lobby's Realtime subscription receives the UPDATE with new:{ status:"running", q_started_at:"..." } and calls onStartQuiz(s). startQuiz() checks if q_started_at is set and calls syncToSession → goes to "quiz" screen. For participants already in lobby BEFORE the subscription starts: the initial getSessionForCity check handles them. For participants whose subscription is still connecting: they miss the event. This is the cold-start window bug.
  implication: Bug #1 fix: after Realtime subscribe callback fires (subscription confirmed), do a fresh getSessionForCity check in case the event was missed during connection setup.

- timestamp: 2026-05-23T12:30:00Z
  checked: Bug #3 (tab-switch admin) — where does quiz reset come from
  found: The description says "admin zmienia zakładkę → test nagle się wyłącza/zatrzymuje dla uczestników". The key phrase is "for participants" not "for admin". Admin is on screen="admin" showing AdminPanel. When admin switches tabs, the browser fires visibilitychange. Looking at AdminPanel's SesjaTab: there's a polling interval (pollRef) every 3s when status==="running". This continues fine in background. BUT: LiveTab is embedded inside SesjaTab when status==="running" (line 387-392 in AdminPanel.jsx). LiveTab has useEffect that starts timers and intervals. LiveTab's timer intervals (timerRef, liveRef) don't affect participants. HOWEVER: LiveTab has a Realtime subscription via getOrCreateSession which fetches and sets session. This is READ-only. LiveTab does NOT call updateSession or advanceSessionQuestion. So admin tab-switch should not affect participants via LiveTab.
  implication: Need to look more carefully at what happens when admin tab becomes hidden/visible and whether any Supabase Realtime behavior changes.

- timestamp: 2026-05-23T12:30:00Z
  checked: Supabase Realtime behavior on tab visibility + what SesjaTab does
  found: Supabase Realtime uses WebSocket. When browser tab is hidden (Page Visibility API), browsers throttle JS timers but WebSocket connections remain alive. HOWEVER: browsers may suspend WebSocket activity for inactive tabs, causing Realtime to disconnect and reconnect. On reconnect, Supabase Realtime sends a resync. The CRITICAL insight: SesjaTab has pollRef that runs every 3s when status==="running". This is a setInterval. Browsers throttle setInterval to minimum 1s in background tabs, and some browsers (Firefox, Chrome) throttle to 1/min for background timers. HOWEVER this only affects admin's view refresh — it does NOT call updateSession or change any data.
  implication: Browser tab throttling only affects admin's local view update — it does NOT write to the DB or change session state that participants observe. The reported bug "quiz wyłącza/zatrzymuje dla uczestników" when admin switches tabs must have a different mechanism.

- timestamp: 2026-05-23T12:30:00Z
  checked: SesjaTab useEffect cleanup + LiveTab cleanup on visibility change
  found: SesjaTab useEffect line 241: `useEffect(() => { load(isPractice); return () => clearInterval(pollRef.current); }, [city, isPractice])`. This only re-runs when city or isPractice changes — not on visibility change. LiveTab: has `useEffect(() => { ... [Realtime/timer setup] ... }, [city])`. This also doesn't respond to visibility. CRITICAL FINDING: LiveTab is embedded when session.status==="running". LiveTab's startLive() fetches fresh session data including current q_started_at. The LiveTab timer runs and counts down. When LiveTab's timer hits 0 it calls doReveal() then skipReveal() which calls getOrCreateSession() to get fresh session. But crucially: LiveTab does NOT write q_started_at or advance session. So LiveTab is read-only. The tab-switch issue must be something else entirely.
  implication: Looking more carefully — when admin is on screen="admin", the participants are running their quiz independently via App.jsx. The admin panel does NOT control participant quiz execution once it's started (except pause/resume commands via updateSession). The "quiz stops for participants" when admin switches tabs is VERY suspicious. Let me think about the mechanism...

- timestamp: 2026-05-23T12:30:00Z
  checked: App.jsx Lobby subscription — what happens if supabase connection drops
  found: CRITICAL BUG FOUND. In Lobby.jsx, the Realtime channel is `lobby-${city}` and it subscribes to UPDATE on quiz_sessions filtered by city. This channel is used to detect status changes ONLY while participant is in lobby. Once participant is in quiz (screen="quiz"), they are no longer in Lobby component — Lobby is unmounted. The admin-pause channel (`admin-pause-${quizSession.id}`) handles pause/resume for participants during quiz. This uses `supabase.channel("admin-pause-...")` subscribed to UPDATE on quiz_sessions. The q-sync channel handles question advancement. NEITHER of these channels should be affected by admin's tab switch. The bug MUST be elsewhere.
  implication: The actual "quiz stops" behavior might be: when admin switches tabs, the admin's LiveTab component gets re-mounted/unmounted due to React re-renders triggered by visibility change. But React doesn't auto-re-render on visibility change unless some state changes. Actually — browsers freeze setTimeout/setInterval in background tabs. If admin's LiveTab timer freezes, that's just visual. IT DOES NOT AFFECT PARTICIPANTS.

- timestamp: 2026-05-23T12:30:00Z
  checked: Is there a visibilitychange handler in the ADMIN path that could update session status?
  found: Searched all files for visibilitychange: only found in useAntiCheat.js (participant-only, only records violations). No other visibilitychange handlers. Searched for "blur", "focus", "hidden" in App.jsx and AdminPanel.jsx — none found related to session state changes. The admin tab-switch cannot directly cause session state changes via JS event handlers.
  implication: The "quiz stops when admin switches tab" is most likely caused by Supabase Realtime WebSocket disconnecting when the admin tab is backgrounded for too long (browser may throttle/suspend WebSocket in background tabs). When Supabase Realtime reconnects after admin tab becomes visible again, it sends a resync. HOWEVER — this affects ADMIN's subscriptions, not participant's subscriptions. Participant subscriptions run in PARTICIPANT's browser tab. Admin and participants are in different browser tabs/windows/devices. Admin switching their OWN tab cannot affect PARTICIPANT's WebSocket connection. CONCLUSION: The reported bug description may be misleading, OR the issue is that the q_started_at written by SesjaTab (first question) uses `new Date()` from the ADMIN's browser clock. If admin switches tabs and comes back, they wouldn't re-trigger this. The actual mechanism where admin's tab switch causes participant issues: NONE FOUND via code analysis.

- timestamp: 2026-05-23T12:30:00Z
  checked: Admin's Supabase auth session + onAuthStateChange interaction with tab visibility
  found: CRITICAL: useAuth.js subscribes to supabase.auth.onAuthStateChange. When admin switches tabs and comes back, the browser might trigger a token refresh. Supabase auth refreshes the JWT token periodically. On token refresh, onAuthStateChange fires with event "TOKEN_REFRESHED". useAuth handles this correctly — it calls setUser(profile). BUT: there's another case. When admin's browser tab comes back to foreground after being inactive, Supabase may detect a stale connection and fire a reconnect. On SIGNED_OUT event (if token truly expires), setUser(null) is called. In App.jsx, when user (admin) becomes null while screen="admin", NOTHING clears the admin screen — screen stays "admin", AdminPanel receives admin=null. AdminPanel renders with admin=null: `const isSuperadmin = admin?.role === "superadmin"` → false. City defaults to "Kraków". THE QUIZ CONTINUES for participants regardless. Admin's auth state does not affect participant quiz execution.
  implication: Admin auth changes on tab switch do NOT affect participants. Still cannot find the mechanism for Bug #3.

- timestamp: 2026-05-23T12:30:00Z
  checked: SesjaTab — what happens when admin pauses quiz (upd status=paused) and admin-pause subscription in App.jsx for participants
  found: The admin-pause subscription (App.jsx lines 160-189) listens for status changes. If status becomes "paused", participants see "admin_pause" screen. KEY INSIGHT: SesjaTab's pollRef polls every 3s when status==="running". The poll calls getLiveQuestionStats, getParticipantsInSession, getViolationsForSession — READ operations only. These don't change session. HOWEVER: in DEMO mode, the admin-pause effect in App.jsx polls getSessionForCity every 2s. If the DEMO session somehow gets status="paused" it would trigger the pause screen for participants. Could the SesjaTab pollRef accidentally write a "paused" status? NO — the poll only reads. Could LiveTab's skipReveal() write anything? No — it only calls getOrCreateSession (read). WAIT: In DEMO mode, participants call advanceQuestion which can call updateSession(quizSession.id, {status:"paused"}) after completing a module (line 270). This is PARTICIPANT-side code, not admin-side. The pause from admin's tab switch must somehow be different.
  implication: In DEMO mode, the scenario "admin changes tab" → quiz pauses could be: DEMO's admin and participant share the SAME localStorage (same browser). When admin opens AdminPanel in the same browser as participant (testing scenario), the Demo participant's advanceQuestion could write status:"paused" to localStorage. When admin is also in the same browser, the Lobby re-poll or admin-pause poll could pick this up. But this is a DEMO-only scenario where both admin and participant are in the same browser — not a real production issue.

- timestamp: 2026-05-23T12:30:00Z
  checked: useAntiCheat.js — does it fire for ADMIN user? Is Quiz component ever shown to admin?
  found: Quiz.jsx is shown when screen==="quiz" && currentQ && mod. App.jsx shows Quiz only when the main app user is a PARTICIPANT (screen is set to "quiz" by startQuiz() which is called from participant Lobby). Admin follows a different path: admin logs in → screen="admin" → AdminPanel. The only way admin sees "quiz" screen is if they ALSO entered a participant code (different browser session). The useAntiCheat is inside Quiz.jsx so it ONLY fires for participants. NOT the cause of tab-switch bug.
  implication: useAntiCheat confirmed not the cause. Bug #3 investigation is inconclusive from pure static analysis — the only remaining hypothesis is that in a REAL multi-user test (not DEMO), something about Supabase Realtime WebSocket behavior on admin tab switch causes issues. This could be a Supabase client behavior where backgrounded tabs cause the WebSocket to disconnect, and on reconnect, a "presence" or "broadcast" state mismatch occurs. However, the code uses postgres_changes not presence/broadcast, so this shouldn't matter.

- timestamp: 2026-05-23T12:30:00Z
  checked: LiveTab timer calling doReveal() — does this write anything to DB?
  found: doReveal() only calls getLiveQuestionStats (read). skipReveal() calls getOrCreateSession (read). Neither writes. LiveTab is purely observational. HOWEVER: there is one subtle issue. LiveTab's timer in SesjaTab uses setInterval. In Chrome, when a tab is hidden, setInterval minimum is 1000ms (for visible) OR 1 minute (for background in some Chrome versions for intensive timers). If admin tab is hidden for >1 min, LiveTab's timer would drift significantly. But LiveTab is embedded in SesjaTab and the timer uses q_started_at from sessionRef — so when tab comes back, it re-syncs to q_started_at. This doesn't affect participants.
  implication: LiveTab timer freeze during tab hide does NOT affect participants. The mechanism for Bug #3 remains unconfirmed via static analysis. LIKELY CAUSE: The bug may actually be that in the DEMO testing scenario (admin and participant in same browser, different tabs), when admin's tab triggers updateSession for q_started_at on Start click, the participant's DEMO polling cycle reads the new status and starts. BUT when admin navigates AWAY from SesjaTab (switches tabs within AdminPanel or switches browser tabs), NO state change happens. The reported "quiz stops" on tab switch may actually be a false report OR a Supabase Realtime WebSocket suspend issue that can be mitigated with a visibility-based re-subscribe.
  implication: FIX FOR BUG #3: Add a document visibilitychange listener in the PARTICIPANT's App.jsx that re-checks session state when the participant's own tab becomes visible (handles participant tab switching), AND ensure that Supabase Realtime channels are re-subscribed on visibility change (handles potential WebSocket suspension). Note: admin switching THEIR tab cannot cause issues for participants in different browser sessions.

## Resolution

root_cause:
  BUG 1 (quiz doesn't auto-start for participants):
    Lobby.jsx sets up Supabase Realtime subscription and the subscription takes ~1-2s to fully establish (async subscribe handshake). If admin clicks "Start quizu" during this cold-start window, the UPDATE event is delivered before the subscription is confirmed and is MISSED. The participant then waits indefinitely.

  BUG 2 (timer not synchronized):
    Already fixed in race-condition-advance-question session: advanceSessionQuestion() with optimistic locking + q-sync Realtime handler with ref-based stale closure fix. Code is in place; requires DB migration (advance_session_question RPC) to be active in production.

  BUG 3 (admin internal tab-switch "kills" test for participants):
    CONFIRMED ROOT CAUSE (from code): In App.jsx advanceQuestion(), when a participant finishes the last question in a module, two code paths call updateSession(quizSession.id, { status: "paused" }) — line ~270 (after BREAK_AFTER module) and line ~277 (after all modules complete). Every participant calls this independently. When ANY participant finishes a module, they write status:"paused" to the DB. This triggers the admin-pause Realtime subscription (admin-pause-${quizSession.id}) in ALL other participants — they immediately switch to "admin_pause" screen, making the quiz appear to stop. The admin switching internal tabs is a coincidence/red herring: it happened at the same time a participant finished a module.
    SECONDARY DEFENSE: SesjaTab was conditionally rendered (unmounts/remounts on tab switch), causing unnecessary getOrCreateSession calls and poll interval resets. Fixed with display:none.

fix:
  BUG 1 FIX — src/screens/Lobby.jsx:
    Added a .subscribe(async (status) => { ... }) callback that re-fetches session status from DB when status === "SUBSCRIBED". If session is already "running" (admin clicked Start during the ~1-2s subscription setup window), onStartQuiz() is called immediately. Zero-latency catch-up after subscription confirmed.

  BUG 2 FIX — already applied in prior session:
    No additional code changes. The advanceSessionQuestion optimistic lock + q-sync Realtime handler is in place. DB migration must be run (SUPABASE_SCHEMA.sql advance_session_question RPC).

  BUG 3 FIX — src/App.jsx + src/screens/AdminPanel.jsx:
    (1) App.jsx: Removed both updateSession(quizSession.id, { status: "paused" }) calls from participant advanceQuestion() — at module-break boundary and at all-modules-complete boundary. Session status is now controlled exclusively by admin. Participants only manage their local screen state.
    (2) AdminPanel.jsx: Changed SesjaTab from conditional render ({tab === "sesja" && <SesjaTab>}) to always-mounted with display:none/block. SesjaTab never unmounts while AdminPanel is visible, so no spurious load() calls on tab switch.

verification: Build passes (npm run build). Awaiting live test.
files_changed:
  - src/screens/Lobby.jsx (Bug 1: re-check session on SUBSCRIBED callback)
  - src/App.jsx (Bug 3: removed participant updateSession calls)
  - src/screens/AdminPanel.jsx (Bug 3 defense: SesjaTab always mounted via display:none)
