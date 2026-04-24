# Coding Conventions

**Analysis Date:** 2026-04-23

## Naming Patterns

**Files:**
- React components: PascalCase (`App.jsx`, not app.jsx or app.js)
- Data/utility files: camelCase (`questions.js`, `supabase.js`)
- JSX files: `.jsx` extension used for React components

**Functions:**
- React components: PascalCase (`App`, `RegisterScreen`, `LoginScreen`, `UserCard`)
- Regular functions (non-components): camelCase (`registerUser`, `loginUser`, `getCurrentUser`, `handlePick`, `advanceQuestion`)
- Event handlers: camelCase with `handle` prefix (`handleTimeout`, `handlePick`, `handleLogout`, `handleVerify`, `handlePick`)
- Hook functions: camelCase with `use` prefix (`useWindowWidth`)
- Utility functions: camelCase (`cityInfo`, `calcPts`, `getModule`, `moduleQuestions`, `recordAnswer`)

**Variables:**
- State variables: camelCase (`screen`, `user`, `loading`, `quizSession`, `currentMod`, `myPts`, `allAnswers`)
- Constants: UPPER_SNAKE_CASE for truly constant data (`ADMIN_CODE`, `ANSWER_BG`, `ANSWER_LABELS`)
- References and refs: camelCase (`timerRef`, `uid`)
- Abbreviations in variable names: `ww` (window width), `pw` (password), `pts` (points), `idx` (index), `u` (user), `err` (error), `mod` (module), `qs` (questions), `q` (question)

**Types:**
- No TypeScript used; JavaScript only
- Objects and configuration objects use camelCase keys (`{ fullName, email, password, confirm, city, university }`)
- Enum-like objects use camelCase keys for export values (`CITIES`, `MODULES`, `QUESTIONS`)

## Code Style

**Formatting:**
- No formal linter/formatter configured
- Indentation: 2 spaces (observed in package.json and code)
- Line length: No strict limit enforced; lines range from 60–120+ characters
- JSX style: Inline conditional rendering with ternary operators preferred

**Linting:**
- No ESLint or Prettier configuration present
- No code style enforcement tool configured in project

**Semicolons:**
- Used consistently throughout (`import`, function declarations, statements)

**Quotes:**
- Double quotes for strings: `"welcome"`, `"#EDE9FE"`
- Single quotes used in template strings and when explicitly needed in inline styles

## Import Organization

**Order:**
1. React imports (`import { useState, useEffect, useRef } from "react"`)
2. Third-party imports (`import { CITIES, MODULES, QUESTIONS, PRACTICE_QUESTIONS } from "./data/questions.js"`)
3. Local module imports (`import { supabase, DEMO, registerUser, ... } from "./lib/supabase.js"`)

**Path Style:**
- Relative paths with `.js` extensions explicitly included: `"./data/questions.js"`, `"./lib/supabase.js"`
- No path aliases or import shortcuts configured
- Module imports use ES6 module syntax (`import`, `export`)

**Barrel Exports:**
- Multiple exports from a single module: `export const DEMO = ...; export const supabase = ...; export async function registerUser(...) {}`
- No barrel file pattern observed

## Error Handling

**Patterns:**
- Success/error object destructuring: `const { data, error } = await loginUser()`
- Conditional checks for errors: `if (error) return { error: authErr.message };`
- User-facing error messages returned in error field: `{ error: "Nieprawidłowy kod dostępu" }`
- Direct `error?.message` patterns used for Supabase responses
- Try/catch not used; promise-based error returns preferred

**Validation:**
- Early return pattern for validation failures: `if (!form.fullName || !form.email) return setErr("Wypełnij wszystkie pola.");`
- Explicit field-by-field validation before submission
- Type checking via simple JavaScript conditionals (no TypeScript)

## Logging

**Framework:** `console` (implicit — no logging library imported)

**Patterns:**
- No explicit logging statements found in codebase
- Debug output would use standard `console.log()`, `console.error()` if needed
- No structured logging or logging library present

## Comments

**When to Comment:**
- Section headers with visual separators used to organize code:
  ```javascript
  // ─── CONSTANTS ───────────────────────────────────────────────────────────────
  // ─── HOOKS ────────────────────────────────────────────────────────────────────
  // ─── STYLES ──────────────────────────────────────────────────────────────────
  // ─── MAIN APP ─────────────────────────────────────────────────────────────────
  ```
