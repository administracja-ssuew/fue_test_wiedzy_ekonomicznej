# Research Summary — FUE Quiz

**Synthesized from:** STACK.md · FEATURES.md · ARCHITECTURE.md · PITFALLS.md  
**Date:** 2026-04-24

---

## Executive Summary

FUE Quiz is a structured annual competition platform replacing Kahoot for the Test Wiedzy Ekonomicznej (~500 concurrent participants, 5 cities). The frontend is complete and polished — all remaining work is backend integration: Supabase Auth, normalized DB schema, Realtime Broadcast for quiz sync, and answer persistence.

**Recommended approach:** Phased delivery starting with structural refactoring (split 1,100-line App.jsx before adding backend), then Supabase Auth + schema, then real-time quiz control, then live leaderboard, then admin CRUD.

---

## Recommended Stack

| Technology | Version | Decision |
|------------|---------|----------|
| React | 18.3.x | Keep |
| Vite | 5.4.x | Keep |
| @supabase/supabase-js | ^2.x latest | Install / upgrade |
| react-router-dom | ^6.x (6.20+) | Add — replaces screen state machine |
| vitest | ^2.x | Add alongside refactor |
| @testing-library/react | ^16.x | Add with Vitest |
| vite-plugin-pwa | ^0.21.x | Keep — no WebSocket conflict |

**⚠️ Critical:** Supabase Free tier ~200 concurrent WebSocket connections. Stage 1 needs 500. Verify at supabase.com/pricing — likely need Pro ($25/month) for event day.

**Realtime channel choice:** Broadcast for all quiz state events. Postgres Changes only for admin leaderboard watching `answers` INSERT. Never Postgres Changes for quiz state (50–200ms WAL latency too slow).

---

## Table Stakes Features (v1 must-have)

1. Supabase Auth for admin — replaces hardcoded `ADMIN_CODE = "FUE2025"`
2. Participant registration + admin verification queue (partial in prototype, needs DB)
3. Session management — 6-digit join code, state machine, city scoping
4. Real-time question delivery — synchronized via server `q_started_at` timestamp
5. Answer recording to DB per question — **the most critical missing piece**
6. Post-quiz leaderboard per city + national aggregate
7. Question bank in DB with per-question time limits (not hardcoded)
8. Podium ceremony connected to real DB results
9. Two-stage logic — 5 parallel city sessions (Stage 1) + 1 national (Stage 2)

---

## Key Architecture Decisions

### Target file structure
```
src/
├── App.jsx                  ← thin router (~80 lines)
├── screens/                 ← one file per screen
├── hooks/
│   ├── useAuth.js           ← auth state + onAuthStateChange
│   ├── useSession.js        ← Broadcast + quiz state + answer submission
│   ├── useTimer.js          ← deadline-based countdown
│   └── useLeaderboard.js    ← Postgres Changes (admin only)
├── lib/supabase.js          ← singleton client + CRUD wrappers
└── data/questions.js        ← keep until Phase 5 migrates to DB
```

### Timer pattern (critical — current code is broken for multi-device)
Admin broadcasts `{ q_started_at: Date.now() }` once. Each client computes:
```js
remainingMs = (q_started_at + timeLimit * 1000) - Date.now()
```
Never decrement a counter. Corrects for network latency and mobile background-tab throttling.

### Data flow
Admin updates `quiz_sessions` DB row first → then broadcasts. DB = source of truth. Broadcast = fast path. On reconnect, clients fetch DB state.

### Minimum viable DB schema
```sql
profiles       -- extends auth.users; role, city, university, verified
quiz_sessions  -- join_code CHAR(6), stage, city, status, current_question_index, q_started_at
participants   -- join table (session_id, user_id)
answers        -- one row per question per participant; UNIQUE(session_id, user_id, question_id)
questions      -- Phase 5; keep questions.js until then
```

---

## Top 5 Pitfalls

### P1 — Client timer drift (CRITICAL — already a bug in App.jsx)
Devices diverge by 2–5s. Scoring becomes unfair.
**Fix:** Server-anchored timer (see above). Add `visibilitychange` listener. Validate timestamps server-side.
**Phase:** 3

### P2 — RLS misconfiguration (CRITICAL — fails silently)
Wrong policies cause writes to silently fail; admin sees empty leaderboard.
**Fix:** Design all RLS policies before any UI code. Test with `SET ROLE anon` in SQL editor. Use Supabase anonymous sign-in so every participant has `auth.uid()`.
**Phase:** 2

### P3 — WebSocket reconnect leaves participant stranded (HIGH)
Broadcast has no message replay. Drop mid-question = stale screen.
**Fix:** On every `SUBSCRIBED` event, fetch current quiz state from DB. 5s periodic poll as safety net.
**Phase:** 3

### P4 — Free tier 200-connection ceiling (CRITICAL infrastructure risk)
Stage 1 needs 500. Participants above ceiling receive no broadcasts.
**Fix:** Verify limit + upgrade to Pro for event day. Load test 120+ connections on staging.
**Phase:** Pre-Phase 3 infrastructure decision

### P5 — Admin JWT expiry mid-quiz (HIGH)
Default 1-hour JWT. 90-minute quiz hits this → quiz freezes.
**Fix:** Set JWT expiry to 4+ hours in Supabase Auth settings. `onAuthStateChange` handler re-subscribes channels on `TOKEN_REFRESHED`.
**Phase:** 2

---

## Recommended Phase Order

| Phase | Focus | Rationale |
|-------|-------|-----------|
| 1 | Structural refactor (no behavior change) | App.jsx is the architectural blocker — split first |
| 2 | Supabase Auth + DB schema + RLS | Auth prerequisite for everything; RLS must come before data |
| 3 | Real-time quiz control | Core competitive feature; server timer, Broadcast, answer recording |
| 4 | Live leaderboard + podium | Depends on Phase 3 answers events |
| 5 | Admin CRUD + question bank + history | Questions can stay hardcoded through Phase 4 |

---

## Open Decisions (must resolve before Phase 2)

1. **Participant identity model** — anonymous sign-in vs. email/password vs. localStorage token. Affects all RLS policies.
2. **Score computation ownership** — `calcPts` in browser is tamperable. Decide: Postgres trigger vs. Edge Function vs. post-quiz aggregate.
3. **Stage 1 simultaneous start** — global admin starts all 5 cities at once, or each city admin independently?
4. **Supabase tier verification** — confirm concurrent connection limit and budget for Pro before Phase 3 architecture.
