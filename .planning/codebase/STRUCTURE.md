# Codebase Structure

**Analysis Date:** 2026-04-23

## Directory Layout

```
fue-quiz-project/
├── fue-quiz/
│   ├── public/                 # Static assets (icons, manifest)
│   ├── src/
│   │   ├── App.jsx             # Main app component (1206 lines) — all screens and logic
│   │   ├── main.jsx            # React DOM entry point (9 lines)
│   │   ├── data/
│   │   │   └── questions.js    # Question bank (421 lines)
│   │   └── lib/
│   │       └── supabase.js     # Backend integration (188 lines)
│   ├── index.html              # HTML shell with PWA metadata
│   ├── vite.config.js          # Vite build config with PWA plugin
│   ├── package.json            # Dependencies and scripts
│   └── .vercel/                # Vercel deployment config (if present)
```

## Directory Purposes

**`fue-quiz/src/`:**
- Purpose: All source code for the application
- Contains: React components, data definitions, backend integration
- Key files: `App.jsx` (primary), `main.jsx` (entry), `data/questions.js`, `lib/supabase.js`

**`fue-quiz/src/data/`:**
- Purpose: Static quiz content and metadata
- Contains: Question definitions, module metadata, city information
- Generated: No
- Committed: Yes
- Key file: `questions.js` — exports CITIES, MODULES, QUESTIONS (32 items), PRACTICE_QUESTIONS (5 items)

**`fue-quiz/src/lib/`:**
- Purpose: Backend integration and external service abstractions
- Contains: Supabase client initialization, API function wrappers
- Generated: No
- Committed: Yes
- Key file: `supabase.js` — all database and auth operations

**`fue-quiz/public/`:**
- Purpose: Static assets served by Vite dev server and build
- Contains: App icons (icon-192.png, icon-512.png, apple-touch-icon.png), favicon
- Generated: No
- Committed: Yes

## Key File Locations

**Entry Points:**
- `fue-quiz/index.html` — HTML shell, defines root div id="root", loads main.jsx
- `fue-quiz/src/main.jsx` — React entry point, creates root and renders App
- `fue-quiz/src/App.jsx` — Main React component, all screens and state management

**Configuration:**
- `fue-quiz/vite.config.js` — Build tool config, PWA plugin, React plugin
- `fue-quiz/package.json` — Dependencies (react, @supabase/supabase-js, vite, etc.)
- `fue-quiz/index.html` (head section) — PWA metadata, favicon links

**Core Logic:**
- `fue-quiz/src/App.jsx` — All 1200+ lines:
  - Hooks and state initialization (lines 24–174)
  - Helper functions: `calcPts`, `getModule`, `moduleQuestions` (lines 16–20)
  - Quiz flow: `handlePick`, `recordAnswer`, `advanceQuestion`, `finishQuiz` (lines 195–255)
  - Screen components: Welcome, Register, Login, Lobby, Quiz, Feedback, AdminPanel, etc.

**Data:**
- `fue-quiz/src/data/questions.js` — Exports 4 collections:
  - `CITIES` (5 items) — Lines 1–7
  - `MODULES` (4 items) — Lines 9–14
  - `QUESTIONS` (32 items, 4 per module) — Lines 16–363
  - `PRACTICE_QUESTIONS` (5 items) — Lines 365–421

**Backend:**
- `fue-quiz/src/lib/supabase.js` — All backend operations:
  - Auth: `registerUser`, `loginUser`, `logoutUser`, `getCurrentUser` (lines 12–64)
  - User management: `getAllUsers`, `getPendingUsers`, `verifyUser` (lines 68–110)
  - Session: `createSession`, `getActiveSession`, `updateSession` (lines 114–154)
  - Results: `saveAttempt`, `getSessionAttempts` (lines 158–187)
  - DEMO mode conditional execution in all functions

## Naming Conventions

**Files:**
- `.jsx` — React components
- `.js` — Pure JavaScript (data, utilities)
- kebab-case not used; files have simple names (App, main, questions, supabase)

**Directories:**
- lowercase (src, data, lib, public)
- semantic naming (data for constants, lib for integrations)

