# Testing Patterns

**Analysis Date:** 2026-04-23

## Test Framework

**Status:** No testing framework installed or configured

**Current State:**
- `package.json` contains no test dependencies (no Jest, Vitest, Mocha, etc.)
- No test configuration files present (jest.config.js, vitest.config.ts, etc.)
- No `.test.js`, `.spec.js`, or test directory structure in `src/`
- No npm test script defined in `package.json`

**Why This Matters:**
This is a live quiz application with:
- User authentication (registerUser, loginUser, logoutUser)
- Quiz session management (createSession, updateSession, saveAttempt)
- Admin verification workflows (verifyUser, getPendingUsers)
- Score calculations (calcPts function with time-based scoring)
- State management across 9+ screens

**Critical unprotected areas:**
- Auth logic in `src/lib/supabase.js` (DEMO mode fallback to localStorage)
- Quiz scoring logic in `src/App.jsx` (time-based point calculation)
- Answer validation (checking if picked answer === correctAnswer)
- Session persistence and attempt recording

## Recommended Test Framework

**Suggestion:** Vitest (recommended for Vite projects)

**Why:**
- Native ES modules support (project uses `"type": "module"`)
- Fast test execution
- Compatible with React testing libraries
- Familiar Jest-like API

**Setup command:**
```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom
```

**Config file (vitest.config.ts):**
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom'
  }
})
```

## Test File Organization

**Recommended Location:**
- Co-located with source: `src/App.test.jsx`, `src/lib/supabase.test.js`, `src/data/questions.test.js`
- Alternative: `src/__tests__/` subdirectory for organizational clarity
- Test files should use `.test.js` or `.spec.js` suffix

**Naming:**
- Match source file: `supabase.js` → `supabase.test.js`
- Component tests: `App.test.jsx` for main App, `RegisterScreen.test.jsx` for individual screen

**Structure:**
Currently non-existent. Recommended pattern:

```javascript
// src/lib/supabase.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { 
  registerUser, loginUser, verifyUser, 
  createSession, saveAttempt, DEMO 
} from './supabase.js'

describe('Supabase Auth', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  describe('registerUser (DEMO mode)', () => {
    it('should create a new user in localStorage', async () => {
      const result = await registerUser({
        email: 'test@example.com',
        password: 'test123',
        fullName: 'Test User',
        city: 'Kraków',
        university: 'AGH'
      })
      expect(result.error).toBeNull()
      expect(result.data.email).toBe('test@example.com')
    })

    it('should reject duplicate email', async () => {
      // Register first user
      await registerUser({...})
      // Try duplicate
      const result = await registerUser({...})
      expect(result.error).toContain('zajęty')
    })
  })
})
```

## Test Types

### Unit Tests (High Priority)

**Where needed:**
1. **`src/lib/supabase.js` functions** — All auth and data functions
   - `registerUser()`: validation, duplicate detection, storage
   - `loginUser()`: credential checking, user retrieval
   - `verifyUser()`: approve/reject paths
   - `createSession()`: session ID generation, initial state
   - `saveAttempt()`: attempt recording, score persistence

2. **Utility functions in `src/App.jsx`**:
   - `calcPts(timeLeft, maxTime, correct)`: point calculation (crucial for quiz fairness)
   - `cityInfo(name)`: city lookup fallback handling
   - `getModule(id)`: module retrieval
   - `moduleQuestions(mod)`: filtering logic

3. **Data structure validation in `src/data/questions.js`**:
   - All questions have required fields (id, module, q, opts, ans, exp)
   - Answer indices are valid (0-3 for 4 options)
   - Module IDs match between modules and questions

### Integration Tests (Medium Priority)

**Quiz flow scenarios:**
- User registration → pending state → admin verification → can access lobby
- Start quiz → see first question → pick answer → next question
- Complete all modules → calculate total score → show results screen

**Admin workflow:**
- Admin login with correct code
- View pending users filtered by city
- Approve user → user can now take quiz
- Reject user → user removed from system

**DEMO mode fallback:**
- When env vars missing, localStorage is used
- Data persists across page refresh
- Same API returns work in both modes

### E2E Tests (Lower Priority)

**Not currently used, but candidates for Cypress/Playwright:**
- Full user journey: register → wait for approval → take quiz → see score
- Admin panel: verify users → see results

## Mocking Strategy

### What to Mock

**Supabase client:**
```javascript
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      getUser: vi.fn(),
      signOut: vi.fn()
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn()
    })
  }))
}))
```

**localStorage (for DEMO mode tests):**
```javascript
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
}
global.localStorage = localStorageMock
```

**React hooks:**
```javascript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// For useEffect timing, timer intervals:
vi.useFakeTimers()
// ... test code
vi.useRealTimers()
```

### What NOT to Mock

**In DEMO mode tests:** Do not mock localStorage — test against the real implementation to ensure fallback works

**Core application logic:** Test actual quiz scoring, not mocked versions

**Question data:** Use real question objects from `src/data/questions.js` to catch schema mismatches

## Test Examples

### Example 1: Quiz Scoring

```javascript
// src/App.test.jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import App from './App.jsx'

