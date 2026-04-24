# Phase 2 Research — Supabase Foundation

**Date:** 2026-04-24
**Source:** Project-level research (SUMMARY.md, PITFALLS.md, STACK.md) + Supabase JS SDK v2 knowledge

---

## 1. Participant Identity Model

**Decision: Email/password for participants (not anonymous sign-in)**

Rationale for this project:
- Participants need persistent identity across sessions (admin must verify before quiz)
- `supabase.auth.signInAnonymously()` creates a session but no email → admin cannot verify "who is this person"
- Anonymous users can be upgraded via `supabase.auth.updateUser({ email, password })` but adds complexity
- For a competition where admin manually verifies enrollment, **email/password is required**
- Anonymous sign-in is better suited for truly anonymous participation (e.g. live polling) — not this use case

**Auth flow:**
```js
// Register participant
const { data, error } = await supabase.auth.signUp({ email, password })
// Then insert profile: supabase.from('profiles').insert({ id: data.user.id, ... })

// Login
const { data, error } = await supabase.auth.signInWithPassword({ email, password })

// Admin: use same signInWithPassword, differentiate by profiles.role
```

**RLS**: All policies use `auth.uid()` which equals `auth.users.id` for email/password users. No anonymous sign-in complexity.

---

## 2. RLS Policy Patterns

**Key insight:** Design and test ALL policies before writing any UI. Test with `SET ROLE authenticated` + `SET request.jwt.claims.sub = 'uuid'` in SQL Editor.

**Schema and policies:**

```sql
-- Profiles table
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  city TEXT NOT NULL,
  university TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'participant'
    CHECK (role IN ('participant', 'city_admin', 'global_admin')),
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User reads/updates own profile
CREATE POLICY "own_profile_select" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "own_profile_insert" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- City admin: read profiles in own city
CREATE POLICY "city_admin_read" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'city_admin'
        AND p.city = profiles.city
    )
  );

-- City admin: update verified flag for own city
CREATE POLICY "city_admin_verify" ON public.profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'city_admin'
        AND p.city = profiles.city
    )
  );

-- Global admin: read/update all
CREATE POLICY "global_admin_all" ON public.profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'global_admin'
    )
  );
```

```sql
-- Quiz sessions table
CREATE TABLE public.quiz_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code CHAR(6) UNIQUE NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('regional', 'national')),
  city TEXT,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'active', 'finished')),
  current_question_index INT NOT NULL DEFAULT 0,
  q_started_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.quiz_sessions ENABLE ROW LEVEL SECURITY;

-- Everyone can read sessions (needed to join by code)
CREATE POLICY "sessions_select_all" ON public.quiz_sessions
  FOR SELECT USING (true);

-- Admins can insert/update/delete
CREATE POLICY "sessions_admin_write" ON public.quiz_sessions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('city_admin', 'global_admin')
    )
  );
```

```sql
-- Participants join table (who is in which session)
CREATE TABLE public.participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_id, user_id)
);

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

-- User can see own participation
CREATE POLICY "participants_own" ON public.participants
  FOR ALL USING (auth.uid() = user_id);

-- Admins can see all participants
CREATE POLICY "participants_admin" ON public.participants
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('city_admin','global_admin'))
  );
```

```sql
-- Answers table (populated in Phase 3)
CREATE TABLE public.answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  chosen INT,
  is_correct BOOLEAN,
  response_time FLOAT,
  points INT NOT NULL DEFAULT 0,
  answered_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_id, user_id, question_id)
);

ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

-- User inserts/reads own answers
CREATE POLICY "answers_own" ON public.answers
  FOR ALL USING (auth.uid() = user_id);

-- Admins read all (needed for Postgres Changes leaderboard in Phase 4)
CREATE POLICY "answers_admin_read" ON public.answers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('city_admin','global_admin'))
  );
```

**Critical: RLS self-referential recursion risk.**
The `city_admin_read` policy on `profiles` does a subquery on `profiles` itself (`SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()`). This can cause infinite recursion. **Fix:** Use a security definer function:

```sql
-- Avoid recursion: check role via security definer function
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_city()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT city FROM public.profiles WHERE id = auth.uid()
$$;
```

Then use `get_my_role()` and `get_my_city()` in policies instead of subqueries.

---

## 3. 6-Digit Join Code Generation

**Recommended approach:**

```sql
-- Generate random 6-digit numeric code (000000–999999)
-- In a Postgres function called by the app or trigger:
CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS CHAR(6)
LANGUAGE plpgsql
AS $$
DECLARE
  code CHAR(6);
  collision BOOLEAN := true;
BEGIN
  WHILE collision LOOP
    code := lpad(floor(random() * 1000000)::text, 6, '0');
    -- Check for collision among active sessions only
    SELECT EXISTS (
      SELECT 1 FROM public.quiz_sessions
      WHERE join_code = code AND status != 'finished'
    ) INTO collision;
  END LOOP;
  RETURN code;
END;
$$;
```

