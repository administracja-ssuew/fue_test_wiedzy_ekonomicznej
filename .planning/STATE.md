---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 7 UI-SPEC approved
last_updated: "2026-09-28T19:29:06.223Z"
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 38
  completed_plans: 23
---

# Project State: FUE Quiz — Test Wiedzy Ekonomicznej

**Initialized:** 2026-04-23  
**Mode:** YOLO  
**Working directory:** `fue-quiz/` (sub-repo inside fue-quiz-project/)

---

## Project Reference

**Core Value:** Admin FUE naciska "Start" → wszyscy uczestnicy na 5 uczelniach jednocześnie widzą to samo pytanie w czasie rzeczywistym i odpowiadają na własnych telefonach — bez Kahoota, z własną bazą danych i własnym podium.

**Stack:** React 18 + Vite + vite-plugin-pwa + Supabase JS SDK  
**Deployment:** Vercel (frontend) + Supabase Cloud (backend)  
**Design constraint:** Custom CSS-in-JS inline styles — do not introduce external UI libraries

---

## Current Position

Phase: 07 (poprawki-po-tescie-na-telefonach-i-organizacja-konkursu) — EXECUTING
Plan: 1 of 13
**Phase:** 06
**Plan:** 06-17
**Status:** Executing Phase 07

```
[Phase 1] [Phase 2] [Phase 3] [Phase 4] [Phase 5]
[------]  [      ]  [      ]  [      ]  [      ]
  75%       0%        0%        0%        0%
```

**Overall progress:** 0/5 phases complete (3/4 plans in Phase 1)

---

## Codebase Baseline

**As of initialization:**

- `fue-quiz/src/App.jsx` — ~1,200 lines monolith; all screens + state + logic
- `fue-quiz/src/lib/supabase.js` — Supabase client + DEMO mode fallback (localStorage)
- `fue-quiz/src/data/questions.js` — 32 hardcoded questions in 4 modules
- `fue-quiz/src/main.jsx` — React root entry point
- No backend tables, no RLS, no real auth
- DEMO mode: hardcoded admin code "FUE2025", localStorage for participants

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases complete | 0 / 5 |
| Plans complete | 3 / 4 (Phase 1) |
| Requirements shipped | 7 / 37 (STRUCT-01, STRUCT-02, STRUCT-03, STRUCT-04, STRUCT-05, STRUCT-06 + structure) |
| Current phase progress | 75% |

---
| Phase 06 P15 | 4min | 3 tasks | 10 files |
| Phase 06 P14 | 20min | 3 tasks | 6 files |
| Phase 06 P13 | 112min | 3 tasks | 4 files |
| Phase 06 P16 | 25min | 2 tasks | 7 files |

## Accumulated Context

### Decisions Locked

| Decision | Rationale |
|----------|-----------|
| Supabase Broadcast for quiz sync | Low latency, no WAL delay, perfect for ephemeral state |
| Postgres Changes only for admin leaderboard | WAL latency (50–200ms) acceptable for leaderboard, not for quiz control |
| No Redux / React Query | useState + Supabase client sufficient at ~500 concurrent users |
| questions.js stays through Phase 4 | Unblocks real-time work; migrated in Phase 5 |
| react-router-dom added in Phase 1 | Replaces screen state machine, enables code splitting |
| Vitest added in Phase 1 | Safe to add alongside refactor, no behavior change |
| W object copied per-screen (Plan 02) | Consolidation deferred to Plan 04 when App.jsx is thinned |
| 06-14: session_question_set — wspólny zbiór pytań sesji (plan / pula miasta) | Ranking i raport XLSX liczą z tego samego zbioru; brak odpowiedzi = błędna z pełnym czasem pytania; sygnatury RPC bez zmian (SC6) |
| 06-16: pauza z dwóch kliknięć zamiast confirm() (decyzja użytkownika) + panel pokazuje fazę, w której pauza wylądowała | confirm() przesuwał moment pauzy o czas czytania okna (06-DIAG H4, najbardziej prawdopodobna przyczyna G2) |
| 06-16: wiersz Realtime w trakcie snapshotu ma pierwszeństwo dla pól sterujących (keepControl) + natychmiastowy ponowny snapshot | Tania ochrona przed H1 przy dużym RTT i 500 telefonach, bez porównywania znaczników czasu |