describe('Quiz Scoring', () => {
  it('calcPts should award full points for correct answer with full time left', () => {
    // Test helper function directly
    const pts = calcPts(90, 90, true) // 90s left of 90s max, correct
    expect(pts).toBe(1000) // 500 + (90/90)*500 = 1000
  })

  it('calcPts should award 500 base points with no time left', () => {
    const pts = calcPts(0, 90, true)
    expect(pts).toBe(500)
  })

  it('calcPts should award 0 points for incorrect answer', () => {
    const pts = calcPts(45, 90, false)
    expect(pts).toBe(0)
  })

  it('calcPts should award proportional time bonus', () => {
    const pts = calcPts(45, 90, true) // 50% time left
    expect(pts).toBe(750) // 500 + (45/90)*500 = 750
  })
})
```

### Example 2: Auth DEMO Mode

```javascript
// src/lib/supabase.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { registerUser, loginUser, getCurrentUser, DEMO } from './supabase.js'

describe('Auth (DEMO mode)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('registerUser should store user in localStorage', async () => {
    const result = await registerUser({
      email: 'anna@example.com',
      password: 'pass123',
      fullName: 'Anna Kowalska',
      city: 'Warszawa',
      university: 'UW'
    })

    expect(result.error).toBeNull()
    expect(result.data.email).toBe('anna@example.com')
    
    // Verify localStorage was updated
    const stored = JSON.parse(localStorage.getItem('fue_users'))
    expect(stored).toHaveLength(1)
    expect(stored[0].email).toBe('anna@example.com')
  })

  it('loginUser should set current user', async () => {
    // Register first
    await registerUser({ email: 'bob@example.com', password: 'pass123', ... })

    // Then login
    const result = await loginUser({
      email: 'bob@example.com',
      password: 'pass123'
    })

    expect(result.error).toBeNull()
    
    // Check localStorage
    const current = JSON.parse(localStorage.getItem('fue_current_user'))
    expect(current.email).toBe('bob@example.com')
  })

  it('getCurrentUser should return logged-in user', async () => {
    await registerUser({ email: 'carol@example.com', password: 'pass123', ... })
    await loginUser({ email: 'carol@example.com', password: 'pass123' })
    
    const user = await getCurrentUser()
    expect(user.email).toBe('carol@example.com')
  })

  it('loginUser should reject wrong password', async () => {
    await registerUser({ email: 'dave@example.com', password: 'correct', ... })
    
    const result = await loginUser({
      email: 'dave@example.com',
      password: 'wrong'
    })

    expect(result.error).toContain('Nie znaleziono konta')
  })
})
```

### Example 3: Question Data Validation

```javascript
// src/data/questions.test.js
import { describe, it, expect } from 'vitest'
import { QUESTIONS, PRACTICE_QUESTIONS, MODULES } from './questions.js'

describe('Questions Data Structure', () => {
  it('all QUESTIONS should have required fields', () => {
    QUESTIONS.forEach(q => {
      expect(q).toHaveProperty('id')
      expect(q).toHaveProperty('module')
      expect(q).toHaveProperty('q')
      expect(q).toHaveProperty('opts')
      expect(q).toHaveProperty('ans')
      expect(q.opts).toHaveLength(4)
      expect(q.ans).toBeGreaterThanOrEqual(0)
      expect(q.ans).toBeLessThan(4)
    })
  })

  it('all answers should point to valid options', () => {
    QUESTIONS.forEach(q => {
      expect(q.ans).toBeGreaterThanOrEqual(0)
      expect(q.ans).toBeLessThan(q.opts.length)
      expect(q.opts[q.ans]).toBeDefined()
    })
  })

  it('all questions should reference valid modules', () => {
    const validModuleIds = MODULES.map(m => m.id)
    QUESTIONS.forEach(q => {
      expect(validModuleIds).toContain(q.module)
    })
  })

  it('should have expected question count per module', () => {
    const expected = { 1: 8, 2: 8, 3: 8, 4: 8 }
    MODULES.forEach(mod => {
      const count = QUESTIONS.filter(q => q.module === mod.id).length
      expect(count).toBe(expected[mod.id])
    })
  })
})
```

## Coverage Targets

**Critical paths (must test):**
- Score calculation: `calcPts()` — 100% branch coverage
- Auth workflows: registration, login, verification — happy path + error cases
- Quiz session creation and answer recording
- Question data integrity

**Important areas (should test):**
- DEMO mode localStorage fallback
- City/module filtering and lookup
- Form validation in registration/login screens

**Nice to have (can defer):**
- UI component rendering (integration tests)
- Animation timing
- Responsive behavior

## Running Tests

**Once configured, run with:**
```bash
npm test                 # Run all tests
npm test -- --watch     # Watch mode for development
npm test -- --coverage  # Generate coverage report
npm test -- --ui        # Open test UI in browser (Vitest feature)
```

**Add to `package.json`:**
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:coverage": "vitest --coverage"
}
```

## Current Test Gaps

**Not covered (high risk):**
- Score calculation with various time remainings
- Duplicate user registration handling
- Quiz session persistence across browser refresh
- DEMO mode vs. Supabase mode switching
- Admin verification state transitions
- Incorrect password rejection
- Form validation edge cases

**Why this matters:** Quiz integrity depends on:
1. Correct point scoring (users could dispute results)
2. Proper authentication (prevent unauthorized access)
3. Data persistence (results must survive page refresh in DEMO mode)

---

*Testing analysis: 2026-04-23*
