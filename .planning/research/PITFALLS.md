# Domain Pitfalls — FUE Quiz (Real-Time Quiz App)

**Domain:** Real-time multiplayer quiz / Kahoot replacement
**Stack:** React 18 + Supabase Realtime + PWA (Vite + vite-plugin-pwa)
**Scale:** ~500 concurrent participants (100/uczelnia × 5 miast), free-tier Supabase
**Researched:** 2026-04-23
**Confidence note:** WebSearch and WebFetch tools were unavailable during this session.
All findings are from training data (cutoff August 2025) cross-checked against
project-specific evidence in CONCERNS.md and PROJECT.md. Confidence levels are
assigned per-claim. **Verify Supabase free-tier limits against the current pricing
page before going to production** — these numbers change without notice.

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or total quiz failure during the event.

---

### Pitfall 1: Client Timer Drift — Participants See Different Countdowns

**What goes wrong:**
Each participant's browser runs its own `setInterval` countdown. Intervals fire at
slightly different real-world times depending on CPU load, tab visibility, and
device performance. After 30 seconds, two phones can show countdowns that differ by
2–5 seconds. When the admin advances the question the timer on some phones is still
running; on others it expired 3 seconds ago. Fast phones lock out answers early,
slow phones get extra time — scoring is unfair.

The existing codebase already has this bug: `src/App.jsx` lines 177–189 run a
client-side `setInterval` with no server anchor.

**Why it happens:**
- `setInterval` is not wall-clock accurate; browsers throttle timers in background tabs
- No single source of truth for "when did this question start"
- Mobile browsers aggressively throttle JS timers when screen dims

**Consequences:**
- Unfair scoring (up to ±5 s advantage)
- Late submissions reach the server after the question has already been closed
- Participant experience diverges from admin view — confusion, complaints

**Warning signs:**
- During testing: two phones showing different timer values for the same question
- Admin's "next question" fires but some phones still show the old question
- Answers arriving in the database after `q_ended_at` timestamp

**Prevention strategy:**
1. Store `q_started_at: Date.now()` in the Broadcast message the admin emits when
   advancing to a question.
2. Each client computes remaining time as:
   `remaining = question.time_limit - (serverNow - q_started_at) / 1000`
   where `serverNow` is derived from a one-time clock sync at session join
   (fetch `/api/now` or use `Supabase.rpc('now')` → store offset).
3. Use `requestAnimationFrame` (or a 250 ms interval) to redraw the visual timer
   from that formula — never decrement a counter.
4. On the server (Supabase Edge Function or Postgres trigger), validate answers
   against `q_started_at + time_limit` — reject anything arriving late regardless
   of client display.
5. Add a `visibilitychange` listener: when the tab becomes visible again, immediately
   recalculate remaining time to correct for throttling.

**Phase to address:** Phase with Supabase Realtime integration (real-time sync phase).
This must be in the first working multiplayer milestone, not deferred.

**Confidence:** HIGH — this is a well-documented, universal problem with client-side
timers in competitive quiz apps.

---

### Pitfall 2: Supabase Free Tier Realtime Limits — 500 Connections May Fail

**What goes wrong:**
The Supabase free tier has hard limits on Realtime. At 500 simultaneous participants
all subscribing to quiz channels, you can hit the concurrent-connection ceiling or
the messages-per-second rate limit mid-event. When the limit is hit, Supabase silently
drops new connection attempts or starts rate-limiting message delivery. Participants
see a frozen screen; admin advances questions but nothing propagates.

**Known limits as of training data (August 2025) — MUST BE VERIFIED:**
| Limit | Free Tier | Pro Tier |
|-------|-----------|----------|
| Concurrent Realtime connections | 200 | 500 (soft) |
| Messages per second (server → clients) | ~100 msg/s | ~500 msg/s |
| Max channels per project | 100 | 1000 |
| Max message size | 256 KB | 3 MB |
| Monthly messages (bandwidth) | 2 million | 5 million |

**Confidence:** MEDIUM — numbers from training data. Supabase has adjusted these
limits multiple times. Verify at https://supabase.com/pricing before production.

