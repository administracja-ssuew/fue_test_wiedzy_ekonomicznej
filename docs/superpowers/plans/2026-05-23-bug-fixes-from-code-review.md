# Bug Fixes from Code Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all Critical and Important issues identified in the full-app code review, plus key minor issues.

**Architecture:** Fixes are spread across schema SQL, React screens, hooks, and lib files. Each task is self-contained. DB schema fixes (Task 9) must be applied manually in Supabase SQL editor — the SUPABASE_SCHEMA.sql file is the source of truth.

**Tech Stack:** React 18, Vite, Supabase JS, Vitest

---

## Files Modified / Deleted

| File | Action | Reason |
|------|--------|--------|
| `src/lib/gameLogic.js` | Modify | Remove leaked ADMIN_CODE export |
| `src/lib/gameLogic.test.js` | Modify | Remove broken icon assertion |
| `src/lib/supabase.js` | Modify | Add city to getSessionResults |
| `src/App.jsx` | Modify | handleTimeout guard, podiumResults state, onPodium prop |
| `src/screens/Podium.jsx` | Modify | Replace fakePodium with real results prop |
| `src/screens/AdminPanel.jsx` | Modify | onPodium prop, DB questions for live stats |
| `src/screens/Welcome.jsx` | Commit | Photo path fix already in working copy |
| `src/hooks/useWindowWidth.js` | Modify | SSR-safe init |
| `src/hooks/useSession.js` | **Delete** | Empty stub, never used |
| `src/hooks/useLeaderboard.js` | **Delete** | Empty stub, never used |
| `src/hooks/useTimer.js` | **Delete** | Empty stub, never used |
| `src/screens/Register.jsx` | **Delete** | Dead code — imports non-existent functions |
| `src/screens/Login.jsx` | **Delete** | Dead code — imports non-existent functions |
| `src/screens/Pending.jsx` | **Delete** | Unreachable screen |
| `src/screens/Feedback.jsx` | **Delete** | Unreachable screen |
| `package.json` | Modify | Remove unused react-router-dom |
| `SUPABASE_SCHEMA.sql` | Modify | Add anon SELECT policy for questions, tighten violations, add points CHECK |

---

## Task 1: Commit Welcome.jsx photo paths + fix broken cityInfo test

**Files:**
- Commit working copy: `src/screens/Welcome.jsx`
- Modify: `src/lib/gameLogic.test.js:21–24`

The `cityInfo` test asserts `.icon` which was removed from the `CITIES` data model. Fix the test to assert `.abbr` (which exists) and add a test for the fallback.

- [ ] **Step 1: Verify the uncommitted Welcome.jsx fix is present**

Run:
```bash
cd "C:\Users\Mikołaj\Downloads\fue-quiz-project"
git diff -- src/screens/Welcome.jsx
```
Expected: shows `/kr_wroc.png` → `/kr_wro.png`, `/kr_krakow.png` → `/kr_krk.png`, `/kr_poznan.png` → `/kr_poz.png`

- [ ] **Step 2: Fix the broken cityInfo test in `src/lib/gameLogic.test.js`**

Replace lines 21–27:
```js
// OLD — fails because CITIES has no icon field
describe("cityInfo", () => {
  it("returns correct city info for known city", () => {
    expect(cityInfo("Kraków").icon).toBe("🏰");
  });
  it("returns fallback for unknown city", () => {
    expect(cityInfo("Unknown").color).toBe("#888");
  });
});
```

With:
```js
describe("cityInfo", () => {
  it("returns correct abbr for known city", () => {
    expect(cityInfo("Kraków").abbr).toBe("UEK");
  });
  it("returns correct color for known city", () => {
    expect(cityInfo("Kraków").color).toBe("#FFA653");
  });
  it("returns fallback color for unknown city", () => {
    expect(cityInfo("Unknown").color).toBe("#888");
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd "C:\Users\Mikołaj\Downloads\fue-quiz-project"
npm test
```
Expected: all tests pass (no red).

- [ ] **Step 4: Commit both changes**