**Functions:**
- camelCase (e.g., `registerUser`, `handlePick`, `advanceQuestion`)
- Verbs for actions: handle*, create*, get*, set*, login*, logout*
- Prefixed with screen name where scoped to screen (e.g., functions in RegisterScreen)

**Variables:**
- camelCase state: `screen`, `user`, `quizSession`, `currentMod`, `qIdx`, `myPts`
- Short names in loops: `i` for index, `u` for user, `m` for module
- Abbreviated props: `onBack`, `onSuccess`, `w` for width (useWindowWidth), `ww` viewport width

**Types/Objects:**
- PascalCase for components: `App`, `RegisterScreen`, `LoginScreen`, `AdminPanel`
- lowercase for object keys: `fullName`, `verified`, `created_at`, `total_score`
- Constants in UPPER_CASE: `DEMO`, `ADMIN_CODE`, `ANSWER_BG`, `ANSWER_LABELS`

**Colors/Styling:**
- Hex colors assigned to MODULES, CITIES (e.g., `#6B21E8`, `#F5C518`)
- Style object `W` contains reusable style factories: `W.btn()`, `W.card()`, `W.label`, `W.back()`
- Keyframe animation names: `su`, `pi`, `fi`, `bd`, `shake`, `conffall`, `glow`, `spin`, `pulse`

## Where to Add New Code

**New Feature (e.g., leaderboard, export results):**
- Primary code: Add new screen component function in `fue-quiz/src/App.jsx` (after line 1111)
- Backend: Add new functions in `fue-quiz/src/lib/supabase.js` (after line 187)
- State: Add new useState in App main component (after line 149)
- Navigation: Add new condition in main App return logic (near line 747)

**New Question Module:**
- Data: Add new module object to `MODULES` array in `fue-quiz/src/data/questions.js` (after line 14)
- Questions: Add 8 new question objects to `QUESTIONS` array (after line 363), set module ID to new value
- Styling: Choose new color and icon (follow pattern in MODULES object)
- Update module count references in App (currently hardcoded references to 4 modules)

**New Component / Reusable Widget:**
- If simple: Define as inline function in `App.jsx` before export default
- If complex or reused: Create as separate `.jsx` file in `fue-quiz/src/components/` (directory doesn't exist; would need creation)
- Import at top of `App.jsx` and use in screen rendering

**Utilities / Helpers:**
- Shared calculation: Add to `App.jsx` top section (lines 16–20) or create `fue-quiz/src/lib/utils.js`
- Styling helper: Add to style object `W` (lines 98–128)
- Data helper: Add to `fue-quiz/src/data/questions.js` after exports

**Tests:**
- No test files present in codebase
- Tests would go in `fue-quiz/src/__tests__/` or alongside source files with `.test.jsx` suffix
- Test framework: Not configured (would need Jest/Vitest setup)

## Special Directories

**`fue-quiz/public/`:**
- Purpose: Static assets (images, icons)
- Generated: No
- Committed: Yes
- Includes: icon-192.png, icon-512.png, apple-touch-icon.png (referenced in vite.config.js and index.html)

**`fue-quiz/node_modules/`:**
- Purpose: Package dependencies
- Generated: Yes (npm install)
- Committed: No (.gitignore)
- Contains: React, Supabase SDK, Vite, VitePWA plugin, and transitive dependencies

**`fue-quiz/.vercel/`:**
- Purpose: Vercel deployment configuration
- Generated: No
- Committed: Yes
- Contains: project.json with deployment settings

## Responsive Layout Strategy

**Mobile-first (< 900px):**
- Single-column layout
- `.fue-page` max-width: 460px
- Sidebar hidden (`.fue-quiz-sidebar` display: none)
- Full-width components
- Touch-friendly padding (28px)

**Desktop (>= 900px):**
- Two-column layout for quiz (`.fue-quiz-layout` flex-direction: row)
- `.fue-page` max-width: 1280px with horizontal padding (56px)
- Quiz main content: 62% width, sidebar: 38% width
- Sidebar sticky with overflow-y auto
- Grid layouts (`.fue-modules-grid` switches to 4 columns)
- Welcome screen uses 2-column grid (left branding, right actions)

**Breakpoint:**
- `const isDesktop = ww >= 900;` determines template rendering
- `useWindowWidth()` hook provides reactive viewport tracking

---

*Structure analysis: 2026-04-23*
