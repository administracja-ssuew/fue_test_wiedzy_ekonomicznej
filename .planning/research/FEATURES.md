# Feature Landscape — FUE Quiz (Real-Time Competition Platform)

**Domain:** Synchronous multiplayer quiz / academic competition platform
**Researched:** 2026-04-23
**Confidence:** HIGH (based on prototype code inspection + established Kahoot-class platform patterns)

---

## Context Summary

FUE Quiz is NOT a generic quiz tool. It is a structured annual competition (Test Wiedzy Ekonomicznej) with
known participants, verified identities, two competitive stages, and ceremonial results reveal. This shapes
which features are table stakes vs. deliberately out of scope.

Scale: ~500 concurrent (100/city × 5 in Stage 1), 25 in Stage 2 national final.
Platform: React 18 PWA + Supabase (Postgres + Realtime Channels + Auth).

---

## 1. Session Management

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| 6-digit numeric join code | Kahoot established this as the UX standard — participants type it on their phone | Low | Generate server-side: `Math.floor(100000 + Math.random() * 900000)`. Store on `quiz_sessions`. Unique per active session. |
| Session state machine | Without enforced states, participants and admin get out of sync | Medium | States: `waiting → active → question_open → question_closed → results → podium → finished`. Admin drives all transitions. |
| Lobby with live participant count | Participants need confirmation they joined; admin needs to see who's in | Low | Supabase Realtime Broadcast: participant joins → broadcasts `participant_joined` → admin increments counter. No DB write needed for presence. |
| Session scoped to city (Stage 1) | 5 parallel sessions must not bleed into each other | Medium | `quiz_sessions.city` column. Participants join the session matching their registered city. Admin for each city starts independently. |
| Single shared session (Stage 2) | 25 finalists regardless of city — one session, no city filter | Low | `quiz_sessions.city = null` for national final. Same code mechanism, different scope. |
| Admin-initiated start | Quiz does not begin until admin presses Start | Low | Admin broadcasts `session_state_change { status: 'active' }` via Supabase Broadcast channel. Participants listening on `session:{code}` receive it. |
| Late joiner handling | Participants who join after start need to catch up | Medium | On join, participant fetches current session state from DB (`quiz_sessions.current_question_index`, `current_module`). If `status = question_open`, show countdown with remaining time (calculate from `question_started_at + time_limit - now`). If `question_closed`, show waiting screen. |
| Session termination / cleanup | Stale sessions must not block new ones | Low | Admin "finish" action sets `status = finished`. New sessions for same city require no active session (status != waiting/active). |

### Differentiators for FUE

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Human-readable session URL | `fue-quiz.pl/join/123456` — participants can share the link instead of typing | Low | Route param `/:code` that auto-fills the join form. Nice for projector display. |
| Pre-session participant checklist | Admin sees verified count vs. joined count before pressing Start | Low | Admin lobby shows: "Zweryfikowani: 87 / Dołączyli: 73 / Gotowi: 73". Allows waiting for stragglers. |
| Session pin display for projector | Large code shown on admin screen to project for room entry | Low | Admin lobby screen displays code at large size. Already partially in prototype. |

### Anti-Features

| Anti-Feature | Why Avoid | Instead |
|--------------|-----------|---------|
| Self-serve session creation by participants | This is an organized competition, not open Kahoot | Only admin accounts can create sessions |
| Always-on persistent session | Would allow cheating by re-entering | Sessions expire on finish; no re-join after completion |
| QR code join | Listed as v3 in PROJECT.md, not current scope | 6-digit code is sufficient for small rooms |

---

## 2. Real-Time Synchronization

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Synchronized question reveal | All participants see Q at the same moment — core competitive fairness | High | Admin triggers `next_question` Broadcast. Payload: `{ module, questionIndex, startsAt: serverTimestamp }`. Participants compute `timeLeft = (startsAt + timeLimit) - Date.now()`. Use server timestamp, not client. |
| Synchronized timer | Timer must match across devices | Medium | Admin does NOT control each tick. Instead: `startsAt` is broadcast once. Each client runs its own countdown from `startsAt`. Drift < 1s over 90s is acceptable. |
| Answer lock on timeout | No answers accepted after time expires | Low | Client-side: disable buttons at `t=0`. Server-side: reject answers with timestamp beyond `question_started_at + time_limit + 2s` (2s grace for network). |
| Admin sees answer distribution live | Needed to build tension and monitor engagement | Medium | Participants' answer choices broadcast via Supabase Broadcast (not saved to DB yet). Admin channel aggregates counts per option (A/B/C/D) and shows live bar chart. Saved to DB on question close. |
| Module intro synchronization | 4 modules with varying time limits — all must transition together | Low | Admin broadcasts module change. Participants render `ModuleIntroScreen` until admin broadcasts first question of that module. |