- No JSDoc or inline documentation observed
- Complex calculation formulas have explanatory text in nearby data (like QUESTIONS explanations in `ans.exp`)

**JSDoc/TSDoc:**
- Not used in this project (no TypeScript, minimal documentation)

## Function Design

**Size:**
- Functions vary greatly: from 1-liners (`const cityInfo = (n) => CITIES.find((c) => c.name === n) || { icon: "🎓", color: "#888" }`) to 200+ line component render functions
- Async functions tend to be short (10–20 lines) with clear happy/error paths
- React components contain significant JSX (100–600 lines)

**Parameters:**
- Destructuring used for function parameters: `function RegisterScreen({ onBack, onSuccess }) {}`
- Callback props passed as destructured object properties
- Inline arrow functions with single parameters: `const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))`

**Return Values:**
- Async functions return `{ data, error }` objects: `return { data: profile, error: null };`
- React components return JSX elements
- No explicit `return` often omitted for short arrow functions

## Module Design

**Exports:**
- Named exports used consistently:
  ```javascript
  export const DEMO = !SUPABASE_URL || !SUPABASE_KEY;
  export const supabase = DEMO ? null : createClient(...);
  export async function registerUser(...) { ... }
  ```
- Default export used for main App component: `export default function App() { ... }`
- Data modules export constants: `export const CITIES = [...]`

**Barrel Files:**
- Not used; all imports are direct from source files

**File Organization:**
- `src/App.jsx` — All UI components defined inline (no component splitting)
- `src/lib/supabase.js` — Data access layer with auth, quiz sessions, and attempts
- `src/data/questions.js` — Static data definitions (questions, cities, modules)
- `src/main.jsx` — React root and StrictMode initialization only

## Code Structure in App.jsx

**Component Organization:**
- Main `App` component spans ~640 lines
- Child screen components defined as functions within same file: `RegisterScreen`, `LoginScreen`, `AdminLoginScreen`, `PracticeScreen`, `AdminPanel`, `UserCard`, `PodiumScreen`
- No component extraction or separate files despite size
- Screen routing via `screen` state variable in main App

**State Management:**
- `useState` for all state (no Redux, Context API, or other state library)
- Extensive state in main App component:
  - UI state: `screen`, `adminTab`, `ww` (window width)
  - Auth state: `user`, `loading`
  - Quiz state: `quizSession`, `currentMod`, `qIdx`, `timer`, `picked`, `answered`, `myPts`, `allAnswers`, `podStep`
- Refs used for: timer interval (`timerRef`), demo user ID (`uid`)

**Inline Styles:**
- All styling via inline `style` objects
- CSS-in-JS approach with object definitions
- Global CSS injected via `<style>` tag in useEffect
- No separate CSS files or CSS-in-JS library (emotion, styled-components)
- Color constants defined as inline strings: `"#C2185B"`, `"#EDE9FE"`
- Reusable style objects stored in `W` object:
  ```javascript
  const W = {
    wrap: { ... },
    card: (extra = {}) => ({ ... }),
    btn: (v = "primary", extra = {}) => ({ ... }),
    label: { ... },
    blob: (t, l, size, color) => ({ ... }),
    back: (onClick) => (...)
  }
  ```

## Async Patterns

**Promise Handling:**
- Async/await used consistently for async operations
- Promise chaining with `.then()` for simple cases: `getCurrentUser().then((u) => { setUser(u); setLoading(false); })`
- No explicit error handling in some cases (relies on returned error objects)

**Side Effects:**
- `useEffect` hooks for:
  - CSS injection (runs once on mount)
  - Auth check on mount
  - Timer management with cleanup
- Multiple `useEffect` hooks allowed in single component (no consolidation into one)

## Data Structures

**Objects:**
- Flattened structure preferred: `{ id, name, module, q, opts, ans, exp }`
- User objects mix snake_case from DB with camelCase from App: `{ ...data.user, ...profile }` (merging Supabase snake_case with camelCase properties)

**Arrays:**
- Static data as exported constants
- Filtered/mapped arrays created inline in render: `.filter((u) => !u.verified)`, `.map((q) => (...))`

---

*Convention analysis: 2026-04-23*
