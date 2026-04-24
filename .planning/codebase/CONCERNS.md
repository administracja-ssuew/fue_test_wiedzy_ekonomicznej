# Codebase Concerns

**Analysis Date:** 2026-04-23

## Critical Security Issues

**Admin Password Hardcoded:**
- Issue: Admin login code hardcoded as "FUE2025" in `src/App.jsx` line 12
- Files: `src/App.jsx` (line 12), `src/App.jsx` (line 864 — authentication check)
- Impact: Any person can access admin panel with hardcoded string; no brute-force protection; password exposed in source code and browser
- Severity: **CRITICAL**
- Fix approach: Move admin code to environment variable; implement rate-limiting on admin login; use proper authentication backend (Supabase auth roles)

**Password Storage in localStorage (Demo Mode):**
- Issue: Passwords stored as plaintext in browser localStorage when in DEMO mode
- Files: `src/lib/supabase.js` (lines 13-40, loginUser function)
- Impact: Passwords vulnerable to XSS attacks, accidental exposure; no encryption or hashing
- Severity: **HIGH** (demo-only, but dangerous if demo becomes production)
- Fix approach: Never store passwords client-side; use Supabase Auth exclusively; remove password storage from demo mode

**Email Duplication Check Not Implemented Properly:**
- Issue: Demo mode only checks if email exists in localStorage; no verification email, no confirmation flow
- Files: `src/lib/supabase.js` (lines 14-15)
- Impact: User could register with someone else's email address without consequences; no identity verification in production either
- Severity: **HIGH**
- Fix approach: Implement email verification flow with tokens; enforce Supabase email verification

## Architectural Concerns

**Monolithic 1,200-line Component:**
- Issue: All UI screens, state management, and logic crammed into single `src/App.jsx` file
- Files: `src/App.jsx` (1206 lines)
- Impact: Unmaintainable; difficult to test; state management scattered across 150+ useState calls; component re-renders entire app on any state change; nearly impossible to debug
- Severity: **HIGH**
- Fix approach: Split into screen components (`/screens/*`), separate state management (Context or Redux), extract utilities, create reusable components

**No Error Boundaries:**
- Issue: No React Error Boundary component; runtime errors crash entire app
- Files: `src/App.jsx` (no error boundary present)
- Impact: Single component error takes down entire quiz for user; poor UX for error scenarios
- Severity: **MEDIUM**
- Fix approach: Wrap routes in Error Boundary component; implement fallback UI for errors

**Demo Mode Silently Falls Back on Missing Env Vars:**
- Issue: If Supabase env vars missing, entire app goes to localStorage mode without warning
- Files: `src/lib/supabase.js` (lines 3-8)
- Impact: Developer might not realize they're in demo mode; data loss when browser cache clears; no indication to admin about production readiness
- Severity: **MEDIUM**
- Fix approach: Explicit configuration mode check; warning banner when in DEMO; separate demo app from production

## State Management & Data Persistence

**No Authentication Persistence:**
- Issue: In DEMO mode, user login resets on page refresh (localStorage key is cleared)
- Files: `src/lib/supabase.js` (lines 48-54, logoutUser clears session)
- Impact: Users lose session on accidental refresh; demo experience breaks; no real session management
- Severity: **MEDIUM**
- Fix approach: Use sessionStorage for DEMO persistence; implement actual session tokens with expiry

**No Data Validation:**
- Issue: Form inputs accepted without sanitization; no validation on Supabase inserts
- Files: `src/App.jsx` (lines 762-770, RegisterScreen submit function does minimal checks)
- Impact: Invalid data in database; XSS vectors through user input; quiz results corrupted
- Severity: **HIGH**
- Fix approach: Validate all inputs against schema; sanitize before rendering; use Supabase Row Level Security (RLS) policies

**Quiz State Lost on Refresh:**
- Issue: All quiz progress stored in React state; refreshing page loses all answers and progress
- Files: `src/App.jsx` (lines 140-149, quiz state defined)
- Impact: Users lose quiz on accidental navigation; cannot resume interrupted quiz
- Severity: **MEDIUM**
- Fix approach: Persist quiz state to localStorage or Supabase sessions; implement quiz resume functionality

## Test & Quality Gaps

**No Test Suite:**
- Issue: Zero test files; no unit, integration, or E2E tests
- Files: No `*.test.js`, `*.spec.js` files in project
- Impact: Impossible to refactor safely; regressions undetected; quiz logic (calculations, scoring) untested
- Severity: **HIGH**
- Fix approach: Add Jest/Vitest; create test suites for scoring (`calcPts`), answer validation, auth flows

**No Linting or Formatting:**
- Issue: No ESLint, Prettier, or Biome configuration
- Files: package.json has no dev dependencies for linting
- Impact: Inconsistent code style; potential bugs from missing semicolons or unused vars go unnoticed
- Severity: **LOW**
- Fix approach: Add ESLint + Prettier; enforce in pre-commit hooks