### Who Broadcasts What

**Admin (host) broadcasts — all participants listen:**
- `session_state_change` — lobby → active, question_open, question_closed, results, podium
- `question_reveal` — payload: `{ moduleId, questionIndex, startsAt }`
- `question_close` — locks answers, shows correct answer reveal
- `module_change` — advances to next module intro

**Participants broadcast — admin (and optionally other participants) listen:**
- `answer_submitted` — payload: `{ participantId, choiceIndex, answeredAt }`. Goes to admin channel only. NOT broadcast to other participants (prevents copying).
- `participant_joined` — lobby only, so admin sees count. Payload: `{ name, city }`.

**Supabase channel topology:**
```
Channel: quiz:{sessionCode}
  - Admin: subscribes + publishes (host role)
  - Participants: subscribes, publishes own answer only

Admin aggregates answer broadcasts client-side during question.
On question_close, admin writes aggregated results to DB.
```

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Participant count with city breakdown in lobby | Admin sees not just total but per-city distribution (relevant for Stage 2) | Low | Lobby broadcast includes city. Admin groups by city. |
| Explicit "waiting for admin" state | Participants see a reassuring "Quiz za chwilę" screen, not a dead blank | Low | Already partially implemented in prototype. |
| Answer tally reveal after each question | Show distribution (how many chose A/B/C/D) after question closes — creates drama | Medium | Admin-side aggregation of Broadcast answer events. Broadcast `question_stats` to all after close. |

### Anti-Features

| Anti-Feature | Why Avoid | Instead |
|--------------|-----------|---------|
| Participants seeing each other's answers in real time | Enables copying, kills competition integrity | Only admin receives answer stream |
| Polling fallback for sync | Adds complexity; Supabase Realtime is sufficient for 500 connections | Use Broadcast with connection-loss reconnect logic |
| Per-question chat / reactions | This is a competition not a social game | No chat. Confetti at podium is the celebration mechanism. |

---

## 3. Leaderboard

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Live leaderboard for admin during quiz | Admin needs to monitor engagement and spot leaders | Medium | After each question closes, admin queries `attempts` table ordered by `total_score`. Or admin aggregates answer scores client-side from Broadcast stream (faster, no DB round-trip). |
| Per-city leaderboard view (Stage 1) | 5 cities compete independently in Stage 1 | Medium | Admin can filter leaderboard by city. Each city admin sees their own city automatically (city_admin role). |
| National aggregate leaderboard (Stage 2) | 25 finalists compete as individuals, no city grouping | Low | Stage 2 session has no city filter. Leaderboard sorted by individual score. |
| Top-N advancement list | Core competition mechanic: top 5 per city advance to final | Low | After Stage 1 ends, admin sees sorted list with clear top-5 highlighted per city. UI: "Awansuje do finału" badge on top 5. |
| Participant end-screen with hidden rank | Prototype already shows score but hides rank — correct behavior | Low | Participant sees own score. Rank revealed only at podium. This builds anticipation. Already in prototype. |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| City aggregate score card | Which city collectively scored highest? Bragging rights for university organizations | Low | Sum all participant scores per city. Show city rankings. Secondary metric after individual winners. |
| Per-module breakdown in leaderboard | See who dominated "Obliczenia" vs "Terminy" modules — enriches debrief | Low | Already tracked per-answer in `allAnswers` array. Extend leaderboard table to show module columns. |
| Live rank movement animation | Positions shifting during quiz builds excitement | High | Complex to implement well. Requires tracking previous rank and animating delta. Defer to v2 unless time allows. |

### Anti-Features

| Anti-Feature | Why Avoid | Instead |
|--------------|-----------|---------|
| Participants seeing live leaderboard during quiz | Discourages slower participants; enables strategic answering | Leaderboard revealed only by admin at appropriate moments |
| Showing exact score while quiz is in progress to others | Same as above | Score visible to individual only during quiz |
| Per-question mini-leaderboard on participant screen | Distracts from next question | Only admin has this view |