**Why 500 connections is a problem on free:**
- I etap: 5 parallel sessions × up to 100 participants = 500 connections
- Each participant subscribes to at least 1 channel (quiz session channel)
- Admin panel adds additional connections
- Free tier concurrent limit is likely 200 (verify!)

**Consequences:**
- Participants joining after the limit is hit receive no real-time events
- Event appears to work but some participants are silently disconnected
- No error surfaced to participants — they just see a stalled screen
- Cannot serve all 5 simultaneous first-round sessions on free tier

**Warning signs:**
- Load test with 50+ clients shows some clients stop receiving broadcasts
- Supabase dashboard shows connection count hitting ceiling
- Participants at session join report "waiting" screen that never advances

**Prevention strategy:**
1. **Verify actual limits before event** — log into Supabase dashboard and check
   the Realtime metrics page under project settings.
2. **Consider upgrading to Pro for event day** — Pro tier costs ~$25/month; for
   a single annual event this is negligible. Downgrade after.
3. **Reduce channel subscriptions per client:** one channel per session (not one
   per participant). Use Broadcast, not Presence, for question sync — Presence
   carries higher overhead per connection.
4. **Use Postgres Changes sparingly** — each Postgres Changes listener creates an
   additional subscription that counts against limits. Use Broadcast for
   game-state events; only use Postgres Changes for answer aggregation in admin.
5. **Implement a graceful degradation fallback:** if WebSocket connect fails,
   fall back to polling `/api/quiz-state` every 2 seconds — ugly but functional.
6. **Load test before event day:** write a simple script that opens 120 WebSocket
   connections to a staging project and verifies all receive a broadcast message.

**Phase to address:** Must be investigated during architecture/infrastructure phase
before any real-time code is written. Revisit in a pre-event load-test milestone.

---

### Pitfall 3: WebSocket Reconnection — Participant Drops Mid-Question

**What goes wrong:**
Mobile networks drop constantly — metro, lift, building entry. When a participant's
WebSocket disconnects mid-question and reconnects, the Supabase Realtime channel
re-subscribes but receives no replay of past events. The participant rejoins into
a void: they don't know the current question, the timer state, or whether they
already answered. The client shows a stale or empty screen.

**Why it happens:**
- Supabase Realtime uses WebSocket, which is a stateful transport
- Broadcast channel messages are fire-and-forget — no message queue, no replay
- `supabase-js` automatically attempts to reconnect the WebSocket, but channel
  re-subscription happens after reconnect and no historical events are re-sent
- `CHANNEL_ERROR` and `CLOSED` states in the channel subscription must be handled
  explicitly; by default the client sits in an error state

**Warning signs:**
- Participant reports "blank screen" after phone screen turned off
- Participant is in lobby but never sees first question
- `onopen`/`onclose` WebSocket events in browser devtools show repeated reconnects

**Prevention strategy:**
1. **Always store last-known game state in React state and re-render from it on
   reconnect.** The client should have: `currentQuestionIndex`, `q_started_at`,
   `timeLimit`, `myAnswer`. This survives a channel drop.
2. **On channel reconnect (`status === 'SUBSCRIBED'` fires again), immediately
   fetch current game state from the database** — a `quiz_sessions` row with
   `current_question_index`, `phase`, `q_started_at`. This is the source of truth.
   ```js
   channel.subscribe((status) => {
     if (status === 'SUBSCRIBED') {
       fetchCurrentQuizState(sessionId).then(applyState);
     }
   });
   ```
3. **Use Presence for "am I connected?" detection.** Admin panel should show a
   connected-count badge backed by Presence so it's obvious when participants drop.
4. **Implement a visible reconnect banner** in the participant UI:
   "Reconnecting… please wait" — prevents participants from panicking and refreshing,
   which resets all local state.
5. **Session state in DB, not only in broadcast.** The `quiz_sessions` table should
   always reflect the live state: `current_question_index`, `phase` (`lobby`,
   `question`, `feedback`, `finished`), `q_started_at`. Participants fetch this on
   mount AND on every reconnect. Broadcast is the fast path; DB is the recovery path.
