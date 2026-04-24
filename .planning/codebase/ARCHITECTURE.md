# Architecture

**Analysis Date:** 2026-04-23

## Pattern Overview

**Overall:** Single-File Monolith with Screen-State Pattern

This application follows a centralized state management approach with all UI logic and state contained in a single React component (`App.jsx`). Navigation between screens is driven by a `screen` state variable, and data flows unidirectionally from parent component through props to functional sub-components (screens).

**Key Characteristics:**
- Single entry point rendering different screen components based on state
- Client-side state management using React hooks (useState, useEffect, useRef)
- Supabase backend with local fallback (demo mode)
- Responsive design with mobile-first styling
- Progressive Web App (PWA) enabled with Vite plugin

## Layers

**Presentation / UI Layer:**
- Purpose: Render interactive screens and handle user input
- Location: `fue-quiz/src/App.jsx` (primary), inline component definitions
- Contains: Screen components (Welcome, Register, Login, Quiz, AdminPanel, etc.), style objects (W object), animations, responsive layouts
- Depends on: React hooks, data layer (questions, city/module metadata)
- Used by: Browser DOM, Vite dev server

**Data / State Layer:**
- Purpose: Manage quiz questions, modules, cities, and user session state
- Location: `fue-quiz/src/data/questions.js` (static question bank), `fue-quiz/src/App.jsx` (session state)
- Contains: QUESTIONS (32 items × 4 modules), PRACTICE_QUESTIONS, MODULES (4 items), CITIES (5 items)
- Depends on: None (static data)
- Used by: App component for rendering question display, module intro, scoring

**Backend / Persistence Layer:**
- Purpose: Handle user authentication, profile management, quiz session tracking, and attempt storage
- Location: `fue-quiz/src/lib/supabase.js`
- Contains: Supabase client initialization, auth functions, user management, session management, attempt/result tracking
- Depends on: Supabase JS SDK, environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY), localStorage (fallback)
- Used by: App component for all server operations

**Entry Point:**
- Location: `fue-quiz/src/main.jsx`
- Triggers: Browser loads `fue-quiz/index.html`
- Responsibilities: Create React root, render App component with StrictMode

## Data Flow

**Quiz Attempt Flow:**

1. User navigates from Welcome → Register/Login
2. After verification, user enters Lobby screen
3. User clicks "Rozpocznij Test" → `startQuiz()` creates session via `createSession()` (backend)
4. App renders Module Intro screen with current module details
5. User enters Quiz screen → timer starts, question displays
6. User picks answer → `handlePick(index)` called
7. Answer recorded via `recordAnswer()` → appended to `allAnswers` state
8. Feedback screen shows result (correct/incorrect, points earned, explanation)
9. `advanceQuestion()` transitions to next question or next module
10. All 32 questions completed → `finishQuiz()` calls `saveAttempt()` to persist to backend
11. Results screen displays total score and module breakdown

**Authentication Flow:**

1. Register → `registerUser()` creates auth record + profile in Supabase (or localStorage in DEMO)
2. Admin verifies user via Admin Panel → `verifyUser()` sets `verified=true`
3. Login → `loginUser()` authenticates + fetches profile data
4. Session maintained via `getCurrentUser()` on app init
5. Logout → `logoutUser()` clears session

**State Management Strategy:**

- **App-level state** (useState): `screen`, `user`, `loading`, `quizSession`, `currentMod`, `qIdx`, `timer`, `myPts`, `allAnswers`, `picked`, `answered`
- **Timer** (useRef + useEffect): Interval that decrements timer every second, triggers `handleTimeout()` if expired
- **Responsive** (useWindowWidth hook): Tracks viewport width to toggle desktop/mobile layout
- **Demo mode** (DEMO flag): Switches between Supabase backend and localStorage fallback

## Key Abstractions