---

## 4. Admin / Participant Role Separation

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Global admin (FUE Presidium) | Full access: all cities, all sessions, all results, question bank management | Low | Role: `global_admin`. Supabase Auth email/password. Can start any session. |
| City admin | Manages one city's session and participant verification | Low | Role: `city_admin` with `city` field. Sees only their city's participants. Starts their city's Stage 1 session. |
| Participant (student) | Takes the quiz, sees own results | Low | Role: `participant`. No admin access. Must be `verified = true` to start quiz. |
| Pre-competition participant verification | Admin must approve participants before quiz starts — prevents non-students | Medium | Verification queue in admin panel. Already in prototype. Extend to work from DB. |
| Admin sees answer distribution, participants do not | Core integrity requirement | Low | Separate channel subscriptions. Participants' answer events only go to admin channel. |
| Admin controls all quiz state transitions | Participants cannot self-advance | Low | All state changes originate from admin Broadcast. Participants are listeners only. |

### What Admin Sees (vs. Participant)

**Global Admin screen — full panel:**
- All registered participants across all cities with verify/reject actions
- Start Regional (Stage 1) button — one per city, or broadcast to all 5 simultaneously
- Live answer distribution per question (A/B/C/D counts + %)
- Live leaderboard per city during quiz
- Post-quiz: full results table, sorted by score, with advancement markers
- Podium ceremony control (step-by-step reveal)
- Question bank CRUD
- Session history / archive browser

**City Admin screen — scoped view:**
- Only their city's participants
- Start quiz button for their city's session
- Live monitoring for their session
- Results for their city

**Participant screen:**
- Welcome / register / login
- Lobby (waiting state)
- Quiz: question + timer + options
- Per-question feedback (correct/incorrect + points earned)
- Module intro screens
- End screen with own score (rank hidden)
- Practice area (available before and after verification)

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| "City admin" role distinct from "global admin" | Enables delegation: each university can manage its own participants | Low | Role field on profiles. city_admin filtered views in admin panel. |
| Admin emergency controls | Pause question timer, re-broadcast question, skip question | Medium | Useful if projector glitches or network drops. Admin sends `question_pause` / `question_resume` Broadcast. |
| Admin notes per participant | Flag a participant as "suspected duplicate" or "confirmed student" | Low | `notes` field on profiles. Admin-only visible. |

### Anti-Features

| Anti-Feature | Why Avoid | Instead |
|--------------|-----------|---------|
| Self-service participant role change | Role changes are admin-only acts | Role only set via admin verification flow |
| Public admin dashboard link | Admin panel must not be discoverable | Separate route `/admin` guarded by auth check |

---

## 5. Two-Stage Competition Logic

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Stage 1: 5 parallel independent city sessions | Regional qualifier — each city runs simultaneously but separately | High | Each session: `stage = 'regional'`, `city = 'Kraków'` etc. 5 separate Broadcast channels (`quiz:123456`, `quiz:234567` etc.). Admin for each city has their own code. Questions are identical across all cities (loaded from same question bank). |
| Stage 2: single national final session | 25 finalists in one shared session | Medium | Session: `stage = 'national'`, `city = null`. Only participants whose `advanced = true` can join. Admin verifies advancement before creating Stage 2 session. |
| Top-N advancement selection | After Stage 1, admin designates top 5 per city as finalists | Medium | Admin views sorted Stage 1 results per city. Checks box on top-5 per city (25 total). Sets `profiles.advanced = true` or creates separate `finalists` table. |
| Stage indicator on all screens | Participants know if they're in Stage 1 or Stage 2 | Low | Session `stage` field surfaced as badge: "ETAP I — KATOWICE" vs "ETAP II — FINAŁ OGÓLNOPOLSKI". |
| Same question bank for both stages | Consistency — finalists answer same question types, different questions if desired | Low | Question bank has `allowed_stages: ['regional', 'national', 'both']` flag or admin selects question set per session. |

### Stage Transition Flow