**Hardcoded Test Data:**
- Issue: PodiumScreen uses fake/hardcoded leaderboard data for demo
- Files: `src/App.jsx` (lines 1140-1144, fakePodium array)
- Impact: Admin cannot see real results; misleading demo to stakeholders
- Severity: **MEDIUM**
- Fix approach: Load real results from Supabase; implement results screen in admin panel

## Performance & Scalability

**No Code Splitting:**
- Issue: Entire App component bundled together; no lazy loading of screens
- Files: All screen components defined in `src/App.jsx`
- Impact: Initial bundle size bloated (~70KB JSX alone); slow first paint
- Severity: **LOW** (acceptable for small app, but poor practice)
- Fix approach: Lazy-load screens with React.lazy and Suspense

**Inline Styles and CSS:**
- Issue: All styling done inline or via CSS string injection; no CSS-in-JS optimization
- Files: `src/App.jsx` (lines 36-96 CSS string, W object throughout)
- Impact: No style reuse; CSS injected on every render; ~2KB of CSS recreated per render
- Severity: **LOW** (functional but inefficient)
- Fix approach: Extract to Tailwind or CSS modules; use style memoization

**No Caching Strategy:**
- Issue: Quiz questions and module data fetched on every mount
- Files: `src/data/questions.js` (static import, but no memoization)
- Impact: Questions re-parsed on every app restart (minor, but inefficient for localStorage fallback)
- Severity: **LOW**
- Fix approach: Cache questions in IndexedDB for offline access

## Known Bugs & Edge Cases

**Timer Can Go Negative:**
- Issue: Timer decrements without bounds check; displays negative numbers
- Files: `src/App.jsx` (lines 177-189, timer interval does not check if t <= 0)
- Impact: Visual glitch; timer display shows −1, −2, etc.
- Severity: **LOW**
- Fix approach: Add check `if (t <= 1) { clearInterval... }` before decrement

**Module Transition Logic Fragile:**
- Issue: Module advancement relies on exact array index matching; missing null checks
- Files: `src/App.jsx` (lines 221-241, advanceQuestion function)
- Impact: If MODULES.length !== 4, logic breaks; no safety on currentMod comparison
- Severity: **MEDIUM**
- Fix approach: Add boundary checks; use module ID instead of index

**Answer Recording Not Async-Safe:**
- Issue: `recordAnswer` updates state synchronously; if Supabase call fails, state is lost
- Files: `src/App.jsx` (lines 202-205, recordAnswer function), `src/lib/supabase.js` (lines 158-171, saveAttempt is async but not awaited)
- Impact: Quiz answers saved locally but Supabase save could fail silently; data mismatch
- Severity: **MEDIUM**
- Fix approach: Await saveAttempt before advancing; show error if save fails; implement retry

**City Filter Doesn't Reset on Screen Change:**
- Issue: Admin city filter state persists when switching tabs; user sees old filter
- Files: `src/App.jsx` (lines 1028-1036, filter state)
- Impact: Confusing admin UX; admin might think no users registered in city
- Severity: **LOW**
- Fix approach: Reset filter when changing tabs

## Missing Critical Features

**No Real Leaderboard/Results:**
- Issue: Admin "results" tab shows placeholder message; no actual scoring results visible
- Files: `src/App.jsx` (lines 1096-1106, results tab shows "Brak aktywnej sesji")
- Impact: Admin cannot verify quiz is working; cannot view results to validate grading
- Severity: **MEDIUM**
- Fix approach: Query attempts from Supabase; display ranked leaderboard with scores

**No Quiz Resume Functionality:**
- Issue: If user closes quiz mid-way, progress is lost; cannot resume
- Files: `src/App.jsx`, no resumption logic
- Impact: Users frustrated by data loss; incomplete quizzes cannot be saved
- Severity: **MEDIUM**
- Fix approach: Save quiz state to Supabase after each answer; implement resume flow

**No Timeout Handling on Network Errors:**
- Issue: Supabase calls have no timeout; if server unresponsive, app hangs
- Files: `src/lib/supabase.js` (all fetch functions)
- Impact: Users see infinite loading spinner; cannot recover
- Severity: **MEDIUM**
- Fix approach: Add timeout wrapper to all async functions; show error UI

**No Offline Support (Despite PWA Config):**
- Issue: PWA manifest configured but no service worker logic for offline fallback
- Files: `vite.config.js` (lines 8-53, PWA plugin configured but not functional)
- Impact: App requires internet; PWA badge misleading
- Severity: **LOW**
- Fix approach: Implement offline questions cache; show offline indicator

## Dependency & Environment Concerns

**Environment Variables Not Enforced:**
- Issue: `.env.example` shows required vars but app starts if missing (goes to DEMO)
- Files: `.env.example` (template only), `src/lib/supabase.js` (lines 3-8, silent fallback)
- Impact: Silent failures; hard to debug in CI/CD if vars not set
- Severity: **MEDIUM**
- Fix approach: Throw error on startup if required env vars missing; validate at build time