6. **Handle the edge case where the participant reconnects during the feedback
   screen:** they should see "you answered X" or "you didn't answer" based on their
   row in the `answers` table, not broadcast state.

**Phase to address:** Realtime integration phase. Design DB schema with recovery
in mind from day one — retrofitting is expensive.

**Confidence:** HIGH — reconnection handling is a documented challenge in Supabase
Realtime; the pattern above matches official Supabase guidance.

---

### Pitfall 4: Race Conditions — Duplicate Answers and Late Submissions

**What goes wrong:**
Two race conditions exist in the current codebase and will be amplified by the backend:

**Race A — Duplicate answers:**
A participant taps an answer. The UI sets `answered = true` locally. The `INSERT INTO
answers` call goes out. Before the response returns, the participant (impatient, or on
a slow connection) taps again. The second tap fires while `answered` is still optimistically
set to `true` in state, but the first DB write hasn't completed yet, so the second
tap either passes through (if the state hasn't updated) or is blocked. On a slow
network, two inserts can both land.

CONCERNS.md already notes this: "No Duplicate Answer Prevention" — only a client-side
flag, no DB transaction.

**Race B — Late submissions after timeout:**
The admin fires `next_question` broadcast. Some participants with slow connections
receive this event 1–2 seconds late. During that window they can still submit an
answer for the previous question — the client hasn't locked the UI yet. Their answer
arrives in the DB after the question ended.

**Why it happens:**
- Network latency is asymmetric: admin → Supabase → participant varies per device
- Client-side `answered` flag is not atomic
- No server-side enforcement of the time window

**Consequences:**
- Scores inflated (participant gets answer recorded twice, or answers after time)
- DB contains duplicate rows → leaderboard calculations wrong
- Scoring disputes during the event

**Warning signs:**
- `answers` table contains two rows with same `(session_id, participant_id, question_id)`
- Score totals don't match expected max
- Participants complain answers weren't recorded (due to unique constraint violation
  on the second attempt if you add the constraint)

**Prevention strategy:**
1. **Add a unique constraint on `(session_id, participant_id, question_id)` in the
   `answers` table.** This is the single most important database-level protection.
   ```sql
   ALTER TABLE answers
     ADD CONSTRAINT answers_unique_per_question
     UNIQUE (session_id, participant_id, question_id);
   ```
   Use `INSERT ... ON CONFLICT DO NOTHING` from the client to handle this gracefully.
2. **Server-side time validation:** Each answer insert should be checked against
   `q_started_at + time_limit` in a Postgres trigger or RLS check. Reject inserts
   where `NOW() > q_started_at + INTERVAL 'time_limit seconds'`.
   ```sql
   -- In a trigger or RLS policy:
   CHECK (submitted_at <= q_started_at + (time_limit_seconds * INTERVAL '1 second'))
   ```
3. **Disable the answer buttons immediately on first tap** — optimistic UI lock —
   then confirm with DB response. If the DB insert fails (conflict), show "already
   recorded" rather than allowing a second tap.
4. **RLS policy for answers:** participants should only be able to INSERT (not UPDATE
   or DELETE) their own answers. The unique constraint handles the rest.
5. For late submissions, add a `grace_period_ms: 500` on the server to account for
   legitimate in-flight answers that were tapped before the cutoff but arrived slightly
   late. Beyond that, reject.

**Phase to address:** DB schema phase (unique constraint) + Realtime integration phase
(optimistic UI lock + server time validation).

**Confidence:** HIGH — duplicate-answer race is a known pattern in quiz apps; the
unique-constraint fix is standard SQL.

---

### Pitfall 5: PWA + WebSocket — Service Worker Interference