```bash
git add src/screens/Welcome.jsx src/lib/gameLogic.test.js
git commit -m "fix: correct photo paths in Welcome + fix cityInfo test assertions"
```

---

## Task 2: Delete 7 dead files

**Files deleted:**
- `src/hooks/useSession.js` (empty stub, never imported)
- `src/hooks/useLeaderboard.js` (empty stub, never imported)
- `src/hooks/useTimer.js` (empty stub, never imported)
- `src/screens/Register.jsx` (dead — imports non-existent `registerUser`)
- `src/screens/Login.jsx` (dead — imports non-existent `loginUser`)
- `src/screens/Pending.jsx` (unreachable screen)
- `src/screens/Feedback.jsx` (unreachable screen)

- [ ] **Step 1: Verify none of these are imported anywhere**

```bash
cd "C:\Users\Mikołaj\Downloads\fue-quiz-project"
grep -r "useSession\|useLeaderboard\|useTimer\|Register\|Login\|Pending\|Feedback" src/App.jsx src/main.jsx
```
Expected output contains: `AdminLogin` (fine), `AdminPanel` (fine). Must NOT contain bare `Register`, `Login`, `Pending`, or `Feedback` screen imports.

Also verify the hooks:
```bash
grep -r "useSession\|useLeaderboard\|useTimer" src/
```
Expected: only the file definitions themselves (no imports).

- [ ] **Step 2: Delete the files**

```bash
cd "C:\Users\Mikołaj\Downloads\fue-quiz-project"
rm src/hooks/useSession.js src/hooks/useLeaderboard.js src/hooks/useTimer.js
rm src/screens/Register.jsx src/screens/Login.jsx src/screens/Pending.jsx src/screens/Feedback.jsx
```

- [ ] **Step 3: Verify build still works**

```bash
npm run build 2>&1 | tail -20
```
Expected: no errors. Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore: delete 7 dead files (unused hooks and unreachable screens)"
```

---

## Task 3: Remove leaked ADMIN_CODE export from gameLogic.js

**Files:**
- Modify: `src/lib/gameLogic.js:3`

`ADMIN_CODE = "FUE2025"` is exported but imported nowhere. It ships in the client bundle, naming the admin password.

- [ ] **Step 1: Remove the export from `src/lib/gameLogic.js`**

Current line 3:
```js
export const ADMIN_CODE = "FUE2025";
```

Remove that line entirely. The file should go from:
```js
import { CITIES, MODULES, QUESTIONS } from "../data/questions.js";

export const ADMIN_CODE = "FUE2025";
export const ANSWER_BG = ["#C2185B", "#1565C0", "#2E7D32", "#E65100"];
```
To:
```js
import { CITIES, MODULES, QUESTIONS } from "../data/questions.js";

