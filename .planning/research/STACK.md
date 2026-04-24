# Technology Stack

**Project:** FUE Quiz — Test Wiedzy Ekonomicznej
**Focus:** Supabase Realtime integration into React 18 + Vite PWA
**Researched:** 2026-04-23
**Overall confidence:** HIGH (based on @supabase/supabase-js v2 API, vite-plugin-pwa, React Router v6 — all well-documented and stable)

---

## Current Package Baselines

Installed versions from `fue-quiz/package.json` (floor, not ceiling):

| Package | Installed | Notes |
|---------|-----------|-------|
| `@supabase/supabase-js` | `^2.45.0` | Upgrade to latest 2.x before building Realtime features |
| `react` | `^18.3.1` | Current; 19 is stable but migration is out of scope |
| `react-dom` | `^18.3.1` | Matches react |
| `vite` | `^5.4.8` | Current 5.x; Vite 6 exists but not required |
| `vite-plugin-pwa` | `^0.21.1` | Upgrade to latest 0.x — active releases in 2024–2025 |
| `@vitejs/plugin-react` | `^4.3.1` | Current |

**Action:** Run `npm update` in `fue-quiz/` before starting backend work to pull latest patch releases within semver range.

---

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| React | 18.3.x | UI | Already installed; hooks model (useEffect, useState, useContext) is the right mental model for Supabase subscriptions |
| Vite | 5.4.x | Dev server + bundler | Already installed; `VITE_` env var support, fast HMR |
| @vitejs/plugin-react | 4.3.x | React JSX transform | Already installed |

### Supabase Client

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@supabase/supabase-js` | `^2.x` (latest 2.x) | Auth + DB + Realtime | v2 is the stable, supported SDK. v1 is end-of-life. The client is a singleton — create once in `src/lib/supabase.js`, import everywhere. |

**Upgrade command:**
```bash
npm install @supabase/supabase-js@latest
```

### Routing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `react-router-dom` | `^6.x` (6.20+ preferred) | Client-side routing | App.jsx currently uses a manual `screen` state machine (~1,200 lines). React Router v6 replaces this with `<Routes>/<Route>` and enables code-splitting per screen. v6 (not v7) because: v7 is a breaking rename to React Router Framework / Remix-mode; v6 is stable, declarative, and widely documented for Vite SPAs. |

**Install command:**
```bash
npm install react-router-dom@^6
```

### PWA

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `vite-plugin-pwa` | `^0.21.x` (latest 0.x) | Service worker + manifest | Already configured. The current config is correct. Key concern: service worker must NOT intercept WebSocket connections to Supabase Realtime — handled automatically because Workbox only caches HTTP/HTTPS fetch, not WebSocket upgrades. No additional configuration needed for coexistence. |

### Testing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `vitest` | `^2.x` | Unit testing | Same config as Vite; zero additional setup for a Vite project. The codebase has zero tests today. Add Vitest alongside the refactor. |
| `@testing-library/react` | `^16.x` | React component testing | The standard; pairs with Vitest via jsdom. |

**Install command:**
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

---

## Supabase Realtime — API Decisions

### Broadcast vs. postgres_changes — Choose Broadcast

There are two Realtime channel types. This project should use **Broadcast** for quiz state synchronization, not `postgres_changes`.

| Aspect | Broadcast | postgres_changes |
|--------|-----------|-----------------|
| What it is | Pub/sub message bus; messages not stored in DB | Listens to Postgres WAL; fires on INSERT/UPDATE/DELETE |
| Latency | Very low (~50–100 ms) | Higher (WAL → replication → Realtime server) |
| Persistence | No — ephemeral | Yes — changes persist in DB |
| Auth requirement | Anon key sufficient | RLS policies must allow SELECT on changed table |
| Use case | "Question 3 starts now", "Timer tick", "Show leaderboard" | "New user registered", "Session status changed" |
| Scale (500 connections) | Handles comfortably on Free tier | Fine, but adds DB load |

**Decision: use Broadcast for all real-time quiz events** (question advance, timer, answers collected, show podium). Use `postgres_changes` only for the admin live-participant counter (watching `profiles` inserts during lobby) because that genuinely needs persistence.

### Broadcast API (HIGH confidence)

```javascript
// Admin: send quiz event
const channel = supabase.channel('session:abc123')

channel.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    channel.send({
      type: 'broadcast',
      event: 'question_start',
      payload: { questionIndex: 3, moduleId: 2, timeLimit: 30 }
    })
  }
})

// Participant: receive quiz event
const channel = supabase.channel('session:abc123')

channel.on('broadcast', { event: 'question_start' }, ({ payload }) => {
  setCurrentQuestion(payload.questionIndex)
  startTimer(payload.timeLimit)
})

channel.subscribe()

// Cleanup — always unsubscribe on component unmount
return () => { supabase.removeChannel(channel) }
```

**Channel naming convention:** `session:{sessionId}` — scopes all events to one quiz session. Admin and all participants subscribe to the same channel name.

### postgres_changes API for Lobby Counter (HIGH confidence)

```javascript
// Admin: watch participant joins in real time
const channel = supabase
  .channel('lobby:abc123')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'quiz_session_participants' },
    (payload) => {
      setParticipantCount(c => c + 1)
    }
  )
  .subscribe()