**What goes wrong:**
The app uses `vite-plugin-pwa` with a service worker (SW). Service workers intercept
all network requests. If the SW is configured to cache `fetch` events broadly (e.g.,
Workbox's `StaleWhileRevalidate` on all routes), it can intercept the HTTP upgrade
request that establishes the Supabase WebSocket connection. This causes the upgrade
to fail silently or return a cached 101 response that is invalid. The WebSocket never
connects; the participant sees the lobby forever.

A second, more common problem: after a PWA update, the old service worker is still
controlling the page while the new one waits. The new SW has new Supabase client code.
The old SW may have cached a stale `supabase-js` bundle. The user is running mismatched
versions of the realtime client and the rest of the app.

CONCERNS.md notes: "No Offline Support (Despite PWA Config)" — vite-plugin-pwa is
configured but not functional. This is actually partially protective right now —
but once a real SW is added, this pitfall becomes active.

**Warning signs:**
- WebSocket connection fails only on first visit after install as PWA
- Supabase client initializes but `subscribe()` callback never fires `SUBSCRIBED`
- Browser devtools shows WebSocket connection blocked or returning HTTP 200 instead of 101
- After PWA update deployment, some users have stale app behaviour

**Prevention strategy:**
1. **Explicitly exclude WebSocket and Supabase API routes from SW caching.**
   In `vite.config.js` with Workbox:
   ```js
   // vite.config.js
   VitePWA({
     workbox: {
       navigateFallback: '/index.html',
       runtimeCaching: [],          // no runtime caching
       globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
       // Supabase WebSocket and REST go through the network, not cache
     }
   })
   ```
   WebSocket connections (`wss://`) are never intercepted by service workers —
   the WS upgrade handshake is excluded from SW fetch interception by spec.
   However, the initial Supabase REST calls (auth, schema introspection) that happen
   before the WS upgrade CAN be cached. Exclude `*.supabase.co` entirely:
   ```js
   navigateFallbackDenylist: [/^https:\/\/.*\.supabase\.co/]
   ```
2. **Use `skipWaiting: false` and `clientsClaim: false`** during development to avoid
   stale SW issues. Only enable `skipWaiting: true` after thorough testing.
3. **Show an "Update available — tap to refresh" prompt** using the `useRegisterSW`
   hook from `vite-plugin-pwa`. Force reload when a new SW activates to avoid
   version mismatches during an active quiz.
4. **Test PWA install explicitly** before the event: install the app to homescreen on
   Android Chrome, kill and reopen it, verify WebSocket connects.
5. **Add SW scope restriction** — scope the SW to `/` only, which is the default;
   ensure no `scope: '/quiz'` misconfiguration that would leave the root uncontrolled.

**Phase to address:** PWA hardening phase (or early in Realtime integration phase,
before any SW is made functional). Do not enable offline caching until WebSocket
behaviour under the SW is confirmed working.

**Confidence:** MEDIUM — WebSocket URLs (`wss://`) are exempt from SW fetch
interception by spec (HIGH confidence on that specific fact), but REST calls to
Supabase before WS upgrade can be cached unexpectedly (MEDIUM). The SW version-
mismatch problem is HIGH confidence — well-documented in PWA literature.

---

### Pitfall 6: RLS Mistakes — Blocking Participants or Leaking Data

**What goes wrong:**
Row Level Security is disabled by default on Supabase tables. When you enable it,
all access is denied unless you explicitly add policies. The common sequence for a
first-time Supabase developer:

1. Enable RLS on `answers` table
2. Add policy: `authenticated role can INSERT their own answers`
3. Participants can't insert — because participants use `anon` key (not authenticated)
4. Developer adds: `anon role can INSERT` — now **anyone** can write answers for
   anyone else without being a participant
5. Admin queries all answers — blocked because admin is `authenticated` but the
   SELECT policy only allows `service_role`

This back-and-forth produces either a completely open table (RLS enabled but policy
`true` for all) or one that silently blocks legitimate operations.

A second common mistake is enabling RLS on `quiz_sessions` with a policy that only
the session owner can read — participants can't fetch current game state on reconnect.

A third mistake: RLS policies that use `auth.uid()` when participants log in as
`anon` (no Supabase Auth account). `auth.uid()` returns `null` for anon users —
the policy evaluates to `false`, blocking all access.

**Warning signs:**
- `INSERT INTO answers` returns `0 rows affected` with no error (RLS silent deny)
- Participants can join but their name never appears in admin participant list
- On reconnect, `fetchCurrentQuizState()` returns empty — participant can't recover
- Admin leaderboard shows 0 answers even though participants answered

**Prevention strategy:**
1. **Design RLS policies before writing application code.** Write them in SQL,
   test them with `SET ROLE anon` in the Supabase SQL editor.
2. **Use a `session_token` approach for anon participants** instead of relying on
   `auth.uid()`. When a participant joins, generate a UUID and store it in their
   browser (`sessionStorage`). Pass it as a custom JWT claim or use it as a column
   in the `participants` table. RLS can check `participant_id = requesting_participant`:
   ```sql
   -- answers: participant can only insert their own answer
   CREATE POLICY "participant_insert_own_answer" ON answers
     FOR INSERT TO anon
     WITH CHECK (
       participant_id IN (
         SELECT id FROM participants
         WHERE session_token = current_setting('request.jwt.claims', true)::json->>'session_token'
       )
     );
   ```
   Simpler alternative: use Supabase Auth anonymous sign-in (available since 2023),
   which gives each participant a real `auth.uid()` without requiring email/password.
3. **Never use `TO public` policies on answer tables.** Explicitly name the role.
4. **Separate read and write policies:**
   - `answers`: anon INSERT (own only), service_role SELECT (for admin scoring)
   - `participants`: anon INSERT (self), authenticated SELECT (for admin panel)
   - `quiz_sessions`: anon SELECT (current state), authenticated INSERT/UPDATE (admin)
   - `questions`: anon SELECT (during active session only, optionally scoped by session)
5. **Test every policy with `curl`** using the anon key (no Authorization header)
   to confirm it behaves as expected. Do this before any UI work.
6. **Never expose the `service_role` key in the frontend.** All admin operations
   that need to bypass RLS should go through a Supabase Edge Function that runs
   with service-role credentials server-side.

**Phase to address:** DB schema and RLS design phase — must be done before any
participant-facing feature is built. Retrofitting RLS on populated tables is painful.

**Confidence:** HIGH — RLS misconfiguration is the most commonly cited Supabase
pitfall in the community. The `auth.uid() = null` for anon users is a documented
source of confusion.

---

### Pitfall 7: Supabase Auth Session Expiry During Long Quiz

**What goes wrong:**
Supabase Auth JWTs expire after 1 hour by default. The admin (and, if Auth is used
for participants, each participant) gets a JWT that expires during the event. When
the token expires, Supabase JS automatically tries to refresh it using the stored
refresh token. This refresh triggers a network request — fine in normal apps, but
during a quiz event it means:

- The admin's `supabase.channel().subscribe()` drops and re-subscribes with the new
  token, introducing a brief gap in Realtime coverage
- If the refresh fails (network hiccup), the admin is silently de-authenticated;
  subsequent DB writes fail
- If participants use Auth, a mass token refresh from 500 clients at approximately
  the same time (they all logged in at the same time) creates a thundering-herd
  on the Supabase auth server

The admin session is particularly dangerous: if their JWT expires mid-quiz and the
silent refresh fails, they can no longer advance questions. The quiz freezes.

**Warning signs:**
- Admin panel stops working exactly ~60 minutes after the event started
- Realtime channel drops and never re-subscribes for the admin
- Console error: `JWT expired` or `Invalid JWT` on Supabase calls
- Participants see "reconnecting" at the same time (~60 min mark)

**Prevention strategy:**
1. **Extend JWT expiry for the admin session.** In Supabase project settings →
   Auth → JWT expiry — increase from 3600s to at least 14400s (4 hours). This
   covers the entire event with margin.
2. **Monitor auth state explicitly in the admin component:**
   ```js
   supabase.auth.onAuthStateChange((event, session) => {
     if (event === 'TOKEN_REFRESHED') {
       // re-subscribe Realtime channels with new token if needed
     }
     if (event === 'SIGNED_OUT') {
       showAdminReauthModal(); // block UI, demand re-login before allowing actions
     }
   });
   ```
3. **For participants using anonymous auth** (recommended), their tokens also expire.
   Use the same `onAuthStateChange` pattern to silently refresh. The thundering-herd
   problem is mitigated because `supabase-js` staggers refresh attempts with jitter.
4. **Do not use custom JWT expiry shorter than the event duration.** Default 1 hour
   is too short for a 90-minute quiz.
5. **Persist the admin session to `localStorage`** (Supabase does this by default with
   `persistSession: true`). Verify this is not overridden in `src/lib/supabase.js`.
   CONCERNS.md shows that the current demo mode clears session on logout — ensure
   production mode does not clear prematurely.
6. **Keep a "heartbeat" mechanism:** Every 15 minutes, the admin client calls a
   lightweight RPC (e.g., `supabase.rpc('ping')`) which implicitly triggers a
   token refresh check. This keeps the session warm.

**Phase to address:** Supabase Auth integration phase. Also add a pre-event checklist
item: "Verify JWT expiry setting before event day."

**Confidence:** HIGH — JWT expiry during long sessions is a documented Supabase issue;
the 1-hour default and thundering-herd effect are well-known.

---

### Pitfall 8: Split-Brain — Admin Advances Question Before All Clients Receive Event

**What goes wrong:**
The admin presses "Next question". A Broadcast message goes out: `{ type: 'NEXT_QUESTION',
index: 3, q_started_at: ... }`. Due to WebSocket message propagation latency, some
participants receive this message 500ms–2s after others. During that window:

- Participant A (fast connection): sees Question 3, timer starts
- Participant B (slow connection): still on Question 2, timer still running
- Participant B taps an answer for Q2 — this insert now races with the state change
- Participant B receives NEXT_QUESTION 1.5s later, jumps to Q3, but their Q2 answer
  may or may not have been recorded (see Pitfall 4)

A more severe variant: the admin advances to Question 4, but Participant C's connection
was in the middle of a reconnect. They receive NEXT_QUESTION for index 4 without ever
having seen NEXT_QUESTION for index 3. They missed a question entirely — should they
get 0 points for it, or should the system fill in a null answer?

**Why it happens:**
- Broadcast is eventually consistent, not strongly consistent
- No acknowledgement mechanism in Supabase Broadcast
- Client state is derived entirely from received events (event-sourced), with no
  periodic state sync

**Warning signs:**
- Admin advances, but ~10% of participants still show old question 3 seconds later
- Leaderboard shows 0 answers for a question that participants claim they answered
- Participant count on question differs significantly from participant count in lobby

**Prevention strategy:**
1. **Persist game state to the database, not only via Broadcast.** The `quiz_sessions`
   table must be the source of truth:
   ```sql
   -- quiz_sessions table
   current_question_index INTEGER,
   phase TEXT,            -- 'lobby' | 'question' | 'feedback' | 'finished'
   q_started_at TIMESTAMPTZ,
   time_limit_seconds INTEGER
   ```
   The admin's "Next Question" action UPDATES this row first, then emits the Broadcast.
   Participants with slow connections who miss the broadcast will catch up when they
   next poll/reconnect.
2. **On every Realtime reconnect, refetch DB state** (see Pitfall 3 strategy).
   This is the primary recovery mechanism for split-brain.
3. **Add a periodic state-sync poll** as a safety net. Every 5 seconds, participants
   check their local `currentQuestionIndex` against the value in `quiz_sessions`. If
   they differ, jump to the correct state. This is a cheap SELECT on a single row.
   ```js
   useEffect(() => {
     const interval = setInterval(async () => {
       const { data } = await supabase
         .from('quiz_sessions')
         .select('current_question_index, phase, q_started_at')
         .eq('id', sessionId)
         .single();
       if (data.current_question_index !== localIndex) {
         syncToServerState(data);
       }
     }, 5000);
     return () => clearInterval(interval);
   }, [sessionId, localIndex]);
   ```
4. **Add a "transition buffer" on the admin side.** When the admin presses Next,
   show a 1-second countdown ("3…2…1…") before emitting the event. This gives
   slow clients time to finish processing the previous event before the new one lands.
5. **Handle the "missed question" case explicitly:** when a participant reconnects and
   the server is on question index N but the client was on index N-2, insert null
   answers for the skipped questions automatically. This keeps the scoring data clean.
6. **Do not rely on Broadcast ordering guarantees for critical state.** Broadcast
   messages may be reordered. Use the `current_question_index` from the DB row as the
   canonical index — if a Broadcast event has a lower index than what the DB says,
   discard it as stale.

**Phase to address:** Realtime architecture phase (schema design must include
`quiz_sessions` state fields). This is architectural — cannot be bolted on later.

**Confidence:** HIGH — eventual consistency in Broadcast is documented Supabase
behaviour; the DB-as-source-of-truth + Broadcast-as-fast-path pattern is the
standard mitigation.

---

## Moderate Pitfalls

---

### Pitfall 9: Answer Recording Not Awaited Before UI Advance

**What goes wrong:**
CONCERNS.md already identifies this: `saveAttempt` is async but not awaited. The
UI advances to the feedback screen immediately. If the Supabase insert fails (network
error, RLS deny), the answer is lost silently. The participant sees "2 points earned"
but the DB has no record of their answer.

**Prevention:**
- Await the `INSERT INTO answers` before showing feedback
- If insert fails, show an error and let the participant retry (within the time window)
- Add a unique constraint (see Pitfall 4) so a retry is safe
- Log failed inserts to `localStorage` as a fallback audit trail

**Phase to address:** Supabase integration phase, answer submission feature.

**Confidence:** HIGH — directly evidenced in CONCERNS.md.

---

### Pitfall 10: Score Computed Client-Side — Tamperable

**What goes wrong:**
CONCERNS.md identifies this: `calcPts` runs in the browser. A participant can open
devtools, call `calcPts(0)` with a zero elapsed time and get maximum points. For a
competitive academic quiz this is a real cheating vector.

**Prevention:**
- Store raw answer data (`question_id`, `chosen_option`, `submitted_at`) in the DB
- Compute scores server-side in a Postgres function or Edge Function after the quiz ends
- Use `q_started_at` (from the DB row, not the client) for timing calculations
- Compare server-computed score to client-reported score; flag large discrepancies

**Phase to address:** Scoring architecture phase. The DB schema must store submitted_at
and the server must own score computation.

**Confidence:** HIGH — directly evidenced in CONCERNS.md.

---

### Pitfall 11: Questions Exposed Before They Should Be

**What goes wrong:**
If `questions` table RLS allows anon SELECT without condition, a participant could
query all 32 questions before the quiz starts. This is an academic integrity issue
for a scored competition.

**Prevention:**
- RLS policy on `questions`: anon can only SELECT questions where
  `question_index <= (SELECT current_question_index FROM quiz_sessions WHERE id = $1)`
  — i.e., only questions that have already been shown
- Alternatively, serve questions via an Edge Function that validates the current
  quiz phase before returning question text
- Never send all 32 questions to the client at mount time; send one at a time as the
  admin advances

**Phase to address:** DB schema + RLS design phase.

**Confidence:** MEDIUM — standard competitive quiz requirement; RLS scoping to
current question index is a pattern specific to this use case.

---

## Minor Pitfalls

---

### Pitfall 12: Timer Goes Negative (Existing Bug)

Already identified in CONCERNS.md. The `setInterval` in `App.jsx` lines 177–189
does not check `t <= 0`. In a connected Supabase environment, this is compounded
by Pitfall 1 — the timer might go negative on a slow phone if q_started_at drift
is large.

**Prevention:** Fix immediately: `if (t <= 1) { clearInterval(id); onExpire(); return; }`
Also switch to server-anchored timer (Pitfall 1 fix subsumes this).

**Phase:** First real-time integration PR — trivial fix, zero reason to defer.

---

### Pitfall 13: Module Transition Logic Uses Array Index (Existing Bug)

CONCERNS.md: `advanceQuestion` uses array index matching. With questions from the DB
(not hardcoded), the array structure may differ.

**Prevention:** Use a `module_id` foreign key on questions, not positional index.
Query by `module_id` and `order_within_module` columns.

**Phase:** DB schema design phase.

---

### Pitfall 14: Supabase Client Singleton Not Enforced

If `supabase.js` is imported in multiple places and the module isn't cached (e.g.,
in a Vite HMR scenario), two Supabase client instances can be created. Each opens
its own WebSocket. Channel subscriptions get doubled; events are processed twice.