export const ANSWER_BG = ["#C2185B", "#1565C0", "#2E7D32", "#E65100"];
```

- [ ] **Step 2: Verify nothing imports ADMIN_CODE**

```bash
cd "C:\Users\Mikołaj\Downloads\fue-quiz-project"
grep -r "ADMIN_CODE" src/
```
Expected: no output.

- [ ] **Step 3: Run tests**

```bash
npm test
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/gameLogic.js
git commit -m "fix(security): remove ADMIN_CODE export from client bundle"
```

---

## Task 4: Fix handleTimeout double-fire guard in App.jsx

**Files:**
- Modify: `src/App.jsx:177`

`handleTimeout` can fire twice if the interval ticks while state is still updating. Clearing the interval as the very first line prevents a second invocation from running.

- [ ] **Step 1: Edit `src/App.jsx` — add clearInterval as first line of handleTimeout**

Current `handleTimeout` function (line 177):
```js
const handleTimeout = () => {
  if (answered) return;
  const userPicked  = picked;
```

Change to:
```js
const handleTimeout = () => {
  clearInterval(timerRef.current);
  if (answered) return;
  const userPicked  = picked;
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "fix: prevent handleTimeout double-fire by clearing interval immediately"
```

---

## Task 5: Fix useWindowWidth SSR crash

**Files:**
- Modify: `src/hooks/useWindowWidth.js:4`

`useState(window.innerWidth)` crashes in test environments and any context without a DOM.

- [ ] **Step 1: Edit `src/hooks/useWindowWidth.js`**

Current:
```js
const [w, setW] = useState(window.innerWidth);
```

Change to:
```js
const [w, setW] = useState(() => typeof window !== "undefined" ? window.innerWidth : 900);
```

- [ ] **Step 2: Run tests**

```bash
npm test
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWindowWidth.js
git commit -m "fix: safe window.innerWidth init in useWindowWidth (SSR/test compat)"
```

---

## Task 6: Remove unused react-router-dom dependency

**Files:**
- Modify: `package.json`

`react-router-dom` is listed as a dependency but not used anywhere. Adds ~25KB to bundle.

- [ ] **Step 1: Verify it's unused**

```bash
cd "C:\Users\Mikołaj\Downloads\fue-quiz-project"
grep -r "react-router" src/
```
Expected: no output.

- [ ] **Step 2: Remove from package.json**

In `package.json`, remove the line:
```json
"react-router-dom": "^6.30.3",
```

- [ ] **Step 3: Update lockfile**

```bash
npm install
```
Expected: package-lock.json updated, no errors.

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove unused react-router-dom dependency"
```

---

## Task 7: Fix AdminPanel live stats to use DB questions

**Files:**
- Modify: `src/screens/AdminPanel.jsx` — `SesjaTab` component (lines 230–419)

The live stats polling loop (line 257–263) imports hardcoded `QUESTIONS` and looks up by index. DB questions for the city may differ. Fix: load city's DB questions once in `SesjaTab`, use them for the `getLiveQuestionStats` call.

- [ ] **Step 1: Add `cityQuestions` state and load it in `SesjaTab`**

In `SesjaTab` (after line 238 where `pollRef` is declared), add:
```js
const [cityQuestions, setCityQuestions] = useState([]);
```

Update the `load` function (currently line 242) to also load questions:
```js
const load = async (practice = isPractice) => {
  setLoading(true);
  const { data } = await getOrCreateSession(city, adminId, practice);
  setSession(data);
  if (data) {
    setParticipants(await getParticipantsInSession(city));
    if (data.status === "ended") setResults(await getSessionResults(data.id));
  }
  const qs = await getQuestions(city);
  setCityQuestions(qs);
  setLoading(false);
};
```

- [ ] **Step 2: Replace the hardcoded QUESTIONS lookup in the polling useEffect**

Current polling code (lines 257–264):
```js
pollRef.current = setInterval(async () => {
  const qs = await import("../data/questions.js");
  const questions = qs.QUESTIONS;
  const q = questions[session.current_question_idx];
  if (q && session.id) {
    const stats = await getLiveQuestionStats(session.id, q.id);
    setLiveStats(stats);
  }
```

Replace with (uses `cityQuestions` from state):
```js
pollRef.current = setInterval(async () => {
  const q = cityQuestions[session.current_question_idx];
  if (q && session.id) {
    const stats = await getLiveQuestionStats(session.id, q.id);
    setLiveStats(stats);
  }
```

Also add `cityQuestions` to the useEffect dependency array (line 273):
```js
}, [session?.status, session?.current_question_idx, cityQuestions]);
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/screens/AdminPanel.jsx
git commit -m "fix: use DB questions for AdminPanel live stats (not hardcoded array)"
```

---

## Task 8: Wire Podium to real results data

**Files:**
- Modify: `src/lib/supabase.js` — `getSessionResults` (line 269)
- Modify: `src/screens/Podium.jsx`
- Modify: `src/screens/AdminPanel.jsx` — `SesjaTab` and `AdminPanel` component
- Modify: `src/App.jsx` — add `podiumResults` state and `onPodium` prop

Currently `Podium.jsx` shows `fakePodium` (hardcoded names). Real results from `getSessionResults` exist in `SesjaTab.results` but aren't passed to Podium. The `answers` table already has a `city` column — just need to select it.

- [ ] **Step 1: Update `getSessionResults` to include city in `src/lib/supabase.js`**

Current SELECT (line 281–283):
```js
const { data } = await supabase.from("answers")
  .select("participant_code, participant_name, points")
  .eq("session_id", sessionId);
```

Change to:
```js
const { data } = await supabase.from("answers")
  .select("participant_code, participant_name, city, points")
  .eq("session_id", sessionId);
```

Update the `grouped` accumulator (line 287–289) to include city:
```js
if (!grouped[row.participant_code])
  grouped[row.participant_code] = { code: row.participant_code, name: row.participant_name, city: row.city, points: 0 };
```

- [ ] **Step 2: Update `PodiumScreen` in `src/screens/Podium.jsx` to accept `results` prop**

Replace the entire `fakePodium` and `PodiumScreen` function with:

```js
import { cityInfo } from "../lib/gameLogic.js";

function PodiumScreen({ onBack, podStep, setPodStep, results = [] }) {
  const confColors = ["#F5C518", "#6B21E8", "#E8376B", "#10D9A0", "#1EB5FF"];
  const podium = results.slice(0, 3); // top 3 only

  return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE" }}>
      <div className="fue-page" style={{ justifyContent: "space-between", padding: "40px 22px 32px", overflow: "hidden", position: "relative" }}>
        {podStep >= 3 && Array.from({ length: 24 }).map((_, i) => (
          <div key={i} style={{ position: "absolute", top: -10, left: `${3 + i * 4}%`, width: 7 + (i % 3) * 3, height: 7 + (i % 3) * 3, borderRadius: i % 2 ? "50%" : 3, background: confColors[i % 5], animation: `conffall ${1.4 + (i % 4) * .3}s ${i * .07}s ease-in both`, zIndex: 10 }} />
        ))}

        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>🐐 Test Wiedzy Ekonomicznej · FUE {new Date().getFullYear()}</p>
          <h1 style={{ fontFamily: '"Bebas Neue"', fontSize: 60, letterSpacing: 3, color: podStep >= 3 ? "#F5C518" : "#EDE9FE", transition: "color .5s", lineHeight: 1 }}>
            {podStep === 0 ? "CEREMONIA" : podStep >= 3 ? "PODIUM!" : "I OTO…"}
          </h1>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 10, padding: "10px 0" }}>
          {[2, 0, 1].map((rank) => {
            const p = podium[rank];
            const heights = [170, 100, 130];
            const colors = ["linear-gradient(180deg,#F5C518,#B8940A)", "linear-gradient(180deg,#A0622A,#6B3A12)", "linear-gradient(180deg,#A0A0A0,#6A6A6A)"];
            const glows = ["rgba(245,197,24,.5)", "rgba(205,127,50,.35)", "rgba(192,192,192,.3)"];
            const visible = podStep >= (rank === 0 ? 3 : rank === 1 ? 1 : 2);
            if (!p) return <div key={rank} style={{ flex: 1, height: heights[rank] }} />;
            return (
              <div key={rank} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", opacity: visible ? 1 : 0, transition: "opacity .5s" }}>
                {visible && (
                  <div className="pi" style={{ textAlign: "center", marginBottom: 8 }}>
                    {rank === 0 && <div style={{ fontSize: 20, marginBottom: 4 }}>👑</div>}
                    <div style={{ width: rank === 0 ? 52 : 44, height: rank === 0 ? 52 : 44, borderRadius: "50%", background: colors[rank], display: "flex", alignItems: "center", justifyContent: "center", fontSize: rank === 0 ? 22 : 18, fontWeight: 800, margin: "0 auto 5px", color: rank === 0 ? "#07021A" : "#fff", ...(rank === 0 ? { animation: "glow 2s infinite" } : {}) }}>
                      {p.name.charAt(0)}
                    </div>
                    <p style={{ fontSize: rank === 0 ? 12 : 11, fontWeight: 700, color: rank === 0 ? "#F5C518" : "#EDE9FE" }}>{p.name.split(" ")[0]}</p>
                    <p style={{ fontSize: 10, color: "#9B89CC" }}>{p.city}</p>
                    <p style={{ fontSize: rank === 0 ? 14 : 12, fontWeight: 700, color: rank === 0 ? "#F5C518" : "#9B89CC", marginTop: 2 }}>{p.points} pkt</p>
                  </div>
                )}
                <div style={{ width: "100%", height: heights[rank], background: colors[rank], borderRadius: "10px 10px 0 0", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 ${rank === 0 ? 40 : 20}px ${glows[rank]}` }}>
                  <span style={{ fontFamily: '"Bebas Neue"', fontSize: rank === 0 ? 56 : 36, color: rank === 0 ? "#07021A" : "#fff" }}>{rank + 1}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div>
          {podStep < 3 ? (
            <button style={{ background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", border: "none", borderRadius: 12, padding: "16px", fontSize: 15, fontWeight: 700, width: "100%", cursor: "pointer" }} onClick={() => setPodStep((s) => s + 1)}>
              {podStep === 0 ? "🎯 Pokaż 3. miejsce" : podStep === 1 ? "🥈 Pokaż 2. miejsce" : "🥇 Pierwsze miejsce!"}
            </button>
          ) : (
            <div style={{ textAlign: "center" }}>
              <p style={{ color: "#9B89CC", fontSize: 13, marginBottom: 14 }}>Gratulacje dla wszystkich uczestników! 🎉</p>
              <button style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "13px 32px", color: "#C4B5FD", fontSize: 14, cursor: "pointer" }} onClick={onBack}>
                Wróć do panelu
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PodiumScreen;
```

- [ ] **Step 3: Add `onPodium` prop to `AdminPanel` component and propagate it to `SesjaTab`**

In `src/screens/AdminPanel.jsx`:

Update `AdminPanel` function signature (line 894):
```js
export default function AdminPanel({ admin, isDesktop, onLogout, onPodium }) {
```

Update where `SesjaTab` is rendered (line 934):
```js
{tab === "sesja" && <SesjaTab city={city} adminId={admin?.id} onPodium={onPodium} />}
```

Update `SesjaTab` function signature (line 230):
```js
function SesjaTab({ city, adminId, onPodium }) {
```

- [ ] **Step 4: Add "Pokaż podium" button in `SesjaTab` results section**

In `SesjaTab`, find the results section (line 405):
```js
{session?.status === "ended" && results.length > 0 && (
  <div>
    <p style={{ fontSize: 11, color: "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Wyniki końcowe</p>
```

Add a "Pokaż podium" button right after the `<p>` heading:
```js
{session?.status === "ended" && results.length > 0 && (
  <div>
    <p style={{ fontSize: 11, color: "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Wyniki końcowe</p>
    {onPodium && (
      <button style={{ ...C.btn("gold", { width: "100%", marginBottom: 16 }) }} onClick={() => onPodium(results)}>
        🏆 Pokaż podium ceremonię
      </button>
    )}
```

- [ ] **Step 5: Update `App.jsx` — add `podiumResults` state and wire `onPodium`**

In `src/App.jsx`, after the `podStep` state (line 39):
```js
const [podStep, setPodStep]           = useState(0);
const [podiumResults, setPodiumResults] = useState([]);
```

Update the `AdminPanel` render (line 376):
```js
if (screen === "admin")
  return <AdminPanel admin={admin} isDesktop={isDesktop} onLogout={handleAdminLogout} onPodium={(results) => { setPodiumResults(results); setPodStep(0); setScreen("podium"); }} />;
```

Update the `Podium` render (line 378):
```js
if (screen === "podium")
  return <Podium onBack={() => setScreen("admin")} podStep={podStep} setPodStep={setPodStep} results={podiumResults} />;
```

- [ ] **Step 6: Verify build**

```bash
npm run build 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase.js src/screens/Podium.jsx src/screens/AdminPanel.jsx src/App.jsx
git commit -m "fix: wire Podium to real results — add city to getSessionResults, onPodium callback"
```

---

## Task 9: DB schema fixes (SQL — apply in Supabase SQL editor)

**Files:**
- Modify: `SUPABASE_SCHEMA.sql` (source of truth)

**⚠️ These changes must also be run manually in the Supabase SQL editor. Adding them to `SUPABASE_SCHEMA.sql` keeps the file in sync.**

Three fixes:
1. Add anon SELECT policy for `questions` table (CRIT-4 — silent production blocker)
2. Tighten `violations_anon_insert` to prevent flooding (CRIT-5)
3. Add CHECK constraint on `answers.points` (CRIT-3 minimum mitigation)

- [ ] **Step 1: Add the three SQL blocks to `SUPABASE_SCHEMA.sql`**

After line 86 (after the `questions` policies block), add:
```sql
-- Allow anonymous participants to read questions (required for quiz to work)
CREATE POLICY "questions_anon_select" ON public.questions FOR SELECT USING (true);
GRANT SELECT ON public.questions TO anon;
```

Change the violations insert policy (line 150) from:
```sql
CREATE POLICY "violations_anon_insert" ON public.violations FOR INSERT WITH CHECK (true);
```
To:
```sql
CREATE POLICY "violations_anon_insert" ON public.violations FOR INSERT
  WITH CHECK (participant_code IN (SELECT code FROM public.participant_codes WHERE used = true));
```

After the answers table definition (after line 128), add:
```sql
ALTER TABLE public.answers ADD CONSTRAINT answers_points_range CHECK (points BETWEEN 0 AND 1000);
```

- [ ] **Step 2: Apply the SQL in Supabase SQL editor**

Copy and run the following in the Supabase dashboard → SQL editor:

```sql
-- CRIT-4: Allow participants (anon) to read questions
CREATE POLICY "questions_anon_select" ON public.questions FOR SELECT USING (true);
GRANT SELECT ON public.questions TO anon;

-- CRIT-5: Restrict violation inserts to real participant codes only
DROP POLICY IF EXISTS "violations_anon_insert" ON public.violations;
CREATE POLICY "violations_anon_insert" ON public.violations FOR INSERT
  WITH CHECK (participant_code IN (SELECT code FROM public.participant_codes WHERE used = true));

-- CRIT-3: Prevent absurd point values from client manipulation
ALTER TABLE public.answers ADD CONSTRAINT answers_points_range CHECK (points BETWEEN 0 AND 1000);
```

Expected: all 4 statements succeed (CREATE POLICY × 2, GRANT, ALTER TABLE).

- [ ] **Step 3: Commit the schema file update**

```bash
git add SUPABASE_SCHEMA.sql
git commit -m "fix(schema): anon questions access, tighten violations policy, add points CHECK"
```

---

## Self-Review Checklist

**CRIT-1 (ADMIN_CODE in bundle):** Fixed in Task 3 — export removed.
**CRIT-2 (fake podium):** Fixed in Task 8 — real results passed via prop.
**CRIT-3 (client-side score manipulation):** Partially mitigated in Task 9 — CHECK constraint.
**CRIT-4 (questions not readable by anon):** Fixed in Task 9 — anon SELECT policy added.
**CRIT-5 (violations flooding):** Fixed in Task 9 — policy tightened.
**IMP-1 (race condition — 100 participants write session state):** **Not fixed in this plan.** Proper fix requires adding admin-driven "Next question" button. Acknowledged architectural limitation — practical impact low for 100 users/city event.
**IMP-2 (stub hooks):** Fixed in Task 2 — deleted.
**IMP-3 (dead screens with broken imports):** Fixed in Task 2 — deleted.
**IMP-4 (AdminPanel hardcoded questions):** Fixed in Task 7 — uses DB questions.
**IMP-5 (refresh loses score):** **Not fixed.** Score re-display after refresh requires local persistence (out of scope here — no data loss, just display issue on Ended screen).
**IMP-6 (handleTimeout double-fire):** Fixed in Task 4.
**IMP-7 (unreachable screens):** Fixed in Task 2 — deleted.
**MIN — cityInfo test:** Fixed in Task 1.
**MIN — useWindowWidth crash:** Fixed in Task 5.
**MIN — react-router-dom:** Fixed in Task 6.
**MIN — Welcome.jsx photo paths:** Fixed in Task 1 (commit).
