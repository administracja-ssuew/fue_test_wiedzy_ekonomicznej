---
status: awaiting_human_verify
trigger: "Po zalogowaniu jako admin (email+hasło) pojawia się od razu 'Brak profilu admina.'"
created: 2026-05-23T00:00:00Z
updated: 2026-05-23T00:00:00Z
---

## Current Focus

hypothesis: RLS policy "profiles_own" uses get_my_role() recursively in "profiles_superadmin" policy — the SELECT on profiles table fails because the admin's JWT isn't yet reflected in auth.uid() context OR (more likely) the profiles row simply doesn't exist in the DB. But there's a second strong candidate: RLS infinite recursion — get_my_role() queries profiles, and the profiles_superadmin policy calls get_my_role(), creating a circular dependency that causes the query to fail silently.
test: Code analysis — trace loginAdmin() call chain and RLS policy evaluation
expecting: One of: (A) missing row in profiles, (B) RLS circular dependency blocking the SELECT
next_action: Document findings and propose fix

## Symptoms

expected: Admin loguje się i widzi Panel Admina
actual: Po zalogowaniu (auth OK, konto istnieje) pojawia się błąd "Brak profilu admina."
errors: "Brak profilu admina." — wyświetlany użytkownikowi po loginAdmin() gdy pErr != null
reproduction: Wpisz email+hasło admina → kliknij Zaloguj → od razu ten błąd
started: Niedawno; wcześniej coś "ruszyło" z adminem, potem pojawił się ten błąd

## Eliminated

- hypothesis: Tabela profiles nie istnieje lub ma inną nazwę
  evidence: SUPABASE_SCHEMA.sql definiuje CREATE TABLE IF NOT EXISTS public.profiles — tabela istnieje i ma kolumnę id UUID REFERENCES auth.users(id)
  timestamp: 2026-05-23

- hypothesis: Kolumna id w profiles nie odpowiada auth.users.id
  evidence: id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY — typ zgodny
  timestamp: 2026-05-23

## Evidence

- timestamp: 2026-05-23
  checked: src/lib/supabase.js loginAdmin() lines 22-27
  found: |
    Auth signInWithPassword → OK
    Then: supabase.from("profiles").select("*").eq("id", data.user.id).single()
    If pErr → returns { error: "Brak profilu admina." }
    The error string is confirmed to match reported symptom.
  implication: pErr is non-null — query fails. Two possible causes: (A) no row exists, (B) RLS blocks the query.

- timestamp: 2026-05-23
  checked: SUPABASE_SCHEMA.sql — profiles table RLS policies
  found: |
    Two policies on profiles:
    1. "profiles_own": FOR ALL USING (auth.uid() = id)
    2. "profiles_superadmin": FOR ALL USING (get_my_role() = 'superadmin')
    
    get_my_role() is defined as:
      SELECT role FROM public.profiles WHERE id = auth.uid()
    
    CRITICAL: get_my_role() queries the profiles table.
    The "profiles_superadmin" policy calls get_my_role() which queries profiles.
    PostgreSQL evaluates RLS policies when querying profiles.
    This creates an INFINITE RECURSION:
      Query profiles → evaluate policies → get_my_role() → query profiles → evaluate policies → ...
    
    However: "profiles_own" policy (auth.uid() = id) does NOT recurse.
    Postgres evaluates policies with OR — if either passes, access is granted.
    So for a city_admin or superadmin reading their OWN row: profiles_own should pass.
    RLS recursion would only bite for superadmin trying to read OTHER people's rows.
  implication: RLS recursion is NOT the cause for a user reading their own profile row. profiles_own (auth.uid() = id) handles self-reads without recursion.

- timestamp: 2026-05-23
  checked: useAuth.js — onAuthStateChange subscription
  found: |
    loginAdmin() calls supabase.auth.signInWithPassword().
    This FIRES onAuthStateChange with event="SIGNED_IN".
    useAuth's onAuthStateChange handler ALSO queries profiles:
      supabase.from("profiles").select("*").eq("id", session.user.id).single()
    This is a parallel read — not the cause of the login error.
    The loginAdmin() function does its own independent profiles query.
  implication: No interference, but two simultaneous profiles reads happen on login.

- timestamp: 2026-05-23
  checked: App.jsx line 321 — onSuccess callback
  found: |
    <AdminLogin onBack={...} onSuccess={(u) => setScreen("admin")} />
    onSuccess ignores the returned user data (u) and just sets screen to "admin".
    admin user comes from useAuth() hook, not from the loginAdmin() return value.
    So even if loginAdmin() fails and returns { error }, the onSuccess path only
    runs if no error — correct behavior.
  implication: The admin state doesn't depend on loginAdmin()'s returned data.
    The real admin object comes from useAuth() via onAuthStateChange.

- timestamp: 2026-05-23
  checked: Most probable root cause — missing profiles row
  found: |
    The SUPABASE_SCHEMA.sql SEED section says:
      -- INSERT INTO public.profiles(id, full_name, city, role)
      --   VALUES ('UUID_FROM_AUTH', 'Jan Kowalski', 'Kraków', 'city_admin');
    These are COMMENTED OUT. The schema does NOT auto-create profile rows.
    Admin accounts are created manually in Supabase Auth → then profile must be
    inserted manually. If this INSERT was never run, pErr will be:
      "JSON object requested, multiple (or no) rows returned" (PGRST116)
    which causes pErr to be non-null → "Brak profilu admina."
    
    Additionally: even if the row exists, there's one more scenario:
    Supabase .single() returns pErr when 0 rows are returned by the query.
    With RLS enabled, if the authenticated user's JWT is NOT yet propagated
    to auth.uid() at query time... but this is extremely unlikely.
    
    MOST LIKELY: The profiles row for this admin simply doesn't exist in the DB.
  implication: Root cause is almost certainly a missing INSERT in public.profiles.

## Resolution

root_cause: |
  Missing row in public.profiles for the admin user. 
  
  loginAdmin() flow:
  1. supabase.auth.signInWithPassword() → SUCCESS (auth account exists)
  2. supabase.from("profiles").select("*").eq("id", data.user.id).single() → FAILS
     Because no row exists in public.profiles with that UUID.
  3. pErr is non-null (Supabase returns PGRST116: "no rows returned")
  4. Returns { error: "Brak profilu admina." }
  
  The Supabase auth account was created (email+password works) but the
  corresponding profiles row was never manually inserted — as required by
  the SEED comment in SUPABASE_SCHEMA.sql.

fix: |
  Run this SQL in Supabase Dashboard → SQL Editor:
  
  INSERT INTO public.profiles (id, full_name, city, role)
  VALUES (
    (SELECT id FROM auth.users WHERE email = 'ADMIN_EMAIL_HERE'),
    'Imię Nazwisko',
    NULL,           -- NULL for superadmin, or 'Kraków' etc for city_admin
    'superadmin'    -- or 'city_admin'
  );
  
  Additionally: improve loginAdmin() error handling to distinguish "no profile"
  from other errors, and add a .maybeSingle() call instead of .single() to
  get a clearer null vs error distinction.

verification: pending human verification — SQL INSERT required, then test login
files_changed: [src/lib/supabase.js]
