# Architecture Patterns: FUE Quiz Real-Time System

**Domain:** Real-time synchronized quiz platform (Kahoot-style)
**Researched:** 2026-04-23
**Confidence:** HIGH (Supabase JS SDK v2 API confirmed from package.json + SDK source patterns; React 18 hook patterns from training data within cutoff)

---

## Recommended Architecture

### Overview

The target architecture separates concerns into four distinct layers:

```
Browser (React 18 SPA)
├── screens/          ← One file per screen, pure UI + local form state
├── hooks/            ← Domain hooks owning all async/realtime logic
├── lib/              ← Supabase client + thin API wrappers (already exists)
└── data/             ← Static questions, MODULES, CITIES (already exists)

Supabase Cloud
├── Auth              ← Admin email/password login (Supabase Auth)
├── Database          ← sessions, participants, answers, questions tables
└── Realtime
    ├── Broadcast     ← Admin → all participants (quiz state: question, timer start, reveal)
    └── Postgres Changes → Admin dashboard (answers table: live leaderboard updates)
```

### Component Boundaries

| Layer | Files | Responsibility | Communicates With |
|-------|-------|---------------|-------------------|
| Entry | `main.jsx`, `App.jsx` | Route/screen dispatch, auth gate | screens/ via props |
| Screens | `screens/WelcomeScreen.jsx` etc. | UI rendering, local form state | hooks/ via custom hooks |
| Hooks | `hooks/useSession.js` etc. | Channel subscriptions, DB calls, derived state | lib/supabase.js |
| Library | `lib/supabase.js` | Supabase client, CRUD wrappers | Supabase Cloud |
| Data | `data/questions.js` | Static content (until DB migration) | screens/ directly |

---

## Supabase Realtime Architecture

### Channel Strategy

Two channel types serve distinct purposes — use the right one for each data flow.

**Broadcast channels** (admin → participants, no DB write):
- Purpose: Push quiz control events to all connected clients instantly
- Latency: ~100ms, no persistence, fire-and-forget
- When to use: Question reveal, timer synchronization, show feedback, advance to next question
- Channel naming convention: `quiz:SESSION_CODE` (e.g. `quiz:847293`)
  - Namespaced with `quiz:` prefix to avoid collisions with other channels
  - SESSION_CODE is the 6-digit join code, not the internal UUID

```javascript
// Admin sends (one sender)
const channel = supabase.channel(`quiz:${sessionCode}`)
channel.send({
  type: 'broadcast',
  event: 'quiz_state',
  payload: {
    type: 'question',       // | 'reveal' | 'next_module' | 'ended'
    questionIdx: 3,
    moduleId: 2,
    timerStart: Date.now(), // absolute timestamp for timer sync across devices
    timePerQ: 30,
  }
})

// Participants receive (many receivers)
supabase.channel(`quiz:${sessionCode}`)
  .on('broadcast', { event: 'quiz_state' }, ({ payload }) => {
    // update local React state
  })
  .subscribe()
```

**Postgres Changes** (DB → admin dashboard, persisted):
- Purpose: Admin sees answer count and score updates as participants submit
- When to use: Live leaderboard on admin panel only — not on participant screens
- Performance note: Postgres Changes fires a change event per row INSERT, so at 100 participants answering simultaneously, the admin will receive up to 100 events in a burst. This is within Free tier limits (~500 connections, no stated message rate limit on v2).

```javascript
// Admin only — subscribe to new answers in this session
supabase.channel(`leaderboard:${sessionId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'answers',
    filter: `session_id=eq.${sessionId}`,
  }, (payload) => {
    // Update leaderboard state: payload.new = { user_id, question_id, score, ... }
  })
  .subscribe()
```

### Why NOT use Postgres Changes for quiz state sync

Postgres Changes requires a DB write to trigger, adding 50-200ms round-trip latency per event and unnecessary DB load. For quiz state (advance question, show reveal), Broadcast is correct: admin writes nothing to DB, participants react immediately, timer stays synchronized.

### Timer Synchronization Pattern

The critical problem with distributed timers is clock drift between devices. The recommended pattern:

1. Admin sends `timerStart: Date.now()` (Unix ms) in the Broadcast payload
2. Participants compute `remainingMs = (timerStart + timePerQ * 1000) - Date.now()`
3. Participants start their local countdown from `remainingMs`, not from `timePerQ`
4. This corrects for network latency and device clock skew automatically

This replaces the current `timer` state (a simple countdown) with a deadline-based timer.

---

## Database Schema

### Current Tables (from supabase.js analysis)

The existing code implies three tables. These need to be formalized and extended.

### Recommended Schema

```sql
-- Admin accounts (managed by Supabase Auth, no separate table needed)
-- profiles table stores extra fields for auth users