return () => { supabase.removeChannel(channel) }
```

Note: This requires a `quiz_session_participants` join table (not yet in schema). The alternative is to use Broadcast when participants join — participant sends `{ type: 'broadcast', event: 'joined', payload: { name } }`, admin counts. Broadcast approach avoids the schema addition and is recommended for MVP.

### Channel Lifecycle in React — useEffect Pattern (HIGH confidence)

```javascript
// Correct pattern: subscribe in useEffect, unsubscribe in cleanup
useEffect(() => {
  if (!sessionId) return

  const channel = supabase.channel(`session:${sessionId}`)

  channel.on('broadcast', { event: 'question_start' }, ({ payload }) => {
    setCurrentQuestion(payload)
  })

  channel.subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [sessionId]) // Re-subscribe when sessionId changes
```

**React 18 StrictMode:** In development, StrictMode mounts components twice (double-invoke). This causes duplicate subscriptions. The cleanup function (`supabase.removeChannel`) must be present for StrictMode to work correctly. This is already the correct pattern above.

**Never** put `channel.subscribe()` outside useEffect — it would fire on every render.

---

## Supabase Auth — Session Persistence Pattern

### signInWithPassword (HIGH confidence)

```javascript
// Already in src/lib/supabase.js — this is correct
const { data, error } = await supabase.auth.signInWithPassword({ email, password })
```

### Session Persistence — Use onAuthStateChange (HIGH confidence)

The current `getCurrentUser()` calls `supabase.auth.getUser()` on demand, which makes an API call every time. The recommended pattern for React apps is to use `onAuthStateChange` once at the app root and hold the session in React state.

```javascript
// In a top-level component or Context provider
useEffect(() => {
  // Get initial session (synchronous from localStorage)
  supabase.auth.getSession().then(({ data: { session } }) => {
    setUser(session?.user ?? null)
  })

  // Subscribe to future changes (login, logout, token refresh)
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (_event, session) => {
      setUser(session?.user ?? null)
    }
  )

  return () => subscription.unsubscribe()
}, [])
```

**Why this matters:** Supabase v2 persists sessions in `localStorage` by default. On page refresh, `getSession()` returns the cached session without a network call. `onAuthStateChange` fires on the initial load too, so both calls are needed: `getSession()` for immediate synchronous hydration, `onAuthStateChange` for async updates including token refresh.

### Admin Role Check Pattern

The current app has a hardcoded `ADMIN_CODE = "FUE2025"` string. Replace with a role check against the `profiles` table:

```javascript
// After login, fetch profile to get role
const { data: profile } = await supabase
  .from('profiles')
  .select('role')
  .eq('id', user.id)
  .single()

const isAdmin = ['city_admin', 'global_admin'].includes(profile?.role)
```

---

## Environment Variables in Vite (HIGH confidence)

`src/lib/supabase.js` already uses the correct pattern:

```javascript
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
```

**Rules:**
- Any variable exposed to the browser **must** be prefixed `VITE_`
- Variables without `VITE_` prefix are server-side only — Vite will not include them in the bundle
- Do NOT use `SUPABASE_SERVICE_ROLE_KEY` in frontend code. The service role key bypasses RLS and must never be in client-side code
- Variables are inlined at build time — changing them requires a rebuild (no runtime injection)

**`.env` structure:**
```
VITE_SUPABASE_URL=https://yourproject.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

**Vercel deployment:** Add these same two variables in Vercel Dashboard → Project → Settings → Environment Variables. Do not commit `.env` to git.

**Startup validation (recommended fix from CONCERNS.md):**
```javascript
// src/lib/supabase.js — add at top
if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('[FUE] Running in DEMO mode — Supabase credentials not set.')
}
```

---

## vite-plugin-pwa + Supabase Realtime Coexistence (HIGH confidence)

**No conflict exists.** Workbox (the library vite-plugin-pwa uses) intercepts `fetch` events — HTTP/HTTPS requests. Supabase Realtime uses WebSockets (the `wss://` protocol), which are not fetch events and are therefore not intercepted by service workers at all.

**The current `vite.config.js` is correct and needs no changes** for Realtime to work.

One important addition: add `NetworkOnly` caching for Supabase API calls so the service worker never serves stale auth tokens or stale data from cache:

```javascript
// vite.config.js — add to workbox.runtimeCaching
{
  urlPattern: /^https:\/\/[a-z]+\.supabase\.co\/.*/i,
  handler: 'NetworkOnly',
}
```

This ensures all Supabase REST API calls (not Realtime WebSocket, but the initial fetch calls) bypass the cache entirely.

---

## React Router v6 — Adding to Existing App

### Installation

```bash
npm install react-router-dom@^6
```

### Integration Pattern for Existing Vite SPA

Wrap the app root in `<BrowserRouter>` in `src/main.jsx`:

```javascript
import { BrowserRouter } from 'react-router-dom'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
```