```
Stage 1 (Regional):
  Admin creates 5 city sessions (or global admin broadcasts to all)
  Each city: lobby → quiz (same questions, parallel) → results per city
  Admin views Stage 1 results per city, selects top 5 per city (25 total)
  Admin marks finalists: profiles.advanced = true

Stage 2 (National Final):
  Admin creates 1 national session
  Only advanced=true participants can join (enforced server-side)
  Lobby → quiz → results → podium ceremony
```

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Simultaneous Stage 1 start across all cities | Global admin can broadcast "go" to all 5 city admins simultaneously, or start all 5 sessions at once | Medium | Global admin presses "Start wszystkich etapów regionalnych". Creates 5 sessions simultaneously. All 5 broadcast channels activated. |
| Stage 1 vs Stage 2 question differentiation | Harder questions in final — ensures the final is more challenging | Low | Tag questions with `difficulty: 'regional' / 'national' / 'both'`. Session creation picks the right set. |
| Advancement announcement screen | Between Stage 1 end and Stage 2, admin triggers "advancement reveal" — shows who qualified per city | Medium | After Stage 1, admin broadcasts `advancement_reveal` to all. Participants see: "Gratulacje! Przechodzisz do finału" or "Dziękujemy za udział". |

### Anti-Features

| Anti-Feature | Why Avoid | Instead |
|--------------|-----------|---------|
| Automatic advancement calculation without admin review | Ties, disqualifications, or technical issues require human judgment | Admin manually confirms advancement list |
| Cross-city real-time leaderboard during Stage 1 | Creates pressure to cheat (different room conditions, network timing) | Only show cross-city comparison AFTER Stage 1 ends |
| Participants knowing their rank vs. other cities mid-quiz | Same issue | Post-quiz only |

---

## 6. Question Management

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Admin CRUD for question bank | Questions currently hardcoded — must be editable without code deploy | Medium | Questions table in Postgres: `id, module_id, text, options (jsonb), correct_answer_index, explanation, time_limit_seconds, difficulty, active`. Admin panel "Questions" tab with add/edit/delete. |
| 4-option multiple choice | Established format from prototype — do not break | Low | `options: string[4]`, `correct_answer_index: 0-3`. |
| Per-question time limit | Prototype already has per-module limits (90/30/60/75s) — preserve and extend | Low | Time limit can be per-question or inherit from module default. |
| Module/category assignment | Questions organized by module (Obliczenia, Terminy, Logika, Kreatywne) | Low | `module_id` foreign key. Admin filters questions by module when browsing. |
| Explanation field | Post-answer explanation shown to participants — educational value | Low | `explanation` text field. Already in prototype. |
| Question ordering within session | Admin controls the order questions appear | Medium | Either fixed order (defined in question bank), or admin can reorder for a session. Simplest: `sort_order` on questions table. |
| Preview before quiz | Admin can preview questions before starting | Low | Read-only question list in admin panel with correct answer visible. |
| Question activation toggle | Admin can deactivate a question without deleting it | Low | `active: boolean` field. Session only loads `active = true` questions. |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Difficulty tagging (regional / national / both) | Enables two-stage question sets from the same bank | Low | `allowed_stages: text[]` or separate boolean flags `for_regional, for_national`. |
| Import from CSV/JSON | Easier question management for FUE editors | Medium | Admin uploads a CSV. Parse and bulk-insert. Validate structure before insert. |
| Question usage history | Know which questions were used in which edition — avoid repeats | Low | `question_sessions` junction table or `used_in_editions` array on question. |
| Answer statistics | After an edition, which questions had highest wrong-answer rate? | Medium | Aggregated from `answers` table. Admin sees per-question correct% across all participants. |

### Anti-Features

| Anti-Feature | Why Avoid | Instead |
|--------------|-----------|---------|
| Rich text / images in questions | Disproportionate complexity for text-based economics questions | Plain text with TeX-style notation for formulas if needed |
| Public question submission | This is a curated academic competition | Admin-only question management |
| Randomized question order per participant | Breaks synchronization — all must be on same question at same time | Fixed order per session, same for everyone |

---