CREATE TABLE profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id),
  full_name   text NOT NULL,
  city        text,            -- NULL for admins
  university  text,
  role        text NOT NULL DEFAULT 'participant', -- 'participant' | 'city_admin' | 'global_admin'
  verified    boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

-- One row per quiz event (I etap per city, or finał)
CREATE TABLE quiz_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code    char(6) UNIQUE NOT NULL,  -- 6-digit code participants enter
  stage        text NOT NULL,            -- 'regional' | 'final'
  city         text,                     -- NULL for final stage
  status       text NOT NULL DEFAULT 'waiting', -- 'waiting' | 'active' | 'finished'
  current_module    int DEFAULT 1,
  current_question  int DEFAULT 0,
  created_by   uuid REFERENCES profiles(id),
  created_at   timestamptz DEFAULT now(),
  finished_at  timestamptz
);

-- Participants who joined a session (not all registered users)
CREATE TABLE participants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES quiz_sessions(id),
  user_id     uuid REFERENCES profiles(id),  -- NULL if anonymous (future)
  joined_at   timestamptz DEFAULT now(),
  UNIQUE(session_id, user_id)
);

-- One row per answer submitted (not per attempt)
CREATE TABLE answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES quiz_sessions(id),
  user_id      uuid NOT NULL REFERENCES profiles(id),
  question_id  text NOT NULL,   -- matches questions.js id field (e.g. 'm1q1')
  module_id    int NOT NULL,
  picked       int,             -- NULL = timeout, 0-3 = answer index
  correct      boolean NOT NULL,
  score        int NOT NULL DEFAULT 0,
  answered_at  timestamptz DEFAULT now()
);

