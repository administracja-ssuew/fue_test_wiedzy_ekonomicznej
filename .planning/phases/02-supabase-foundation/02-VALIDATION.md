---
phase: 2
slug: supabase-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 2 — Validation Strategy

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 |
| **Config file** | `fue-quiz/vite.config.js` (test section) |
| **Quick run command** | `cd fue-quiz && npm test` |
| **Full suite command** | `cd fue-quiz && npm test -- --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd fue-quiz && npm test`
- **After schema tasks:** Manually verify in Supabase SQL Editor
- **After auth tasks:** Manual browser test: register → pending → login

---

## Wave Validation Map

### Wave 1 — DB Schema + RLS
**After:** `npm test` (existing gameLogic tests must still pass)
**Manual:** Run SQL verification queries in Supabase SQL Editor (see RESEARCH.md §2)
```sql
-- Verify tables exist
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- Should include: profiles, quiz_sessions, participants, answers

-- Verify RLS enabled
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
```

### Wave 2 — Auth Wiring (useAuth + supabase.js)
**After:** `npm test` (no regressions)
**Manual:** DEMO mode must still work (env vars not set → localStorage fallback)
```bash
# In fue-quiz/.env.local — temporarily unset vars, test DEMO mode
# Then set real vars, test Supabase login
```

### Wave 3 — Admin Flows (login, verify, create session)
**After:** `npm test`
**Manual:**
1. Admin logs in with Supabase credentials → no "FUE2025" code
2. Session survives page refresh (localStorage token)
3. JWT expires_at ≥ 4h from login

### Wave 4 — Participant Flows (register, verify, join)
**After:** `npm test`
**Manual:**
1. Register → pending screen shown
2. Admin approves → participant can log in
3. Participant enters 6-digit code → Lobby

---

## Must-Haves (Phase Goal Verification)

- [ ] Admin login via Supabase Auth, no hardcoded "FUE2025" code
- [ ] Participant registration creates profile with `verified: false`
- [ ] Admin can approve/reject pending participants
- [ ] Session created with unique 6-digit code
- [ ] Participant joins session via code → lands in Lobby
- [ ] DEMO mode still works when `VITE_SUPABASE_URL` is not set
- [ ] RLS: participant cannot read another city's data