**Screen Components:**
- Purpose: Encapsulate UI and logic for each page of the app
- Examples: `RegisterScreen`, `LoginScreen`, `PracticeScreen`, `AdminPanel`, `PodiumScreen`
- Pattern: Functional components with local state, receiving callback props for navigation/actions

**Session Object:**
- Purpose: Represents one quiz attempt instance
- Structure: `{ id, stage, city, status, currentModule, currentQuestion, createdBy, createdAt }`
- Used for: Linking answers to a quiz session, admin tracking of active quizzes

**Attempt Object:**
- Purpose: Stores complete quiz submission
- Structure: `{ sessionId, userId, answers: [{qId, module, picked, correct, pts}], totalScore, completed }`
- Used for: Result persistence and leaderboard generation

**Question Object:**
- Purpose: Represents a single quiz question with metadata
- Structure: `{ id, module, q, opts, ans, exp }`
- Fields: `module` (1-4), `opts` (4 answer strings), `ans` (correct index 0-3), `exp` (explanation)

**Module Object:**
- Purpose: Groups questions by category and defines time per question
- Structure: `{ id, name, icon, color, timePerQ, desc }`
- Used for: Quiz structure, scoring, visual theming

**Scoring Logic:**
- Formula: `calcPts(timeLeft, maxTime, correct) = correct ? Math.round(500 + (timeLeft/maxTime)*500) : 0`
- Range: 0–1000 points per question (base 500 + time bonus up to 500)
- Total possible: 32,000 points

## Entry Points

**App Component (`App`):**
- Location: `fue-quiz/src/App.jsx`
- Triggers: React root initialization in `main.jsx`
- Responsibilities:
  - Initialize all app state (screen, user, quiz session)
  - Render screen conditionally based on `screen` state
  - Manage auth lifecycle (check current user on mount)
  - Control quiz timer and question progression
  - Handle responsive layout logic

**React Root (`main.jsx`):**
- Location: `fue-quiz/src/main.jsx`
- Triggers: Vite dev server or production build loads entry
- Responsibilities: Mount App into DOM element with id="root"

**Screen Components (RegisterScreen, LoginScreen, etc.):**
- Location: Defined within `App.jsx` (lines 756–1205)
- Triggers: When parent `screen` state matches component name
- Responsibilities: Handle local form state, validate input, call backend functions, emit navigation callbacks

## Error Handling

**Strategy:** Try-catch and error return patterns in backend layer, error messages displayed in UI

**Patterns:**

- **Auth errors:** Backend returns `{ error: message }`, UI displays in red text above button
- **Form validation:** Client-side checks before submission (password length, field completion)
- **Demo mode fallback:** If VITE_SUPABASE_URL/KEY missing, DEMO=true, operations use localStorage
- **Network failures:** Errors from Supabase propagated as error strings to caller

**Example:**
```javascript
const { error } = await registerUser(form);
if (error) return setErr(error);  // Display to user
```

## Cross-Cutting Concerns

**Logging:** 
- None centralized; console operations not present in source
- Admin Panel tracks user verification state and quiz results

**Validation:**
- Password length check (min 6 chars) in RegisterScreen
- Email format via input `type="email"`
- Form field completion checks before submission

**Authentication:**
- JWT stored by Supabase automatically in client
- Session persistence via getCurrentUser() call on app init
- Demo mode: localStorage stores user profiles and sessions

**Styling:**
- Global CSS injected via style element in useEffect (lines 155–166)
- CSS variables and keyframe animations (su, pi, fi, bd, shake, conffall, glow, spin, pulse)
- Responsive breakpoint: 900px (isDesktop variable)
- Color scheme: Dark mode (#070215 bg, #EDE9FE text, #6B21E8 primary)

**PWA Support:**
- Manifest configured in `vite.config.js` via VitePWA plugin
- Icons: icon-192.png, icon-512.png, apple-touch-icon.png
- Service worker auto-register with runtime caching for Google Fonts

---

*Architecture analysis: 2026-04-23*