Replace the current `screen` state machine in `App.jsx` with `<Routes>`:

```javascript
import { Routes, Route, Navigate } from 'react-router-dom'

// Protected route wrapper
function RequireAuth({ children }) {
  const { user } = useAuth() // custom context
  return user ? children : <Navigate to="/login" replace />
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<WelcomeScreen />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/register" element={<RegisterScreen />} />
      <Route path="/lobby" element={<RequireAuth><LobbyScreen /></RequireAuth>} />
      <Route path="/quiz" element={<RequireAuth><QuizScreen /></RequireAuth>} />
      <Route path="/results" element={<RequireAuth><ResultsScreen /></RequireAuth>} />
      <Route path="/podium" element={<RequireAuth><PodiumScreen /></RequireAuth>} />
      <Route path="/admin" element={<RequireAdmin><AdminPanel /></RequireAdmin>} />
    </Routes>
  )
}
```

**Why v6, not v7:** React Router v7 rebrands as "React Router Framework" and tightly integrates with Remix's server-rendering model. For a Vite SPA with no SSR, v6's `createBrowserRouter` / `<BrowserRouter>` is the correct, stable, and well-documented target. The migration from v6 to v7 is a separate project-scope decision.

### PWA + React Router: historyApiFallback

For PWAs with client-side routing, the server must return `index.html` for all routes (so React Router handles them, not a 404). Vercel does this automatically for SPAs. No additional configuration needed.

---

## Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react-router-dom` | `^6` | Navigation between screens | Required — replace App.jsx state machine |
| `vitest` | `^2` | Unit testing | Required — add alongside refactor |
| `@testing-library/react` | `^16` | Component testing | Required — pairs with Vitest |
| `jsdom` | `^25` | DOM environment for tests | Required — Vitest needs a DOM environment |

**Explicitly NOT adding:**
- React Query / TanStack Query — out of scope per PROJECT.md; Supabase client + useState is sufficient
- Redux / Zustand — out of scope per PROJECT.md; React Context for auth state is sufficient
- Tailwind / MUI / Chakra — out of scope per PROJECT.md; custom inline styles are the design system
- Socket.io — not needed; Supabase Realtime replaces it

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Realtime transport | Supabase Broadcast | Socket.io | Supabase is already the backend; adding Socket.io means a separate Node.js server to host and pay for |
| Realtime transport | Supabase Broadcast | Supabase postgres_changes | postgres_changes adds WAL lag and DB load; Broadcast is lower latency for ephemeral quiz events |
| Routing | react-router-dom v6 | Manual screen state (current) | State machine in App.jsx is 1,200 lines; it is the primary architectural concern identified in CONCERNS.md |
| Routing | react-router-dom v6 | react-router-dom v7 | v7 is oriented toward SSR/Remix; overkill for this SPA |
| Testing | Vitest | Jest | Vitest is native to Vite; zero configuration needed; Jest requires babel transform for ESM |
| Auth persistence | onAuthStateChange | Manual getUser() per screen | getUser() makes a network round-trip each call; onAuthStateChange reads localStorage synchronously |

---

## Supabase Free Tier — Capacity for This Project

**Confirmed adequate for scale (confidence: MEDIUM — based on Supabase public pricing as of 2025):**

| Limit | Free Tier | This Project's Need |
|-------|-----------|---------------------|
| Realtime concurrent connections | 200 | 500 max (I etap: 5 cities x 100). Needs **Pro tier** or connection pooling strategy |
| Database size | 500 MB | Tiny (quiz data, ~500 rows) |
| Auth users | 50,000 | ~500 participants |
| API requests/month | 5 million | Well within range |

**CRITICAL FINDING: 500 concurrent Realtime connections exceeds Supabase Free tier limit of 200.**

Options:
1. Upgrade to Supabase Pro ($25/month) — 500 concurrent connections included. Recommended.
2. Architecture workaround: Run I etap as 5 separate Supabase channels (one per city), each with 100 connections max. Then finał has 25 connections. This keeps Free tier viable if 5 channels each stay under 200.
3. Accept Free tier and cap per-city sessions at 100 (already the design) — if Free tier is actually 200 connections per channel (not per project), option 2 works.

**Verify the exact concurrent connection limit for your Supabase project tier before launch.** This is the most important infrastructure constraint for this project.

---

## Sources

- Project codebase: `fue-quiz/package.json`, `fue-quiz/src/lib/supabase.js`, `fue-quiz/vite.config.js`, `fue-quiz/SUPABASE_SCHEMA.sql`
- Project context: `.planning/PROJECT.md`, `.planning/codebase/STACK.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/INTEGRATIONS.md`
- @supabase/supabase-js v2 API: training knowledge (cutoff Aug 2025), HIGH confidence — v2 API has been stable since 2022
- vite-plugin-pwa Workbox behavior: training knowledge (cutoff Aug 2025), HIGH confidence — Workbox fetch interception is a web platform standard
- React Router v6: training knowledge (cutoff Aug 2025), HIGH confidence — v6 stable since 2021
- Supabase Free tier limits: MEDIUM confidence — verify at https://supabase.com/pricing before launch