## 7. Results and History

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-session results archive | Year-over-year institutional memory | Medium | `quiz_sessions` stores all sessions. `attempts` stores all answers with scores. Never delete. Query by `created_at` to browse editions. |
| Participant results retrieval | A participant should be able to see their own results after the competition | Low | `attempts` joined with `profiles` and `quiz_sessions`. Filter by `user_id`. Participant profile page shows attempt history. |
| Admin results export (CSV/JSON) | Organizers need to process results externally (certificates, rankings) | Medium | Admin panel "Export" button. Fetches all attempts for a session, joins with profiles, serializes to CSV download. |
| Podium top-3 reveal | The ceremony that ends the national final | Low | Already implemented in prototype with step-by-step reveal + confetti. Needs to be connected to real DB results. |
| City aggregate summary per Stage 1 | Which university collectively scored best? | Low | Group `attempts` by `profiles.city`, sum scores, count participants. |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Edition archive browser | Admin can browse all historical editions (7+ years of TWE) | Medium | Edition = a pair of sessions (regional + national). Admin creates edition record. Archive page lists editions with participant counts, dates, top 3 names. |
| Participant performance across editions | Has this student improved year-over-year? | Medium | Requires same participant identity across editions (email-based). Join `attempts` across multiple sessions by `user_id`. |
| Per-city historical ranking | Which university has the most total TWE winners? | Low | Aggregate across all editions' podium results. FUE prestige metric. |
| Certificate generation | "Uczestnik Test Wiedzy Ekonomicznej 2026" PDF | Medium | Listed as v3 in PROJECT.md. Defer. Can be a simple HTML→PDF via browser print. |

### Anti-Features

| Anti-Feature | Why Avoid | Instead |
|--------------|-----------|---------|
| Public results page (open to internet) | Personal data (full names + university) requires privacy consideration | Results behind admin login or participant's own login only |
| Real-time public scoreboard during quiz (for spectators) | Out of competition scope for now | Projector shows admin screen |
| Automatic email results distribution | FCM/email infra complexity out of scope | Admin exports and distributes manually |

---

## Feature Dependency Map

```
Supabase Auth (admin accounts)
  └── Admin Panel
        ├── Participant Management (verify/reject)
        │     └── Lobby can start (only verified participants can join)
        ├── Question CRUD
        │     └── Session creation (questions loaded from DB)
        └── Session Management
              ├── Stage 1 Sessions (×5 cities)
              │     ├── Real-time Broadcast (Supabase Channels)
              │     │     ├── Participant join/presence
              │     │     ├── Question sync (reveal/close)
              │     │     └── Answer collection (admin only)
              │     ├── Live Leaderboard (admin)
              │     └── Results storage (attempts table)
              └── Stage 2 Session (×1 national)
                    ├── Advancement gating (advanced=true check)
                    ├── Same real-time flow as Stage 1
                    └── Podium ceremony (real data, not fake)

Results Archive
  ├── Session history
  ├── Per-edition aggregate
  └── Cross-edition participant history
```

## MVP Recommendation for "Next Edition" (Autumn 2026)

**Must have for competition to run:**
1. Supabase Auth + participant registration/verification (partial in prototype, needs DB)
2. Session management with 6-digit code and Broadcast sync
3. Real-time question delivery (synchronized start, server-timestamp timer)
4. Answer recording to DB (currently missing)
5. Post-quiz admin leaderboard (per city + national aggregate)
6. Question bank in DB (not hardcoded)
7. Podium connected to real results

**Can defer to post-launch / v2:**
- Edition archive browser
- Cross-edition participant history
- CSV import for questions
- Advancement announcement screen
- City aggregate historical ranking
- Emergency admin controls (pause/resume)

**Confirmed out of scope (PROJECT.md):**
- QR code join
- PDF certificates
- Push notifications
- Sound effects
- Screensaver mode
- Redux / React Query

---

## Sources and Confidence Notes

**HIGH confidence (based on prototype code inspection):**
- All existing screen states and flows (read directly from App.jsx)
- Existing Supabase schema shape (read from supabase.js)
- Module structure, question format, scoring formula, city list
- Admin role model (global_admin, city_admin already present in code)

**HIGH confidence (established Kahoot/quiz platform patterns):**
- Session state machine (waiting→active→question_open→question_closed→results→podium) — this is the canonical pattern used by Kahoot, Mentimeter, Slido, AhaSlides
- Host-only state transitions (participants are listeners)
- Server-timestamp synchronized timer (industry standard to avoid clock drift)
- Answer distribution tally shown post-question
- Hiding individual rank from participants during quiz

**MEDIUM confidence (Supabase-specific patterns):**
- Broadcast vs. Postgres Changes channel topology — Broadcast for ephemeral quiz state (zero DB writes), Postgres Changes for persistent data. This is documented Supabase pattern but requires verification against current Supabase Realtime limits (500 concurrent connections on free tier needs verification).
- 500 concurrent connections on Supabase free tier — PROJECT.md states "should be sufficient"; confirm against current Supabase pricing before production.