**In the app (JS):** Generate on client, pass to insert. Supabase UNIQUE constraint handles race conditions — retry on conflict.

```js
const generateCode = () => String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

// Insert session with generated code, retry on unique violation
async function createSession(adminId, stage, city) {
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const { data, error } = await supabase.from('quiz_sessions').insert({
      join_code: code, stage, city, created_by: adminId
    }).select().single();
    if (!error) return data;
    if (error.code !== '23505') throw error; // Only retry on unique violation
  }
  throw new Error('Could not generate unique session code');
}
```

---

## 4. JWT Expiry Configuration

**Default:** Supabase JWT expires in 3600s (1 hour). For a 2-hour quiz, this is too short.

**Fix:** Supabase Dashboard → Project Settings → Auth → JWT Expiry → set to `14400` (4 hours).

The `supabase.auth.getSession()` response includes `expires_at` (Unix timestamp). To verify:
```js
const { data: { session } } = await supabase.auth.getSession();
console.log('expires_at:', new Date(session.expires_at * 1000));
// Should be ~4 hours from now
```

**Refresh tokens** auto-refresh sessions. `onAuthStateChange` fires with `TOKEN_REFRESHED` event. Hook into this in `useAuth` to re-subscribe Realtime channels (Phase 3).

**Admin note:** JWT settings are per-project, not per-user. Set once in dashboard before any participants register.

---

## 5. useAuth Hook Pattern (DEMO → Real Supabase Migration)

**Current state:** `supabase.js` has `getCurrentUser()`, `loginUser()`, `registerUser()` that already fall back to localStorage when `DEMO=true`. These are called per-screen.

**Target pattern for Phase 2:**

```js
// hooks/useAuth.js — single root-level subscription
import { useState, useEffect } from 'react';
import { supabase, DEMO } from '../lib/supabase.js';

export default function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (DEMO) {
      // DEMO: read from localStorage
      const u = JSON.parse(localStorage.getItem('fue_current_user') || 'null');
      setUser(u);
      setLoading(false);
      return;
    }

    // Real Supabase: get session synchronously first (no network call)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        // Fetch profile to get role, city, verified
        supabase.from('profiles').select('*').eq('id', session.user.id).single()
          .then(({ data }) => { setUser(data ? { ...session.user, ...data } : null); setLoading(false); });
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    // Subscribe to auth changes (token refresh, logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') { setUser(null); return; }
      if (session?.user) {
        supabase.from('profiles').select('*').eq('id', session.user.id).single()
          .then(({ data }) => setUser(data ? { ...session.user, ...data } : null));
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return { user, loading };
}
```

**App.jsx change:** Replace current `useState(null)` + `getCurrentUser()` useEffect with `const { user, loading } = useAuth()`.

**Existing screens:** Register.jsx calls `registerUser()`, Login.jsx calls `loginUser()` — these already use real Supabase when `DEMO=false`. **No changes needed to screen components** — only App.jsx and hooks/useAuth.js.

---

## Validation Architecture

### Test Strategy for Phase 2

**Automated (Vitest):**
- `gameLogic.test.js` — already exists, no changes
- New: `supabase.test.js` — mock Supabase client, test `registerUser`, `loginUser`, `verifyUser` functions with mocked responses
- New: `useAuth.test.js` — test hook with mocked Supabase auth

**Manual (required):**
1. Register participant → see "pending" screen
2. Admin login → see verification queue
3. Admin approves participant → participant can log in
4. Create session → see 6-digit code
5. Participant enters code → lands in Lobby
6. `SET ROLE anon` SQL check in Supabase dashboard → 0 rows from other city's profiles

**SQL verification (Supabase SQL Editor):**
```sql
-- Verify RLS: as city_admin from Kraków, should NOT see Warszawa profiles
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<kraków-admin-uuid>"}';
SELECT * FROM profiles WHERE city = 'Warszawa'; -- should return 0 rows
```

---

## Key Decisions for Planning

1. **Email/password for all users** (not anonymous) — consistent identity for admin verification
2. **Security definer functions** to avoid RLS recursion on profiles table
3. **Client-side code generation** with server-side UNIQUE constraint (not Postgres function)
4. **JWT expiry = 14400s** set in Supabase dashboard (not in code)
5. **useAuth hook** at App root replaces per-screen `getCurrentUser()` calls
6. **No UI changes** — existing Register/Login/AdminLogin/Lobby screens work unchanged; only wire supabase.js and useAuth.js

---

## Open Questions (resolved for planning)

- ✅ Anonymous vs email → email/password
- ✅ RLS recursion → security definer functions  
- ✅ Join code → client-side with UNIQUE constraint
- ✅ JWT expiry → 14400s in dashboard
- ✅ DEMO mode → preserved in useAuth.js via DEMO flag
