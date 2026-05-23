# Bot Runner — FUE Quiz Integration Test (Option A: Happy Path)

**Date:** 2026-05-23  
**Scope:** Standalone Node.js script that simulates admin + N concurrent participants against real Supabase

---

## Goal

A single `npm run bot` command that:
1. Exercises all admin CRUD operations (questions, codes, modules, session, backgrounds)
2. Simulates N concurrent participants completing a full 5-module quiz
3. Verifies correctness of scores, ranking, and DB state after each operation
4. Cleans up all test data even on failure

---

## File Structure

```
scripts/
  bot-runner.js        ← main script
```

```json
// package.json — new script
"bot": "vite-node scripts/bot-runner.js"
```

**Why vite-node:** `src/lib/supabase.js` uses `import.meta.env` (Vite-specific). `vite-node` handles this transparently so the script imports directly from `supabase.js` without any code duplication.

---

## Configuration (.env additions)

| Variable | Default | Description |
|---|---|---|
| `BOT_ADMIN_EMAIL` | — | Admin credentials (required) |
| `BOT_ADMIN_PASSWORD` | — | Admin credentials (required) |
| `BOT_CITY` | `Kraków` | City to run simulation for |
| `BOT_COUNT` | `5` | Number of concurrent participant bots |
| `BOT_ANSWER_DELAY_MS` | `200` | Simulated delay before each bot answers (ms) |

---

## Phase 1: Admin Operations

Run sequentially before the quiz simulation. Each step is verified immediately after.

| Step | Function | Assertion |
|---|---|---|
| A1 | `addQuestion({ city, module, q, opts, ans, exp })` | returned id appears in `getQuestions(city)` |
| A2 | `updateQuestion(id, { q: "updated text" })` | updated text appears in `getQuestions(city)` |
| A3 | `deleteQuestion(id)` | id is absent from `getQuestions(city)` |
| A4 | `generateParticipantCode({ name, city, createdBy })` | code matches `XXX-\d{4}` pattern |
| A5 | `getParticipantCodes(city)` | manually-generated code is in list with `used=false` |
| A6 | `deleteParticipantCode(id)` | code absent from `getParticipantCodes(city)` |
| A7 | `getCityBg(city)` → `setCityBg(city, newBg)` → `getCityBg(city)` | third call returns `newBg`; restore original after |
| A8 | `getModules()` | returns array with length >= 5 |
| A9 | `updateModule(id, { time_per_q: 999 })` → verify → restore original | `time_per_q` changes and is restored |

---

## Phase 2: Quiz Simulation Setup

```
1. getOrCreateSession(BOT_CITY, adminId)
2. updateSession(sessionId, { status: "waiting" })   // reset to clean state
3. generateParticipantCode × BOT_COUNT               // create bot participants
4. getQuestions(BOT_CITY)                            // load question bank
```

---

## Phase 3: Participant Join (concurrent)

```js
await Promise.all(bots.map(bot => 
  validateParticipantCode(bot.code)
    .then(() => markCodeUsed(bot.code, sessionId))
))
```

Assertion: all BOT_COUNT bots have `used=true` in DB.

---

## Phase 4: Quiz Loop

```
Admin: updateSession({ status: "running", q_started_at: now })

For each module (1–5):
  For each question in module:
    Admin: updateSession({ current_question_idx: N, q_started_at: now })
    Wait BOT_ANSWER_DELAY_MS
    Bots: Promise.all → saveAnswer (70% correct, 30% wrong, randomized per bot per question)
    Assert: answers saved = BOT_COUNT for this question

  If module === 2:
    Admin: updateSession({ status: "paused" })
    Admin: updateSession({ status: "running" })   // simulate break end

Admin: updateSession({ status: "ended" })
```

**Note:** Timer simulation uses `BOT_ANSWER_DELAY_MS` as the `timeLeft` value passed to `saveAnswer` — realistic enough to produce non-zero time-bonus points.

---

## Phase 5: Results Verification

```
results = getSessionResults(sessionId)
```

Assertions:
- `results.length === BOT_COUNT`
- Results are sorted descending by total points
- Each bot's recorded total matches `sum(calcPts(timeLeft, maxTime, correct))` for their answers
- Bot with most correct answers has highest score (sanity check across bots)
- All answer counts per bot = total question count

---

## Cleanup (always runs via try/finally)

```
deleteParticipantCode × BOT_COUNT
endAndResetSession(BOT_CITY, adminId)   // leaves session in clean "waiting" state
restore original cityBg if changed
restore original module timePerQ if changed
```

---

## Output Format

```
🔧 ADMIN OPERATIONS
  ✅ addQuestion          → id: abc123
  ✅ updateQuestion       → question text updated
  ✅ deleteQuestion       → absent from getQuestions
  ✅ generateParticipantCode → KRK-1234
  ✅ getParticipantCodes  → code found in list (used=false)
  ✅ deleteParticipantCode → absent from list
  ✅ getCityBg / setCityBg → background updated and restored
  ✅ getModules           → 5 modules found
  ✅ updateModule         → timePerQ updated and restored

🎮 QUIZ SIMULATION (5 botów, Kraków)
  [MOD 1 — Obliczenia] Pytanie 1/N ─── 5/5 odpowiedzi
  [MOD 1 — Obliczenia] Pytanie 2/N ─── 5/5 odpowiedzi
  ...
  [PRZERWA] status paused → running
  ...

📊 WYNIKI
  #1 Bot_3   12 450 pkt  ✅
  #2 Bot_1    9 200 pkt  ✅
  ...
  Ranking posortowany: ✅
  Punkty zgodne z calcPts: ✅

🧹 CLEANUP — done

✅ WSZYSTKIE TESTY PRZESZŁY (23/23)
```

On failure: `❌ <step name> — <error message>` + `process.exit(1)`.

---

## What Is NOT Tested Here (future phases)

- **Option B:** Edge cases (invalid codes, timeout answers, mid-quiz disconnect)
- **Option C:** Load test (100–500 concurrent bots, 5 cities simultaneously)
- **Option D:** E2E browser tests (Playwright)
- **Option E:** Component/unit tests (Vitest + Testing Library)