**Supabase Schema Not Defined:**
- Issue: No migrations, schema documentation, or RLS policies provided
- Files: No SQL files in repo; Supabase setup manual-only
- Impact: Unclear what tables/columns exist; RLS rules unknown; setup error-prone
- Severity: **MEDIUM**
- Fix approach: Add `supabase/migrations/` with SQL setup; document schema

**No Dependency Lock Strategy:**
- Issue: package.json uses `^` caret for versions (allows breaking changes)
- Files: `package.json` (lines 11-19)
- Impact: npm install on different day could pull incompatible versions; builds break
- Severity: **LOW**
- Fix approach: Rely on package-lock.json; consider locking minor versions

## Code Quality Issues

**Magic Numbers Throughout:**
- Issue: Animation timings (500ms, 2500ms), point calculations, timer values hardcoded
- Files: `src/App.jsx` (lines 195-219, multiple setTimeout calls with raw milliseconds)
- Impact: Difficult to tune UX; changes require searching for numbers
- Severity: **LOW**
- Fix approach: Define constants for timing; extract to config file

**Inconsistent Naming:**
- Issue: Mix of camelCase field names (fullName) and snake_case (full_name) in user objects
- Files: `src/App.jsx` (lines 468, 471 — fallback to full_name); `src/lib/supabase.js` (full_name in profiles table)
- Impact: Confusing state handling; potential bugs from field name mismatches
- Severity: **LOW**
- Fix approach: Standardize on camelCase in client; handle snake_case at API boundary only

**Deeply Nested Styles:**
- Issue: Button styles created via W.btn function with ternary chains 5+ levels deep
- Files: `src/App.jsx` (lines 108-117, W.btn function)
- Impact: Difficult to read and maintain; style variations hard to trace
- Severity: **LOW**
- Fix approach: Extract variant styles to named constants; use CSS class system

**No Comment Documentation:**
- Issue: Complex logic (scoring, session management) has no comments explaining why
- Files: `src/lib/supabase.js` (DEMO mode branching could use explanation)
- Impact: Future developers must reverse-engineer intent
- Severity: **LOW**
- Fix approach: Add JSDoc comments to all functions; document DEMO vs. production flows

## Deployment & Operational Concerns

**Build Output Not Configured:**
- Issue: No explicit output directory or build artifact tracking
- Files: `vite.config.js` (no outDir specified, defaults to `dist/`)
- Impact: Deployment ambiguous; CI/CD must guess where built files are
- Severity: **LOW**
- Fix approach: Add explicit `build.outDir: 'dist'` to vite config

**No Environment-Specific Config:**
- Issue: No separate configs for dev/staging/production
- Files: Single `vite.config.js`; DEMO mode controlled only by env vars
- Impact: Cannot test production mode locally; no staging environment
- Severity: **MEDIUM**
- Fix approach: Create vite.config.{dev,prod}.js or use environment variable to configure

**Vercel Deployment Config Minimal:**
- Issue: `.vercel/project.json` exists but no vercel.json config for build/output
- Files: `.vercel/project.json` (basic project config only)
- Impact: Build settings determined by Vercel defaults; difficult to customize
- Severity: **LOW**
- Fix approach: Add `vercel.json` with explicit build and output directory

## Data Integrity Risks

**No Duplicate Answer Prevention:**
- Issue: Quiz allows submitting multiple answers to same question if timer not enforced
- Files: `src/App.jsx` (lines 207-218, handlePick checks `answered` flag, but no transaction)
- Impact: Answer data could be logged multiple times if race condition occurs
- Severity: **LOW**
- Fix approach: Use Supabase transaction or unique constraint on (session, question)

**Quiz Score Calculation Not Auditable:**
- Issue: Point calculations done client-side; no server-side verification
- Files: `src/App.jsx` (lines 17-18, calcPts function), `src/App.jsx` (lines 246-252, saveAttempt sends totals)
- Impact: Admin cannot verify if scores tampered with; cheating via console manipulation possible
- Severity: **MEDIUM**
- Fix approach: Compute scores server-side after quiz ends; compare with client totals; log discrepancies

**Admin Verification Can Be Undone:**
- Issue: Admin can verify user, but deletion is permanent with no audit trail
- Files: `src/lib/supabase.js` (lines 90-110, verifyUser function)
- Impact: Accidental rejection cannot be undone; no record of who verified whom
- Severity: **LOW**
- Fix approach: Add `verified_by` and `verified_at` fields; implement soft delete; add audit log

---

**Summary:**
This codebase is functional for a demo but has critical security flaws (hardcoded admin code, plaintext passwords) and architectural limitations that prevent scaling. Immediate action needed on security before any public use. Refactoring to component-based architecture and adding tests should be phase 2. Database schema and RLS policies must be documented and tested.

*Concerns audit: 2026-04-23*