**Prevention:**
```js
// src/lib/supabase.js — enforce singleton
let _client = null;
export function getSupabaseClient() {
  if (!_client) _client = createClient(url, key, opts);
  return _client;
}
```
Or rely on ES module caching (standard JS module system guarantees this in production
Vite builds, but HMR can bypass it).

**Phase:** Supabase client setup (first day of integration work).

---

### Pitfall 15: Presence Overhead at Scale

Supabase Presence syncs a full state object for every connected client to every other
connected client. With 500 participants in the same channel, every join/leave event
fans out to all 499 others — O(n²) message volume.

**Prevention:**
- Do NOT use Presence for quiz-sync channels with 500 participants
- Use Presence only for the admin panel (which has 1–5 connections) to show live
  participant count
- For participant-count display, use a DB aggregate: `COUNT(*) FROM participants
  WHERE session_id = X AND connected_at > NOW() - INTERVAL '30 seconds'`
- Use Broadcast (fire-and-forget, no state sync overhead) for question events

**Phase:** Architecture design phase — must influence channel topology design.

---

## Phase-Specific Warning Summary

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| DB schema design | RLS blocks participants silently (P6) | Write and test RLS before any UI |
| DB schema design | Questions readable before quiz (P11) | RLS scope to current_question_index |
| DB schema design | Duplicate answers (P4) | Unique constraint on (session, participant, question) |
| DB schema design | Split-brain recovery impossible (P8) | quiz_sessions must store current_question_index + q_started_at |
| Supabase client setup | Double WebSocket from HMR (P14) | Singleton client pattern |
| Supabase Auth integration | Admin session expires mid-quiz (P7) | Extend JWT expiry, onAuthStateChange handler |
| Realtime integration | Timer drift, unfair scoring (P1) | Server-anchored timer from q_started_at |
| Realtime integration | Reconnect leaves participant stranded (P3) | Fetch DB state on every SUBSCRIBED event |
| Realtime integration | Split-brain on slow connections (P8) | 5s poll + DB as source of truth |
| Realtime integration | Late/duplicate answers (P4) | Optimistic UI lock + server time validation |
| Answer submission | saveAttempt not awaited (P9) | Await insert; retry on failure |
| Scoring | Client-side score tampered (P10) | Server-side scoring after quiz ends |
| Scale / infra | Free tier 200-connection limit (P2) | Load test; upgrade to Pro for event day |
| PWA hardening | Service worker caches Supabase calls (P5) | Exclude *.supabase.co from SW cache |
| PWA hardening | SW version mismatch mid-quiz (P5) | Show "Update available" prompt, force reload |
| Pre-event | Presence overhead at 500 clients (P15) | Broadcast for events; Presence only for admin |

