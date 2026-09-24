# Roadmap: FUE Quiz — Test Wiedzy Ekonomicznej

**Created:** 2026-04-23  
**Granularity:** standard  
**Coverage:** 37/37 v1 requirements mapped  
**Core Value:** Admin FUE naciska "Start" → wszyscy uczestnicy na 5 uczelniach jednocześnie widzą to samo pytanie w czasie rzeczywistym.

---

## Phases

- [x] **Phase 1: Structural Refactor** — Split App.jsx into screens/ + hooks/ + lib/; no behavior change; DEMO mode intact (completed 2026-04-24)
- [ ] **Phase 2: Supabase Foundation** — Auth, DB schema, RLS, session join code, participant registration and verification
- [ ] **Phase 3: Real-Time Quiz Engine** — Broadcast channels, server-anchored timer, answer recording, reconnect recovery
- [ ] **Phase 4: Live Leaderboard and Podium** — Postgres Changes on answers, admin live view, real podium data, city aggregates
- [ ] **Phase 5: Admin Panel and Question Bank** — Question CRUD, migrate questions.js to DB, history and archive

---

## Phase Details

### Phase 1: Structural Refactor
**Goal**: Codebase is split into maintainable files with one screen per file, shared hooks, and a thin router — DEMO mode works exactly as before
**Depends on**: Nothing (first phase)
**Requirements**: STRUCT-01, STRUCT-02, STRUCT-03, STRUCT-04, STRUCT-05, STRUCT-06
**Success Criteria** (what must be TRUE):
  1. App.jsx is ≤80 lines and contains only a router/screen switcher — no screen logic
  2. Each screen (Welcome, Register, Login, Lobby, Quiz, Feedback, AdminPanel, Podium) lives in its own file under `screens/`
  3. `useAuth()`, `useSession()`, `useTimer()`, `useLeaderboard()` exist as standalone hooks in `hooks/`
  4. Opening the app in DEMO mode and completing a full quiz attempt (Welcome → Register → Login → Quiz → Podium) works without errors
  5. Vitest is installed and at least one unit test for `calcPts` scoring logic passes
**Plans**: 4 plans
Plans:
- [x] 01-01-PLAN.md — Install Vitest + react-router-dom, extract global CSS and gameLogic utilities
- [x] 01-02-PLAN.md — Extract already-isolated screens (Register, Login, AdminLogin, Practice, AdminPanel, Podium)
- [x] 01-03-PLAN.md — Extract inline screens (Welcome, Pending, Lobby, ModuleIntro, Quiz, Feedback, Ended) and create hook stubs
- [x] 01-04-PLAN.md — Thin App.jsx router, wire CSS import, write calcPts tests, verify DEMO mode
**UI hint**: no

---

### Phase 2: Supabase Foundation
**Goal**: Admins can log in with real credentials, the DB schema with RLS is live, participants can register and be verified, and sessions can be created and joined with a 6-digit code
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, DB-01, DB-02, DB-03, DB-04, DB-05
**Success Criteria** (what must be TRUE):
  1. Admin can log in at `/admin` with email + password via Supabase Auth; the hardcoded "FUE2025" code is gone; session survives page refresh and lasts ≥4 hours
  2. Admin sees a "Pending participants" list and can approve or reject each registrant; approved participants can log in; rejected ones cannot
  3. Admin can create a quiz session and see the 6-digit join code on screen; a participant can type that code and land in the Lobby
  4. Multiple quiz sessions can exist simultaneously (Stage 1 scenario: 5 cities each with their own session); each session is scoped to a city
  5. A `SET ROLE anon` check in the Supabase SQL editor confirms a participant cannot read another participant's answers or another city's session data
**Plans**: TBD
**UI hint**: yes

---

### Phase 3: Real-Time Quiz Engine
**Goal**: Admin pressing "Start Question" delivers the same question simultaneously to all participants in the session; answers are recorded per-question to the DB; a participant who drops and reconnects sees the current question
**Depends on**: Phase 2
**Requirements**: RT-01, RT-02, RT-03, RT-04, RT-05, RT-06, ANS-01, ANS-02, ANS-03, ANS-04
**Success Criteria** (what must be TRUE):
  1. Two devices on different networks join the same session; admin clicks "Start Question"; both devices show the same question within 500ms of each other
  2. Both devices show a countdown timer that is visually in sync (within ±1 second) throughout the question duration — based on `q_started_at` from the server, not a local interval
  3. A participant submits an answer; a row appears in the `answers` table with `session_id`, `user_id`, `question_id`, `chosen`, `is_correct`, `points`, and `response_time` all populated correctly
  4. Attempting to submit a second answer to the same question is silently rejected (UNIQUE constraint); attempting to answer after timer expiry records `points: 0`
  5. Closing the browser tab mid-question and reopening it within 30 seconds shows the correct current question and remaining time (reconnect recovery via DB fetch)