-- Questions from DB (replaces hardcoded questions.js in v2+)
CREATE TABLE questions (
  id         text PRIMARY KEY,  -- e.g. 'm1q1'
  module_id  int NOT NULL,
  question   text NOT NULL,
  options    jsonb NOT NULL,    -- string[]
  answer     int NOT NULL,      -- 0-3
  explanation text,
  time_per_q int NOT NULL DEFAULT 30,
  sort_order  int NOT NULL DEFAULT 0
);
```

**Key design decisions:**

- `join_code` on `quiz_sessions` (not on profiles) — 6-digit code is per session, not per user. Admin generates a new code for each event.
- `answers` table stores one row per question per participant, not one row per attempt. This enables Postgres Changes leaderboard updates as answers arrive, not only at quiz end.
- `participants` table tracks who joined a session. Needed because not every registered user participates in every session (I etap filters by city).
- Questions stay in `questions.js` for Phase 1 (already works). Migrate to DB in a later phase when CRUD admin panel is built.

---

## React Hook Patterns

### Hooks to Create

Each hook owns one domain. Props flow down, events bubble up through callbacks.

**`useAuth()` — authentication state**

Owns: current user object, loading state, login/register/logout actions.
Lives in: App.jsx or a top-level AuthProvider context.
Does NOT own: quiz state, channel subscriptions.

```javascript
// hooks/useAuth.js
export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser().then((u) => { setUser(u); setLoading(false); });
    // Subscribe to Supabase auth state changes (handles session expiry)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) { setUser(null); return; }
      // re-fetch profile on auth change
    });
    return () => subscription.unsubscribe();
  }, []);

  return { user, loading, login, logout, register };
}
```

**`useSession(sessionCode)` — real-time quiz session**

Owns: Broadcast channel subscription, quiz state (currentQuestion, currentModule, timerDeadline, phase), participant answer submission.
Takes: `sessionCode` string (the 6-digit join code).
Does NOT own: user identity, leaderboard data.

```javascript
// hooks/useSession.js
export function useSession(sessionCode) {
  const [quizState, setQuizState] = useState(null); // { type, questionIdx, moduleId, timerDeadline }
  const [myAnswers, setMyAnswers] = useState([]);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!sessionCode) return;
    const channel = supabase.channel(`quiz:${sessionCode}`)
      .on('broadcast', { event: 'quiz_state' }, ({ payload }) => {
        setQuizState(payload);
      })
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [sessionCode]);

  const submitAnswer = async ({ questionId, moduleId, picked, correct, score, sessionId, userId }) => {
    setMyAnswers((prev) => [...prev, { questionId, picked, correct, score }]);
    await insertAnswer({ sessionId, userId, questionId, moduleId, picked, correct, score });
  };

  return { quizState, myAnswers, submitAnswer };
}
```

**`useTimer(deadline)` — countdown from absolute timestamp**

Owns: remaining seconds display, timeout detection.
Takes: `deadline` (Unix ms timestamp when timer expires).
Returns: `{ secondsLeft, isExpired }`.
Does NOT own: quiz flow control (calls `onExpire` callback instead).

```javascript
// hooks/useTimer.js
export function useTimer(deadline, onExpire) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!deadline) return;
    firedRef.current = false;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
    };
    tick();
    const id = setInterval(tick, 200); // 200ms for smooth display without drift
    return () => clearInterval(id);
  }, [deadline]);

  return { secondsLeft, isExpired: secondsLeft === 0 };
}
```

**`useLeaderboard(sessionId)` — admin live scores**

Owns: Postgres Changes subscription on `answers` table, score aggregation, sorted ranking.
Used only by: AdminPanel screen.
Does NOT own: quiz control events.

```javascript
// hooks/useLeaderboard.js
export function useLeaderboard(sessionId) {
  const [entries, setEntries] = useState([]); // [{ userId, name, city, totalScore, answeredCount }]

  useEffect(() => {
    if (!sessionId) return;
    // Initial fetch
    getSessionAttempts(sessionId).then(setEntries);
    // Live updates
    const channel = supabase.channel(`leaderboard:${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'answers',
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        setEntries((prev) => {
          // Upsert score for this user
          const userId = payload.new.user_id;
          const existing = prev.find((e) => e.userId === userId);
          if (existing) {
            return prev.map((e) => e.userId === userId
              ? { ...e, totalScore: e.totalScore + payload.new.score, answeredCount: e.answeredCount + 1 }
              : e
            ).sort((a, b) => b.totalScore - a.totalScore);
          }
          return [...prev, { userId, totalScore: payload.new.score, answeredCount: 1 }]
            .sort((a, b) => b.totalScore - a.totalScore);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  return entries;
}
```

---

## App.jsx Refactoring Strategy

### Target File Structure

```
fue-quiz/src/
├── App.jsx                      ← Thin router only (~80 lines)
├── main.jsx                     ← Unchanged
├── screens/
│   ├── WelcomeScreen.jsx        ← lines 288–389 extracted
│   ├── RegisterScreen.jsx       ← lines 756–812 extracted (already isolated)
│   ├── LoginScreen.jsx          ← lines 816–855 extracted (already isolated)
│   ├── AdminLoginScreen.jsx     ← lines 859–889 extracted (already isolated)
│   ├── PendingScreen.jsx        ← lines 419–441 extracted
│   ├── LobbyScreen.jsx          ← lines 447–518 extracted
│   ├── ModuleIntroScreen.jsx    ← lines 521–545 extracted
│   ├── QuizScreen.jsx           ← lines 548–661 extracted
│   ├── FeedbackScreen.jsx       ← lines 664–694 extracted
│   ├── EndedScreen.jsx          ← lines 697–736 extracted
│   ├── AdminPanel.jsx           ← lines 956–1111 extracted (already isolated)
│   └── PodiumScreen.jsx         ← lines 1138–1205 extracted (already isolated)
├── hooks/
│   ├── useAuth.js
│   ├── useSession.js
│   ├── useTimer.js
│   ├── useLeaderboard.js
│   └── useWindowWidth.js        ← already defined in App.jsx line 24, just move it
├── lib/
│   └── supabase.js              ← Extend existing, do not rewrite
├── data/
│   └── questions.js             ← Unchanged
└── styles/
    └── global.css               ← Extract CSS string from App.jsx lines 36–96
```

### Refactoring Without Breaking — Step-by-Step Order

The safe extraction order respects the current prop-passing pattern.

**Step 1: Extract utilities and styles** (zero risk)
- Move `CSS` string to `styles/global.css`, import in `main.jsx`
- Move `W` object to `lib/styles.js`
- Move `calcPts`, `cityInfo`, `getModule`, `moduleQuestions` to `lib/utils.js`
- Move `useWindowWidth` to `hooks/useWindowWidth.js`
- No screen logic changes, just import paths

**Step 2: Extract already-isolated screen components** (low risk)
- `RegisterScreen`, `LoginScreen`, `AdminLoginScreen`, `AdminPanel`, `PodiumScreen`, `PracticeScreen`, `UserCard` are already defined as separate functions outside `App()` — they take no App-level state, only callbacks
- Cut from App.jsx, paste to `screens/`, add import at top of App.jsx
- Each file needs: `import { CITIES, MODULES } from '../data/questions.js'` and `import { W } from '../lib/styles.js'`

**Step 3: Extract inline screens from App()** (medium risk — these read App state directly)
- `WelcomeScreen`, `LobbyScreen`, `ModuleIntroScreen`, `QuizScreen`, `FeedbackScreen`, `EndedScreen`, `PendingScreen`
- These currently read `user`, `myPts`, `allAnswers`, `isDesktop` etc. directly from closure
- Pattern: convert captured variables to explicit props
  ```jsx
  // Before (captured from closure)
  if (screen === "lobby") return <div>...{user.fullName}...</div>

  // After (explicit props)
  if (screen === "lobby") return <LobbyScreen user={user} isDesktop={isDesktop} onStart={startQuiz} onLogout={handleLogout} />
  // In screens/LobbyScreen.jsx: function LobbyScreen({ user, isDesktop, onStart, onLogout })
  ```
- Do one screen at a time, verify in dev server between each

**Step 4: Extract React Router (optional, Phase 2+)**
- Current screen-state pattern works and is simpler for this use case (no deep-linking needed)
- React Router adds value only if: direct URL navigation to quiz join (`/join/847293`), admin panel at `/admin`, PWA offline fallback handling
- If added: use `createBrowserRouter` (React Router v6.4+), no `<Switch>`, use `loader` functions
- Decision: defer React Router until the join-code flow is built. URL-based join (`/join/:code`) is the main driver.

---

## Data Flow: Admin Controls → Participants React

```
ADMIN PANEL                    SUPABASE                    PARTICIPANT SCREENS
─────────────────────────────────────────────────────────────────────────────

1. Admin clicks "Start"
   └─ updateSession(id, {status:'active'})
      └─ quiz_sessions UPDATE ──────────────► (Postgres Changes, if admin watches)
   └─ channel.send({event:'quiz_state',     ──────────────► useSession receives
        type:'question', questionIdx:0,                     quizState, sets screen
        timerDeadline: Date.now()+30000})                   to "quiz"

2. Participant answers
   └─ submitAnswer(...)
      └─ answers INSERT ───────────────────────────────────► useLeaderboard on admin
                                                             updates score in real-time

3. Admin advances (or timer expires on all clients)
   └─ channel.send({event:'quiz_state',     ──────────────► useSession receives
        type:'reveal'})                                      FeedbackScreen shows

4. Admin clicks "Next question"
   └─ channel.send({event:'quiz_state',     ──────────────► QuizScreen renders next
        type:'question', questionIdx:1, ...})

5. All questions done
   └─ channel.send({event:'quiz_state',     ──────────────► EndedScreen shows
        type:'ended'})
   └─ updateSession(id, {status:'finished'})
```

**Critical: Who controls question advancement?**

The admin controls question timing, not individual participants finishing. This is the Kahoot model:
- Admin sees how many have answered (via leaderboard count) or uses a fixed timer
- Admin clicks "Next" OR the server timer expires (admin-side `setTimeout`)
- Admin broadcasts `next_question` to all participants simultaneously
- Participants do NOT auto-advance on their own timer expiry — they show "waiting for admin"

This prevents the race condition where fast participants and slow ones are on different questions.

**Timer expiry handling:**
- Admin: setTimeout fires → broadcast `type:'reveal'` → wait N seconds → broadcast `type:'question'` for next
- Participant: `useTimer(deadline)` fires `onExpire` → participant locally records timeout answer → screen shows "waiting" overlay until admin broadcasts next state

---

## State Management Layers

| State | Where Lives | Why |
|-------|------------|-----|
| Auth user (id, role, city) | `useAuth()` hook → React context | Needed globally, persists across screens |
| Active session (id, join_code, status) | `useSession()` hook | Changes via Broadcast or DB fetch |
| Current quiz state (question, module, timer) | `useSession()` hook via Broadcast | Ephemeral, no DB write needed |
| My answers this session | `useSession()` local state | Accumulates during quiz |
| My score (derived) | Derived in component from `myAnswers` | `myAnswers.reduce()` — no separate state |
| Leaderboard entries | `useLeaderboard()` hook | DB-driven, admin only |
| Screen routing | `App.jsx` `screen` state | Simple, no router overhead |
| Form state (registration, login) | Local `useState` in each screen | Never needs to escape the screen |
| isDesktop | `useWindowWidth()` hook | Used in many screens — pass as prop or context |

**What does NOT go in the Broadcast channel:**
- Answers (go to DB directly for persistence and leaderboard)
- User profiles (already in DB)
- Final scores (computed from DB at session end)

**What does NOT go in the DB:**
- Quiz state events (current question, timer) — too slow, use Broadcast
- Timer ticks — client-side only

---

## Suggested Build Order (Phase Implications)

### Phase 1: Structural Refactor (no backend changes)

Deliverable: App.jsx split into screens/ + hooks/, same behavior as today.

1. Extract `CSS` → `styles/global.css`, `W` → `lib/styles.js`, utils → `lib/utils.js`
2. Move `useWindowWidth` to `hooks/useWindowWidth.js`
3. Extract already-standalone screens (Register, Login, AdminLogin, AdminPanel, Podium, Practice)
4. Extract inline screens by converting closures to explicit props
5. Verify DEMO mode still works end-to-end

**Why first:** Every subsequent phase adds code to these files. Doing this first means features land in the right place from the start, not piled back into App.jsx.

### Phase 2: Supabase Auth + DB Schema

Deliverable: Real Supabase connection, sessions have join codes, participants table populated.

1. Apply DB schema (migrations or SQL editor)
2. Replace hardcoded `ADMIN_CODE` with Supabase Auth email/password for admins
3. Add `join_code` generation to `createSession()`
4. Implement `useAuth()` hook replacing the current Auth check in App.jsx
5. Participants enter 6-digit code on LobbyScreen to join a session
6. Keep DEMO mode for local dev

**Why second:** Auth is a prerequisite for everything. RLS policies need user identity. The join code flow is the new UX entry point.

### Phase 3: Real-Time Quiz Control

Deliverable: Admin broadcasts question → participants see it; answers go to DB.

1. Implement `useSession(sessionCode)` with Broadcast channel
2. Modify `AdminPanel` quiz tab: broadcast `quiz_state` events instead of calling `startQuiz()`
3. Modify `LobbyScreen` → `QuizScreen` flow: driven by `quizState` from Broadcast
4. Implement `useTimer(deadline)` replacing current interval-based timer
5. Submit answers to `answers` table (replaces `saveAttempt` at quiz end — write per answer instead)

**Why third:** Depends on Phase 2 schema. This is the core real-time feature.

### Phase 4: Live Leaderboard

Deliverable: Admin sees scores update as answers come in.

1. Implement `useLeaderboard(sessionId)` with Postgres Changes
2. Replace static "Wyniki" tab in AdminPanel with live leaderboard component
3. Add city aggregate view (GROUP BY city)
4. Connect PodiumScreen to real leaderboard data (replace `fakePodium` hardcoded data)

**Why fourth:** Depends on Phase 3's answers INSERT events. Leaderboard is read-only from the client perspective.

### Phase 5: Admin CRUD + Questions from DB

Deliverable: Admin can manage questions through the panel.

1. Add "Pytania" tab to AdminPanel with question list + add/edit/delete
2. Migrate `questions.js` data to `questions` table (one-time SQL import)
3. Load questions from DB in `useSession()` instead of static import
4. History of past sessions + archived results

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Writing Quiz State to DB on Every Tick

**What goes wrong:** Admin broadcasts current question by doing `updateSession({currentQuestion: N})` on every advance, relying on Postgres Changes to fan-out to participants.
**Why bad:** Postgres Changes adds 50-200ms latency per event, creates unnecessary DB writes, and causes thundering-herd reads when 100 participants poll simultaneously. On the Free tier, this could exhaust connection limits.
**Instead:** Broadcast channel for all ephemeral quiz state. DB write only at session start, session end, and per answer submitted.

### Anti-Pattern 2: One Channel Per Participant

**What goes wrong:** Each participant creates a private channel `quiz:SESSION_CODE:USER_ID` to receive their personal state.
**Why bad:** 100 channels per session, channel creation overhead, complex routing on admin side.
**Instead:** All participants subscribe to `quiz:SESSION_CODE`. Messages are broadcast to all. Answer submission goes to DB directly — no channel needed for that direction.

### Anti-Pattern 3: Keeping All Quiz Logic in App.jsx After Refactor

**What goes wrong:** Files are split into screens/ but quiz state (`currentMod`, `qIdx`, `timer`, `myPts`, `allAnswers`, `picked`, `answered`) stays in App.jsx and is passed 3+ levels deep.
**Why bad:** Every screen that needs quiz state requires prop drilling through intermediate components. Adding real-time makes this worse.
**Instead:** `useSession()` hook owns all quiz state. Screens import the hook directly, not from props.

### Anti-Pattern 4: Client-Side Timer as Source of Truth

**What goes wrong:** Each participant starts their own `setInterval` countdown from `timePerQ` when a question appears. When a participant answers, their answer is timestamped by their local timer value.
**Why bad:** 5-second network delay to one participant means they get 5 extra seconds. The timer score bonus is gameable by delaying the connection.
**Instead:** Admin includes `timerStart: Date.now()` in the Broadcast payload. All clients compute remaining time as `deadline - Date.now()`. Score is computed server-side from `(answered_at - broadcast_at)` or client sends `timerAtAnswer` that is validated against the deadline.

### Anti-Pattern 5: Polling for Quiz State

**What goes wrong:** Participants poll `getActiveSession()` every 2 seconds in a `useEffect` interval to check if the session has started or advanced.
**Why bad:** 100 participants × 1 request/2s = 50 DB reads/second sustained during quiz. Free tier has 500ms max response time under load. Polling also adds 0-2 second latency to state transitions.
**Instead:** Subscribe to Broadcast channel immediately on joining the session. The first `quiz_state` payload transitions from lobby to quiz.

### Anti-Pattern 6: Accessing supabase Client Directly in Screen Components

**What goes wrong:** `QuizScreen.jsx` imports `supabase` and calls `supabase.from('answers').insert(...)` directly inside an event handler.
**Why bad:** Supabase client details leak into UI layer. Hard to swap for DEMO mode, hard to test, hard to find all DB calls.
**Instead:** All Supabase operations go through `lib/supabase.js` functions or custom hooks. Screens only call hook functions (`submitAnswer(...)`) that internally delegate to `lib/`.

---

## Scalability Notes

| Concern | At 100 users (I etap) | At 500 users (all cities) | Notes |
|---------|----------------------|--------------------------|-------|
| Broadcast fan-out | Single channel, ~100 receivers | Single channel, ~500 receivers | Supabase handles this; Free tier supports 500 concurrent realtime connections |
| Answers INSERT rate | 100 rows/question × 8 questions/module | 500 rows/question | Burst pattern, not sustained. Postgres handles easily. |
| Leaderboard Postgres Changes | 100 events/burst on admin | 500 events/burst on admin | Admin receives all; debounce/batch update in `useLeaderboard` recommended |
| DB connections | Supabase JS uses pooled connections | Same (Supabase manages pooling) | Not a concern at this scale |

Supabase Free tier limits relevant here: 500 concurrent Realtime connections, 500MB DB storage, unlimited API requests on the database side. The quiz scale (500 max simultaneous) is right at the connection limit — worth monitoring.

---

## Sources

- Supabase JS SDK v2 API: `@supabase/supabase-js ^2.45.0` (from `fue-quiz/package.json`)
- Supabase Realtime v2 channel API: Broadcast and Postgres Changes patterns — HIGH confidence from SDK source and training data (cutoff August 2025)
- React 18 hook patterns: HIGH confidence, within training cutoff
- App.jsx analysis: direct code reading — HIGH confidence
- Supabase Free tier limits (500 concurrent connections): MEDIUM confidence — verify at supabase.com/pricing before production deployment