---

## Sources and Confidence

| Area | Confidence | Basis |
|------|------------|-------|
| Timer drift (P1) | HIGH | Universal JS timing problem; well-documented |
| Free tier limits (P2) | MEDIUM | Training data Aug 2025; numbers change — VERIFY at supabase.com/pricing |
| WS reconnection (P3) | HIGH | Supabase JS channel lifecycle is documented; pattern is standard |
| Race conditions (P4) | HIGH | Directly evidenced in CONCERNS.md; SQL unique constraint is standard |
| PWA + WS (P5) | MEDIUM | WS exempt from SW fetch by spec (HIGH); REST caching side-effect (MEDIUM) |
| RLS mistakes (P6) | HIGH | Most commonly cited Supabase pitfall; anon uid() = null is documented |
| Auth session expiry (P7) | HIGH | 1-hour default JWT is documented; thundering-herd is known |
| Split-brain (P8) | HIGH | Broadcast eventual consistency is documented; DB-first pattern is standard |
| Unsawaited saves (P9) | HIGH | Directly evidenced in CONCERNS.md |
| Client-side scoring (P10) | HIGH | Directly evidenced in CONCERNS.md |
| Question exposure (P11) | MEDIUM | Standard quiz integrity requirement; RLS approach is sound |

**Action required before going to production:**
Verify Supabase free-tier concurrent connection limit at https://supabase.com/pricing.
If the limit is below 500 (likely), budget for Pro tier upgrade on event day.