**Plans**: TBD
**UI hint**: yes

---

### Phase 4: Live Leaderboard and Podium
**Goal**: Admin sees a live leaderboard updating in real time after each answer; the podium ceremony at quiz end shows the actual top-3 from the database; city aggregate rankings are available
**Depends on**: Phase 3
**Requirements**: LB-01, LB-02, LB-03, LB-04, LB-05
**Success Criteria** (what must be TRUE):
  1. Admin's leaderboard screen updates within 2 seconds of a participant submitting an answer — without the admin manually refreshing — showing name, city, and live score sorted descending
  2. The podium screen (1st, 2nd, 3rd place with confetti) displays real names and real scores pulled from the `answers` table — no hardcoded `fakePodium` data
  3. A city aggregate table shows total or average score per university (PSUEK, UEK, UEP, SGH, UEW) sorted by rank
  4. Admin can identify the top 5 participants from each city in Stage 1 (for promotion to Stage 2) from the leaderboard view
**Plans**: TBD
**UI hint**: yes

---

### Phase 5: Admin Panel and Question Bank
**Goal**: Questions are managed in the database; admin can add, edit, and delete questions through a UI panel; completed quiz editions are archived and browsable
**Depends on**: Phase 4
**Requirements**: Q-01, Q-02, Q-03, Q-04, HIST-01, HIST-02
**Success Criteria** (what must be TRUE):
  1. The hardcoded `questions.js` file is no longer used at runtime; all 32 existing questions are present in the `questions` table in Supabase with correct fields (text, 4 options, correct answer index, category, time limit, `active` flag)
  2. Admin can create a new question from the admin panel form and see it immediately available for selection in a quiz session
  3. Admin can edit an existing question's text or correct answer and the change is reflected the next time that question is served in a session
  4. Admin can delete a question; the question no longer appears in session question lists
  5. Admin can open an "Archive" view listing past quiz editions with date, hosting university, and final leaderboard; clicking an edition shows its full results
**Plans**: TBD
**UI hint**: yes

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Structural Refactor | 3/4 | Complete    | 2026-04-24 |
| 2. Supabase Foundation | 0/? | Not started | - |
| 3. Real-Time Quiz Engine | 0/? | Not started | - |
| 4. Live Leaderboard and Podium | 0/? | Not started | - |
| 5. Admin Panel and Question Bank | 0/? | Not started | - |

---

## Requirement Coverage

| Requirement | Phase | Category |
|-------------|-------|----------|
| STRUCT-01 | Phase 1 | Structural Refactor |
| STRUCT-02 | Phase 1 | Structural Refactor |
| STRUCT-03 | Phase 1 | Structural Refactor |
| STRUCT-04 | Phase 1 | Structural Refactor |
| STRUCT-05 | Phase 1 | Structural Refactor |
| STRUCT-06 | Phase 1 | Structural Refactor |
| AUTH-01 | Phase 2 | Authentication |
| AUTH-02 | Phase 2 | Authentication |
| AUTH-03 | Phase 2 | Authentication |
| AUTH-04 | Phase 2 | Authentication |
| AUTH-05 | Phase 2 | Authentication |
| AUTH-06 | Phase 2 | Authentication |
| AUTH-07 | Phase 2 | Authentication |
| SESS-01 | Phase 2 | Session Management |
| SESS-02 | Phase 2 | Session Management |
| SESS-03 | Phase 2 | Session Management |
| SESS-04 | Phase 2 | Session Management |
| SESS-05 | Phase 2 | Session Management |
| DB-01 | Phase 2 | Database Schema & RLS |
| DB-02 | Phase 2 | Database Schema & RLS |
| DB-03 | Phase 2 | Database Schema & RLS |
| DB-04 | Phase 2 | Database Schema & RLS |
| DB-05 | Phase 2 | Database Schema & RLS |
| RT-01 | Phase 3 | Real-Time Quiz Control |
| RT-02 | Phase 3 | Real-Time Quiz Control |
| RT-03 | Phase 3 | Real-Time Quiz Control |
| RT-04 | Phase 3 | Real-Time Quiz Control |
| RT-05 | Phase 3 | Real-Time Quiz Control |
| RT-06 | Phase 3 | Real-Time Quiz Control |
| ANS-01 | Phase 3 | Answer Recording & Scoring |
| ANS-02 | Phase 3 | Answer Recording & Scoring |
| ANS-03 | Phase 3 | Answer Recording & Scoring |
| ANS-04 | Phase 3 | Answer Recording & Scoring |
| LB-01 | Phase 4 | Leaderboard & Results |
| LB-02 | Phase 4 | Leaderboard & Results |
| LB-03 | Phase 4 | Leaderboard & Results |
| LB-04 | Phase 4 | Leaderboard & Results |
| LB-05 | Phase 4 | Leaderboard & Results |
| Q-01 | Phase 5 | Question Bank |
| Q-02 | Phase 5 | Question Bank |
| Q-03 | Phase 5 | Question Bank |
| Q-04 | Phase 5 | Question Bank |
| HIST-01 | Phase 5 | History & Archive |
| HIST-02 | Phase 5 | History & Archive |