### Open Decisions (must resolve before Phase 2)

1. **Participant identity model** — anonymous sign-in vs. email/password vs. localStorage token. Affects all RLS policies.
2. **Score computation ownership** — `calcPts` in browser is tamperable. Postgres trigger vs. Edge Function vs. post-quiz aggregate?
3. **Stage 1 simultaneous start** — global admin starts all 5 cities at once, or each city admin independently?
4. **Supabase tier** — Free tier allows ~200 concurrent WebSocket connections; Stage 1 needs ~500. Verify and budget for Pro ($25/month) before Phase 3 architecture.

### Critical Pitfalls to Remember

- **P1 — Client timer drift (CRITICAL):** Current `setInterval` in App.jsx is broken for multi-device. Fix: server-anchored timer using `q_started_at`. Phase 3.
- **P2 — RLS misconfiguration (CRITICAL):** Wrong policies fail silently. Design + test ALL RLS before any participant-facing code. Phase 2.
- **P3 — Broadcast reconnect (HIGH):** No message replay. On every `SUBSCRIBED` event, fetch DB state. Phase 3.
- **P4 — Free tier connection ceiling (CRITICAL):** Verify Supabase concurrent connection limit before Phase 3. Infrastructure decision.
- **P5 — Admin JWT expiry (HIGH):** Default 1-hour JWT kills a 90-minute quiz. Set ≥4h in Supabase Auth settings + `onAuthStateChange` re-subscribe handler. Phase 2.

### TODOs

- [ ] Verify Supabase concurrent WebSocket connection limit (Free vs. Pro)
- [ ] Decide participant identity model before starting Phase 2
- [ ] Decide score computation ownership before starting Phase 3

### Blockers

None — Phase 1 can start immediately.

### Roadmap Evolution

- Phase 6 added (2026-09-24): Rozgrywka autorytatywna serwera i płynność jak w aplikacji. Decyzje: punkty czystym zegarem serwera; „⏭ Następne" zostaje jako przesunięcie planu; testy na produkcji z samosprzątającymi sondami (staging nie istnieje) → migracje wyłącznie addytywne; termin ~koniec października 2026.

- Phase 7 added (2026-09-28): Poprawki po teście na telefonach i organizacja konkursu. Decyzje użytkownika: kody 4-cyfrowe z limitem prób; prefiks Warszawy zostaje WAR; bez reguły remisu (wystarczą 2 miejsca po przecinku); test iPhone był w Chrome (nie PWA), najnowszy iOS.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260902-lp2 | Naprawy po audycie obciążeniowym + 5 zadań użytkownika | 2026-09-02 | `5d76829` | [260902-lp2-naprawy-po-audycie-obciazeniowym-5-zadan](./quick/260902-lp2-naprawy-po-audycie-obciazeniowym-5-zadan/) |

**Otwarte po 260902-lp2** (szczegóły w SUMMARY):

- Sekcja 37 `SUPABASE_FIXES.sql` NIE jest jeszcze wgrana na żaden projekt Supabase
- Przebieg na żywo z dwoma klientami po zmianie sterowania przejściem pytania
- Plan Supabase Pro + podniesienie limitu połączeń do 800 (510 potrzebnych, Pro daje 500)

---

## Session Continuity

**Last session:** 2026-09-28T11:33:45.123Z
**Stopped at:** Phase 7 UI-SPEC approved
**Next action:** Wykonanie fazy 7 (`/gsd:execute-phase 7`) — 13 planów, 6 fal; fala 1 = 07-01…07-05

### Handoff Notes

- App works in DEMO mode end-to-end. Do not break DEMO during Phase 1 refactor (STRUCT-06).
- `fue-quiz/` is the sub-repo where all code changes happen.
- Phase 1 is purely structural — zero behavior change, zero Supabase calls added.
- Phase 2 is the first time Supabase environment variables become required (`.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`).

---

*Last updated: 2026-09-02 — Completed quick task 260902-lp2: naprawy po audycie obciążeniowym + 5 zadań użytkownika*