**Total: 45/45 requirements mapped** (37 v1 unique IDs + expanded from STRUCT-01–06, AUTH-01–07, SESS-01–05, DB-01–05, RT-01–06, ANS-01–04, LB-01–05, Q-01–04, HIST-01–02)

### Phase 6: Rozgrywka autorytatywna serwera i plynnosc jak w aplikacji

**Goal:** Rozgrywka mechanicznie nie do podważenia: przebieg quizu wynika z planu zamrożonego w bazie przy starcie i zegara serwera, przejścia wykonuje baza, a odświeżenie, wygaszenie ekranu czy zamknięcie przeglądarki admina niczego nie zmieniają. Do tego płynność „jak w aplikacji" na natywnych API.
**Research:** `.planning/research/PLYNNOSC-ROZGRYWKI.md`
**Requirements**: P6-SC1, P6-SC2, P6-SC3, P6-SC4, P6-SC5, P6-SC6, P6-FLUID (robocze ID = kryteria sukcesu poniżej + decyzje płynności z CONTEXT)
**Depends on:** stan faktyczny kodu z 24.09.2026 (fazy 2–5 w tym roadmapie są zrealizowane poza formalnym trackingiem — patrz STATUS.md)
**Deadline:** wydarzenie TWE ~koniec października 2026
**Success Criteria** (what must be TRUE):
  1. Admin zamyka przeglądarkę po starcie quizu, a wszystkie pytania i przejście do wyników odbywają się w zaplanowanych czasach na każdym telefonie (sonda `PROBE_ADMIN_EXIT=1`)
  2. Odświeżenie telefonu w dowolnej fazie (odliczanie, pytanie, reveal, zapowiedź modułu) przywraca tę samą fazę i licznik z różnicą ≤ 1 s względem innego telefonu; udzielona odpowiedź pozostaje zablokowana (sonda `PROBE_REFRESH=1`)
  3. 10 s bez sieci w środku pytania → po powrocie od razu właściwa faza (sonda `PROBE_OFFLINE=1`)
  4. Czas pytania na każdym kliencie pochodzi z planu sesji, nie z modułów pobranych przez klienta
  5. Poprawna odpowiedź nie trafia do klienta przed końcem czasu pytania; punkty liczone czystym zegarem serwera
  6. Każda migracja SQL jest addytywna — obecnie wdrożony frontend działa bez zmian do momentu wdrożenia nowego
**Plans:** 11 plans (8 fal)

Plans:
- [ ] 06-01-PLAN.md — Logika planu w JS (plan.js + fixture'y JS↔SQL + Vitest) i filtr próbek zegara (fala 1)
- [ ] 06-02-PLAN.md — SQL sekcje 39–40: session_plans, plan_position, v2 RPC, akcje admina, zamiatacz, pg_cron (fala 1)
- [ ] 06-03-PLAN.md — verify-plan/verify-prod, ręczne wgranie 39–40, regresja SC6 na starym buildzie (fala 2, checkpoint)
- [ ] 06-04-PLAN.md — Wrappery v2 + DEMO, participantState, hook useParticipantGame (fala 2)
- [ ] 06-05-PLAN.md — App.jsx: routing uczestnika z planu, localStorage, data-fue-*; Quiz/Break/WaitingResults prezentacyjne (fala 3)
- [ ] 06-06-PLAN.md — LiveView/embed z planu, panel admina na akcjach v2, baner zamiatacza (fala 3)
- [ ] 06-07-PLAN.md — Płynność: Wake Lock, pasek CSS, vibrate, View Transitions, prefetch, szkielet, reduced-motion (fala 4)
- [ ] 06-08-PLAN.md — Sonda: tryby ADMIN_EXIT/REFRESH/OFFLINE + asercja SC5, przebieg na produkcji (fala 5)
- [ ] 06-09-PLAN.md — Bramka: wdrożenie na Vercel, sonda na wdrożeniu, realne telefony, zgoda na utwardzenie (fala 6, checkpoint)
- [ ] 06-10-PLAN.md — SQL sekcja 41: utwardzenie starych RPC, ręczne wgranie (fala 7, checkpoint)
- [ ] 06-11-PLAN.md — Usunięcie kodu legacy (kierowcy, projekcja z modułów) + sondy (fala 8)

---

*Last updated: 2026-04-23 — Plan 01-03 complete*
